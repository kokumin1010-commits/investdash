/**
 * 相談 AI に渡す「今の状況」を組み立てる。
 *
 * なぜ文脈が必要か:
 * 外部の AI に相談すると毎回「今いくら持っていて、借入がいくらで、
 * どの業種に偏っているか」を説明し直すことになる。説明を省くと
 * 一般論しか返ってこない。ここで保有状況を機械的に集めて渡すことで、
 * 「レバレッジ 1.18 倍で借入 2.29 億円ある状態で、さらに買い増して
 * よいか」という前提込みの相談ができる。
 *
 * 渡す量の方針:
 * 112 銘柄すべての明細を渡すとトークンを大量に消費し、かつ重要な情報が
 * 埋もれる。全体像（合計・借入・レバレッジ・配当・業種の偏り）は必ず渡し、
 * 個別銘柄は「相談対象の銘柄」と「評価額上位」に絞る。
 */
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { loadAdviceRecord } from "./outcomeService";
import {
  consultations,
  consultationMessages,
  investmentCards,
  newsItems,
} from "../../drizzle/schema";
import { buildPortfolio } from "./portfolio";
import { listPlanOverview } from "./priceBandService";
import { notesForPrompt } from "./symbolNoteService";

/** 個別に明細を渡す銘柄数。多すぎると重要な情報が埋もれる */
export const TOP_HOLDINGS_LIMIT = 12;

/** 相談対象銘柄について渡すニュース件数 */
export const SYMBOL_NEWS_LIMIT = 6;

/**
 * 相談対象の銘柄について渡す過去の相談件数。
 *
 * 全部渡すと当時の株価が今の質問に混ざる。直近だけで
 * 「前回はこう判断した」を踏まえるには足りる。
 */
export const PAST_CONSULT_LIMIT = 3;
/**
 * 相談対象の銘柄について渡す出来事（メモ）の件数。
 *
 * 三菱商事のように 15 件溜まっている銘柄もある。全部渡すと
 * 本題が埋もれるため、新しいものと重要なものを混ぜて 10 件に絞る。
 */
export const NOTES_FOR_PROMPT = 10;

/** 過去の相談から渡す回答の文字数。結論部分だけで足りる */
export const PAST_ANSWER_CHARS = 400;

export type ConsultHolding = {
  symbol: string;
  name: string;
  market: string;
  sector: string | null;
  /** 円換算の評価額。銘柄間で比べられるよう通貨を揃える */
  valueJpy: number;
  /** 全体に対する構成比（%） */
  sharePct: number;
  pnlPct: number | null;
  /** 現地通貨の現在値。板の値段と一致させるため換算しない */
  price: number | null;
  currency: string;
  avgCost: number | null;
  dividendYieldPct: number | null;
  /** 買い増しプランの現在の判定。未生成なら null */
  bandAction: string | null;
  bandLabel: string | null;
};

export type ConsultContext = {
  /** 全体像 */
  totalValueJpy: number;
  cashJpy: number;
  borrowedJpy: number;
  netAssetsJpy: number;
  leverage: number | null;
  usdJpyRate: number | null;
  annualDividendJpy: number;
  dividendYieldPct: number | null;
  /** 借入金利の年額。配当と比べて負担を測るのに使う */
  annualInterestJpy: number | null;
  /**
   * 借入の実効金利（年率 %）。
   * 額だけでは「買い増しの期待収益がコストを上回るか」を判定できない。
   * 借入額での加重平均。単純平均だと少額の高金利借入が過大に効く。
   */
  borrowRatePct: number | null;
  /**
   * 現金性資産（貨幣市場基金）の額と利回り。
   * 「返済に回すか買い増すか現金で置くか」の三択を比べるのに必要。
   * 株式時価には含まれない別枠の資産。
   */
  interestAssetsJpy: number;
  interestIncomeJpy: number;
  interestRatePct: number | null;
  /**
   * キャリー差（現金の利回り − 借入金利）。
   * 正なら「借りて現金で置くだけで得が出ている」状態。
   */
  carrySpreadPct: number | null;
  /**
   * 口座別のレバレッジと借入。
   * 全体が 1.36 倍でも借入は IBKR に集中しており単体では 1.83 倍になる。
   * 追証は口座単位で発生するので、全体の倍率だけでは危険度を測れない。
   */
  brokerLeverage: {
    broker: string;
    borrowedJpy: number;
    leverage: number | null;
    ratePct: number | null;
    marginRatioPct: number | null;
    dropToMarginCallPct: number | null;
  }[];
  positionCount: number;
  /** 業種の偏り。上位から順に */
  sectors: { sector: string; sharePct: number }[];
  /** 市場の偏り */
  markets: { market: string; sharePct: number }[];
  /** 評価額上位の銘柄 */
  topHoldings: ConsultHolding[];
  /** 相談対象の銘柄（保有していれば明細、していなければ null） */
  focus: ConsultHolding | null;
  /** 相談対象が未保有の場合の銘柄コード */
  focusSymbol: string | null;
  /** 買い増し圏に入っている銘柄 */
  addZone: { symbol: string; name: string; label: string }[];
  /** 相談対象銘柄の直近ニュース */
  focusNews: { title: string; summary: string | null; impactScore: number | null }[];
  /**
   * 相談対象銘柄について過去にした相談。
   * これがないと同じ質問に毎回違う答えが返り、判断が積み上がらない。
   */
  pastConsults: { askedAt: string; question: string; answerHead: string }[];
  /**
   * 相談対象銘柄の出来事の経緯（銘柄メモ）。
   *
   * 直近ニュースだけでは「3 か月前の決算で下方修正があった」ことを
   * 踏まえられない。ニュースは 90 日で整理されるが、メモは残るので
   * それより前の出来事も辿れる。
   */
  focusNotes: {
    occurredAt: string;
    kind: string;
    headline: string;
    detail: string | null;
    importance: number | null;
  }[];
  /**
   * 相談対象銘柄の投資カード。
   * 「何が崩れたら降りるか」を過去に決めているなら、それを踏まえて
   * 答えるべき。無視すると当時の判断と矛盾した回答になる。
   */
  focusCard: {
    coreThesis: string | null;
    exitConditions: string | null;
    risks: string | null;
    valuationAssumption: string | null;
  } | null;
  /**
   * これまでの提案の実績（何勝何敗か）と、この銘柄への提案の履歴。
   *
   * AI に結論を断定させる方針にしたので、その結論が当たっているのか
   * を本人（AI）にも踏まえさせる。「買いを勧めた判断は 7 勝 2 敗だが
   * 見送りは 2 勝 5 敗」と分かれば、自分の弱い側の判断で慎重になれる。
   */
  adviceRecord: {
    judged: number;
    correct: number;
    wrong: number;
    byStance: { stance: string; correct: number; wrong: number }[];
    symbolHistory: {
      stance: string;
      conclusion: string;
      executed: boolean | null;
      verdict: string | null;
      createdAt: string;
    }[];
  };
  builtAt: string;
};

/**
 * 相談に渡す文脈を組み立てる。
 *
 * 既存の集計（buildOverview / listPlanOverview）を使い回す。
 * ここで独自に計算し直すと、画面に出ている数字と相談で使う数字が
 * 食い違い、どちらが正しいのか分からなくなる。
 */
export async function buildConsultContext(
  userId: number,
  focusSymbol?: string | null,
  /**
   * 今まさに進行中の会話。過去の相談として渡すと同じ内容が二重になる
   * （進行中のやり取りは別途 history として渡している）。
   */
  excludeConsultationId?: number | null
): Promise<ConsultContext> {
  const overview = await buildPortfolio(userId);
  const plans = await listPlanOverview(userId).catch(() => []);

  const planBySymbol = new Map(plans.map(p => [p.symbol, p]));

  const totalValueJpy = overview.summary.totalValueBase ?? 0;

  const toHolding = (g: (typeof overview.groups)[number]): ConsultHolding => {
    const plan = planBySymbol.get(g.symbol);
    return {
      symbol: g.symbol,
      name: g.name,
      market: g.market,
      sector: g.sector ?? null,
      valueJpy: g.marketValueBase ?? 0,
      sharePct: g.weightPct ?? 0,
      pnlPct: g.pnlPct ?? null,
      price: g.currentPrice ?? null,
      currency: g.currency,
      avgCost: g.avgCost ?? null,
      dividendYieldPct: g.dividend?.yieldPct ?? null,
      bandAction: plan?.action ?? null,
      bandLabel: plan?.actionLabel ?? null,
    };
  };

  const sorted = [...overview.groups].sort(
    (a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0)
  );
  const topHoldings = sorted.slice(0, TOP_HOLDINGS_LIMIT).map(toHolding);

  const focusGroup = focusSymbol
    ? overview.groups.find(g => g.symbol.toUpperCase() === focusSymbol.toUpperCase())
    : undefined;

  /*
   * 買い増し圏の銘柄。
   * 「今これを買ってよいか」の相談では、他にもっと安い水準に来ている
   * 銘柄があるかどうかが判断材料になるため渡す。
   */
  const addZone = plans
    .filter(p => p.action === "ADD_MAIN" || p.action === "ADD_SMALL")
    .slice(0, 10)
    .map(p => ({ symbol: p.symbol, name: p.name, label: p.actionLabel ?? "" }));

  const focusNews = focusSymbol ? await loadSymbolNews(userId, focusSymbol) : [];
  /*
   * 過去の相談と投資カードは相談対象が決まっているときだけ引く。
   * 銘柄を指定しない全体の相談で全銘柄のカードを渡すと、
   * 112 件分の文章でトークンを食い尽くし本題が埋もれる。
   */
  const pastConsults = focusSymbol
    ? await loadPastConsults(userId, focusSymbol, excludeConsultationId)
    : [];
  const focusCard = focusSymbol ? await loadFocusCard(userId, focusSymbol) : null;
  /*
   * 出来事の経緯も相談対象が決まっているときだけ引く。
   * 全銘柄分を渡すと 700 件超になり本題が埋もれる。
   */
  const focusNotes = focusSymbol
    ? (await notesForPrompt(userId, focusSymbol.toUpperCase(), NOTES_FOR_PROMPT).catch(() => [])).map(
        n => ({
          occurredAt: n.occurredAt.toISOString(),
          kind: n.kind,
          headline: n.headline,
          detail: n.detail,
          importance: n.importance,
        })
      )
    : [];

  /*
   * 提案の実績は銘柄を問わず渡す。全体の勝敗は「自分の判断がどれだけ
   * 当たっているか」の目安になり、銘柄を決めない相談でも意味がある。
   * 件数だけの軽い集計なのでトークンを圧迫しない。
   */
  const record = await loadAdviceRecord(userId, focusSymbol ?? null);

  const div = overview.dividends;
  const borrowRatePct = computeBorrowRate(overview);
  const interestRatePct = overview.summary.interestRatePct ?? null;

  return {
    totalValueJpy,
    cashJpy: overview.summary.cashBalance ?? 0,
    borrowedJpy: sumBorrowed(overview),
    netAssetsJpy: (overview.summary.totalAssets ?? 0) - sumBorrowed(overview),
    leverage: computeLeverage(overview),
    usdJpyRate: overview.summary.usdJpyRate ?? null,
    annualDividendJpy: div?.annualIncomeBase ?? 0,
    dividendYieldPct: div?.yieldPct ?? null,
    annualInterestJpy: sumInterest(overview),
    borrowRatePct,
    interestAssetsJpy: overview.summary.interestAssetsBase ?? 0,
    interestIncomeJpy: overview.summary.interestIncomeBase ?? 0,
    interestRatePct,
    carrySpreadPct:
      interestRatePct !== null && borrowRatePct !== null
        ? interestRatePct - borrowRatePct
        : null,
    brokerLeverage: (overview.brokers ?? [])
      .filter(b => (b.leverage?.borrowedBase ?? 0) > 0)
      .map(b => ({
        broker: b.label,
        borrowedJpy: b.leverage?.borrowedBase ?? 0,
        leverage: b.leverage?.leverage ?? null,
        ratePct: b.leverage?.interest?.effectiveRatePct ?? null,
        marginRatioPct: b.leverage?.marginRatioPct ?? null,
        dropToMarginCallPct: b.leverage?.dropToMarginCallPct ?? null,
      })),
    positionCount: overview.summary.positionCount ?? 0,
    sectors: (div?.sectors ?? [])
      .slice(0, 8)
      .map(s => ({ sector: s.sector, sharePct: s.sharePct })),
    markets: (overview.markets ?? []).map(m => ({
      market: m.label,
      sharePct: m.pct,
    })),
    topHoldings,
    focus: focusGroup ? toHolding(focusGroup) : null,
    focusSymbol: focusSymbol ?? null,
    addZone,
    focusNews,
    pastConsults,
    focusNotes,
    focusCard,
    adviceRecord: {
      judged: record.overall.judged,
      correct: record.overall.correct,
      wrong: record.overall.wrong,
      byStance: record.overall.byStance,
      symbolHistory: record.symbolRows,
    },
    builtAt: new Date().toISOString(),
  };
}

/**
 * 借入の合計。
 *
 * 口座別に持っているので合算する。借入は IBKR のみだが、
 * 将来他の口座で信用取引を始めても拾えるようにしておく。
 */
function sumBorrowed(overview: Awaited<ReturnType<typeof buildPortfolio>>): number {
  return (overview.brokers ?? []).reduce(
    (sum, b) => sum + (b.leverage?.borrowedBase ?? 0),
    0
  );
}

function sumInterest(overview: Awaited<ReturnType<typeof buildPortfolio>>): number | null {
  const total = (overview.brokers ?? []).reduce(
    (sum, b) => sum + (b.leverage?.interest?.annualInterestBase ?? 0),
    0
  );
  return total > 0 ? total : null;
}

/**
 * 借入全体の実効金利（年率 %）。
 *
 * 借入額での加重平均にする。単純平均だと少額の高金利借入が過大に効き、
 * 実態から大きくずれる。金利が計算できない口座は分母からも除く
 * （金利 0 として混ぜると全体の利率が実際より低く出る）。
 */
function computeBorrowRate(
  overview: Awaited<ReturnType<typeof buildPortfolio>>
): number | null {
  let weighted = 0;
  let base = 0;
  for (const b of overview.brokers ?? []) {
    const rate = b.leverage?.interest?.effectiveRatePct;
    const borrowed = b.leverage?.borrowedBase ?? 0;
    if (rate === undefined || rate === null || borrowed <= 0) continue;
    weighted += rate * borrowed;
    base += borrowed;
  }
  return base > 0 ? weighted / base : null;
}

/**
 * レバレッジ = 株式時価 ÷ 純資産。
 *
 * 借入がなければ 1.0 になる。純資産が 0 以下のときは計算しない
 * （追証が発生している状態で、比率を出しても意味がない）。
 */
function computeLeverage(overview: Awaited<ReturnType<typeof buildPortfolio>>): number | null {
  const value = overview.summary.totalValueBase ?? 0;
  const net = (overview.summary.totalAssets ?? 0) - sumBorrowed(overview);
  if (net <= 0 || value <= 0) return null;
  return value / net;
}

async function loadSymbolNews(
  userId: number,
  symbol: string
): Promise<{ title: string; summary: string | null; impactScore: number | null }[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      title: newsItems.title,
      summary: newsItems.summary,
      impactScore: newsItems.impactScore,
    })
    .from(newsItems)
    .where(and(eq(newsItems.userId, userId), eq(newsItems.symbol, symbol)))
    .orderBy(desc(newsItems.publishedAt))
    .limit(SYMBOL_NEWS_LIMIT);
  return rows.map(r => ({
    title: r.title,
    summary: r.summary ?? null,
    impactScore: r.impactScore ?? null,
  }));
}

/**
 * 相談対象銘柄について過去にした相談を引く。
 *
 * 回答は冒頭だけ渡す。相談の回答は 600 字程度あり、3 件分を丸ごと
 * 渡すと本題より過去の話の方が長くなる。結論は先頭に書かせているので
 * 冒頭を切り出せば「前回どう判断したか」は伝わる。
 */
async function loadPastConsults(
  userId: number,
  symbol: string,
  excludeId?: number | null
): Promise<{ askedAt: string; question: string; answerHead: string }[]> {
  const db = await getDb();
  if (!db) return [];
  const threads = await db
    .select({
      id: consultations.id,
      title: consultations.title,
      createdAt: consultations.createdAt,
    })
    .from(consultations)
    .where(and(eq(consultations.userId, userId), eq(consultations.symbol, symbol)))
    .orderBy(desc(consultations.updatedAt))
    .limit(PAST_CONSULT_LIMIT + 1);

  const out: { askedAt: string; question: string; answerHead: string }[] = [];
  for (const t of threads) {
    if (excludeId && t.id === excludeId) continue;
    if (out.length >= PAST_CONSULT_LIMIT) break;
    const msgs = await db
      .select({
        role: consultationMessages.role,
        content: consultationMessages.content,
      })
      .from(consultationMessages)
      .where(eq(consultationMessages.consultationId, t.id))
      .orderBy(consultationMessages.id)
      .limit(2);
    const answer = msgs.find(m => m.role === "ASSISTANT")?.content ?? "";
    if (!answer) continue;
    out.push({
      askedAt: t.createdAt.toISOString().slice(0, 10),
      question: t.title,
      answerHead:
        answer.length > PAST_ANSWER_CHARS
          ? `${answer.slice(0, PAST_ANSWER_CHARS)}…`
          : answer,
    });
  }
  return out;
}

/**
 * 相談対象銘柄の投資カードを引く。
 *
 * 全項目が空のカードは「無い」のと同じ扱いにする。存在するだけで渡すと
 * AI が「投資カードに記載あり」と見なして空の内容を根拠にしてしまう。
 */
async function loadFocusCard(
  userId: number,
  symbol: string
): Promise<ConsultContext["focusCard"]> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      coreThesis: investmentCards.coreThesis,
      exitConditions: investmentCards.exitConditions,
      risks: investmentCards.risks,
      valuationAssumption: investmentCards.valuationAssumption,
    })
    .from(investmentCards)
    .where(and(eq(investmentCards.userId, userId), eq(investmentCards.symbol, symbol)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const hasAny =
    row.coreThesis || row.exitConditions || row.risks || row.valuationAssumption;
  if (!hasAny) return null;
  return {
    coreThesis: row.coreThesis ?? null,
    exitConditions: row.exitConditions ?? null,
    risks: row.risks ?? null,
    valuationAssumption: row.valuationAssumption ?? null,
  };
}
