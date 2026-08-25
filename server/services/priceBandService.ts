import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import * as db from "../db";
import {
  priceBandPlans,
  priceBands,
  bandCheckResults,
  type PriceBandPlan,
} from "../../drizzle/schema";
import {
  evaluateBands,
  type BandEvaluation,
  type BandAction,
  type BandInput,
} from "../../shared/priceBands";
import {
  generatePriceBandPlan,
  PRICE_BAND_MODEL,
  type PlannerContext,
  type PlanResult,
} from "./priceBandPlanner";
import { listAiRuns, withAiRunLog } from "./aiRunLog";
import { buildPortfolio } from "./portfolio";
import { fetchPriceHistory } from "./marketData";
import { runBandChecks, BAND_CHECKER_MODEL } from "./bandChecker";
import { convertToJpy, FX_FALLBACK, type FxRates } from "./fx";
import { calcPnlPct, isCostRecovered } from "../../shared/pnlLabel";
import { computeTargetDistance } from "../../shared/targetDistance";
import { selectBackfillQueue } from "../../shared/backfillQueue";

/** 文字列の数値カラム（decimal）を数値にする。空や不正値は null */
const toNum = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
};

/**
 * 買い増しプランの保存・取得・生成をまとめる。
 *
 * プランは銘柄（symbol）単位で 1 つだけ持つ。同じ銘柄を複数口座で持っていても
 * 「いくらになったら買うか」は口座によらず同じ判断になるため。
 */

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できません");
  return d;
}

export type BandWithCheck = BandInput & {
  /** この帯の確認項目に対する最新の照合結果 */
  checks: Array<{
    checkItem: string;
    status: "CLEAR" | "CONCERN" | "UNKNOWN";
    finding: string;
    sourceCount: number;
    checkedAt: Date;
  }>;
};

export type PriceBandPlanView = {
  id: number;
  symbol: string;
  currency: string;
  scope: "HOLDING" | "WATCHLIST";
  strategy: string | null;
  rationale: string | null;
  model: string | null;
  editedByUser: boolean;
  generatedAt: Date;
  bands: BandWithCheck[];
  /** 現在値。プラン単体では持たないので呼び出し側で埋める */
  currentPrice: number | null;
  /** 現在値の評価結果 */
  evaluation: BandEvaluation;
};

/** プランと段をまとめて取得する */
export async function getPlan(
  userId: number,
  symbol: string,
  currentPrice: number | null
): Promise<PriceBandPlanView | null> {
  const d = await requireDb();
  const [plan] = await d
    .select()
    .from(priceBandPlans)
    .where(and(eq(priceBandPlans.userId, userId), eq(priceBandPlans.symbol, symbol)))
    .orderBy(desc(priceBandPlans.generatedAt))
    .limit(1);
  if (!plan) return null;

  const rows = await d
    .select()
    .from(priceBands)
    .where(eq(priceBands.planId, plan.id))
    .orderBy(asc(priceBands.sortOrder));

  const bandIds = rows.map(r => r.id);
  /*
   * 確認結果は帯ごとに複数（確認項目ごと）入る。
   * 同じ項目を何度も照合した場合は最新のものだけを見せる。
   */
  const checkRows =
    bandIds.length > 0
      ? await d
          .select()
          .from(bandCheckResults)
          .where(eq(bandCheckResults.userId, userId))
          .orderBy(desc(bandCheckResults.createdAt))
      : [];

  const bands: BandWithCheck[] = rows.map(r => {
    const seen = new Set<string>();
    const checks = checkRows
      .filter(c => c.bandId === r.id)
      .filter(c => {
        if (seen.has(c.checkItem)) return false;
        seen.add(c.checkItem);
        return true;
      })
      .map(c => ({
        checkItem: c.checkItem,
        status: c.status,
        finding: c.finding,
        sourceCount: c.sourceCount,
        checkedAt: c.createdAt,
      }));

    return {
      id: r.id,
      lowerPrice: r.lowerPrice === null ? null : Number(r.lowerPrice),
      upperPrice: r.upperPrice === null ? null : Number(r.upperPrice),
      action: r.action,
      actionLabel: r.actionLabel,
      reason: r.reason,
      checkItems: (r.checkItems as string[] | null) ?? null,
      plannedAmount: r.plannedAmount === null ? null : Number(r.plannedAmount),
      sortOrder: r.sortOrder,
      checks,
    };
  });

  return {
    id: plan.id,
    symbol: plan.symbol,
    currency: plan.currency,
    scope: plan.scope,
    strategy: plan.strategy,
    rationale: plan.rationale,
    model: plan.model,
    editedByUser: plan.editedByUser,
    generatedAt: plan.generatedAt,
    bands,
    currentPrice,
    evaluation: evaluateBands(currentPrice, bands),
  };
}

/** プランを保存する（既存があれば置き換える） */
export async function savePlan(params: {
  userId: number;
  symbol: string;
  currency: string;
  scope: "HOLDING" | "WATCHLIST";
  result: PlanResult;
  model: string | null;
  editedByUser: boolean;
}): Promise<number> {
  const d = await requireDb();

  /*
   * 作り直しのときは古い段を消す。段だけ残ると価格帯が二重に見えてしまう。
   * 確認結果は帯に紐づくので、帯を消すと参照先を失う。過去の照合内容は
   * 「その時点の判断材料」として意味があるが、対応する帯がないと表示できないため
   * まとめて削除する。
   */
  const [existing] = await d
    .select()
    .from(priceBandPlans)
    .where(
      and(eq(priceBandPlans.userId, params.userId), eq(priceBandPlans.symbol, params.symbol))
    )
    .limit(1);

  let planId: number;
  if (existing) {
    const oldBands = await d.select().from(priceBands).where(eq(priceBands.planId, existing.id));
    for (const b of oldBands) {
      await d.delete(bandCheckResults).where(eq(bandCheckResults.bandId, b.id));
    }
    await d.delete(priceBands).where(eq(priceBands.planId, existing.id));
    await d
      .update(priceBandPlans)
      .set({
        currency: params.currency,
        scope: params.scope,
        strategy: params.result.strategy,
        rationale: params.result.rationale,
        model: params.model,
        editedByUser: params.editedByUser,
        generatedAt: new Date(),
      })
      .where(eq(priceBandPlans.id, existing.id));
    planId = existing.id;
  } else {
    const inserted = await d.insert(priceBandPlans).values({
      userId: params.userId,
      symbol: params.symbol,
      currency: params.currency,
      scope: params.scope,
      strategy: params.result.strategy,
      rationale: params.result.rationale,
      model: params.model,
      editedByUser: params.editedByUser,
    });
    /*
     * mysql2 ドライバは [ResultSetHeader, fields] の配列を返す。
     * insertId は先頭要素にあるため、両方の形に備えて取り出す。
     * ここで NaN になると段が planId=NaN で保存され、後から取得できなくなる。
     */
    const header = Array.isArray(inserted) ? inserted[0] : inserted;
    planId = Number((header as unknown as { insertId: number })?.insertId);
    if (!Number.isFinite(planId) || planId <= 0) {
      // 取り出せない場合は保存済みの行を読み直して確定させる
      const [row] = await d
        .select()
        .from(priceBandPlans)
        .where(
          and(eq(priceBandPlans.userId, params.userId), eq(priceBandPlans.symbol, params.symbol))
        )
        .orderBy(desc(priceBandPlans.id))
        .limit(1);
      if (!row) throw new Error("プランの保存に失敗しました");
      planId = row.id;
    }
  }

  for (let i = 0; i < params.result.bands.length; i++) {
    const band = params.result.bands[i];
    await d.insert(priceBands).values({
      planId,
      lowerPrice: band.lowerPrice === null ? null : String(band.lowerPrice),
      upperPrice: band.upperPrice === null ? null : String(band.upperPrice),
      action: band.action,
      actionLabel: band.actionLabel,
      reason: band.reason,
      checkItems: band.checkItems,
      plannedAmount: null,
      sortOrder: i,
    });
  }

  return planId;
}

/**
 * 段の価格・行動・理由を手で書き換える。
 *
 * AI の提案が気に入らない場合に直せるようにするための機能。
 * ただし段を編集すると帯の範囲が変わるため、その段に紐づく過去の照合結果は
 * 消す。古い価格帯に対する「懸念なし」がそのまま残ると、
 * 別の価格帯の判断材料として誤って読まれるため。
 */
export async function updateBand(params: {
  userId: number;
  bandId: number;
  lowerPrice: number | null;
  upperPrice: number | null;
  action: BandAction;
  actionLabel: string;
  reason: string | null;
}): Promise<void> {
  const d = await requireDb();

  // 他人の段を書き換えられないよう、プラン経由で持ち主を確かめる
  const [row] = await d
    .select({ bandId: priceBands.id, userId: priceBandPlans.userId, planId: priceBandPlans.id })
    .from(priceBands)
    .innerJoin(priceBandPlans, eq(priceBands.planId, priceBandPlans.id))
    .where(eq(priceBands.id, params.bandId))
    .limit(1);
  if (!row || row.userId !== params.userId) {
    throw new Error("この価格帯は編集できません");
  }

  /*
   * 下限が上限を上回る指定は受け付けない。
   * 通ってしまうと「どの価格でも当てはまらない段」ができ、判定不能になる。
   */
  if (
    params.lowerPrice !== null &&
    params.upperPrice !== null &&
    params.lowerPrice > params.upperPrice
  ) {
    throw new Error("下限が上限を上回っています");
  }

  await d.delete(bandCheckResults).where(eq(bandCheckResults.bandId, params.bandId));
  await d
    .update(priceBands)
    .set({
      lowerPrice: params.lowerPrice === null ? null : String(params.lowerPrice),
      upperPrice: params.upperPrice === null ? null : String(params.upperPrice),
      action: params.action,
      actionLabel: params.actionLabel,
      reason: params.reason,
    })
    .where(eq(priceBands.id, params.bandId));

  /*
   * 手直しの結果できた隙間・重なりを埋める。
   *
   * 例: 195〜309.99 の下限を 250 に上げると 210〜250 が空白になり、
   * 株価がそこに来たときに何をすべきか出せなくなる（実際に AI 生成でも
   * 同じ問題が起きて 2 銘柄が判定不能になった）。
   * 生成時と同じ整え方（下の段の上限を上の段の下限の直下まで引き上げる）を
   * 編集後にも通すことで、判定不能な状態を残さない。
   *
   * 直した段そのものは動かさない。ユーザーが入れた数字を勝手に変えると
   * 「保存したのに違う値になっている」ことになるため、動かすのは隣接する段だけ。
   */
  await resolveGapsAfterEdit(d, row.planId, params.bandId);

  // 手で直したことを残す。作り直すと消える点を画面で伝えるため
  await d
    .update(priceBandPlans)
    .set({ editedByUser: true })
    .where(eq(priceBandPlans.id, row.planId));
}

/**
 * 手動編集の後、プラン内の段が隙間なく連続するように整える。
 *
 * `keepBandId` の段は動かさない（ユーザーが入れた数字をそのまま残す）。
 * 高い順に並べ、隣接する段の境界が離れていれば下の段の上限を引き上げ、
 * 重なっていれば下の段の上限を引き下げる。
 */
async function resolveGapsAfterEdit(
  d: Awaited<ReturnType<typeof requireDb>>,
  planId: number,
  keepBandId: number
): Promise<void> {
  const rows = await d
    .select()
    .from(priceBands)
    .where(eq(priceBands.planId, planId))
    .orderBy(priceBands.sortOrder);

  type W = { id: number; lower: number | null; upper: number | null };
  const bands: W[] = rows.map(r => ({
    id: r.id,
    lower: r.lowerPrice === null ? null : Number(r.lowerPrice),
    upper: r.upperPrice === null ? null : Number(r.upperPrice),
  }));

  // 高い順（上限が大きい順）に並べる。null の上限は「上限なし」なので最上位
  bands.sort((a, b) => {
    const au = a.upper ?? Number.POSITIVE_INFINITY;
    const bu = b.upper ?? Number.POSITIVE_INFINITY;
    if (au !== bu) return bu - au;
    return (b.lower ?? Number.NEGATIVE_INFINITY) - (a.lower ?? Number.NEGATIVE_INFINITY);
  });

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const changed = new Map<number, { lower: number | null; upper: number | null }>();

  for (let i = 1; i < bands.length; i++) {
    const above = bands[i - 1];
    const below = bands[i];
    if (above.lower === null || below.upper === null) continue;

    const want = round2(above.lower - 0.01);
    // 0.01 ちょうどで接している状態が正しい。離れていても重なっていても直す
    if (Math.abs(above.lower - below.upper - 0.01) < 0.005) continue;

    // 直した段は動かさない。代わりに反対側を動かす
    if (below.id === keepBandId) {
      // 下の段が編集対象 → 上の段の下限を下の段の上限の直上に合わせる
      const newLower = round2(below.upper + 0.01);
      // 上の段の上限を割り込むなら整えられないので諦める（無理に詰めると段が消える）
      if (above.upper !== null && newLower > above.upper) continue;
      above.lower = newLower;
      changed.set(above.id, { lower: above.lower, upper: above.upper });
    } else {
      // 下の段の上限を上の段の下限の直下に合わせる
      if (below.lower !== null && want < below.lower) continue;
      below.upper = want;
      changed.set(below.id, { lower: below.lower, upper: below.upper });
    }
  }

  for (const [id, v] of Array.from(changed.entries())) {
    await d
      .update(priceBands)
      .set({
        lowerPrice: v.lower === null ? null : String(v.lower),
        upperPrice: v.upper === null ? null : String(v.upper),
      })
      .where(eq(priceBands.id, id));
  }
}

/**
 * 保有銘柄のプランを AI で生成して保存する。
 *
 * シグナル生成と同じ材料（投資カード・ニュース・52週レンジ・騰落率）に
 * 配当を加えて渡す。配当利回りは「この価格なら利回り何 %」という
 * 価格水準の根拠として使えるため。
 */
export async function generateAndSavePlanForHolding(
  userId: number,
  symbol: string
): Promise<PriceBandPlanView> {
  const holdings = await db.listHoldings(userId);
  const rows = holdings.filter(h => h.symbol === symbol);
  if (rows.length === 0) throw new Error(`保有銘柄に ${symbol} が見つかりません`);
  const holding = rows[0];

  const [card, news, portfolio, history] = await Promise.all([
    db.getCard(userId, symbol),
    db.listNews(userId, { symbol, limit: 12 }),
    buildPortfolio(userId),
    fetchPriceHistory(symbol, "6mo", "1d"),
  ]);

  const view = portfolio.groups.find(g => g.symbol === symbol);

  const returnOver = (days: number): number | null => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const cutoff = last.t - days * 24 * 60 * 60 * 1000;
    const base = history.find(b => b.t >= cutoff);
    if (!base || base.c === 0) return null;
    return ((last.c - base.c) / base.c) * 100;
  };

  /*
   * 配当は 1 株あたりの年額。銘柄が複数口座にある場合、
   * holdings 各行に同じ 1 株あたり配当が入っているので先頭行の値を使う。
   */
  const annualDividend = holding.annualDividend ? Number(holding.annualDividend) : null;
  const currentPrice = view?.currentPrice ?? null;
  const dividendYieldPct =
    annualDividend !== null && currentPrice !== null && currentPrice > 0
      ? (annualDividend / currentPrice) * 100
      : null;

  const ctx: PlannerContext = {
    name: holding.name,
    symbol,
    currency: holding.currency,
    sector: holding.sector,
    industry: holding.industry,
    position: {
      quantity: view?.quantity ?? Number(holding.quantity),
      avgCost: view?.avgCost ?? Number(holding.avgCost),
      pnlPct: view?.pnlPct ?? null,
      weightPct: view?.weightPct ?? null,
    },
    currentPrice,
    fiftyTwoWeekHigh: view?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: view?.fiftyTwoWeekLow ?? null,
    return1m: returnOver(30),
    return3m: returnOver(90),
    annualDividend,
    dividendYieldPct,
    card: card
      ? {
          buyReason: card.buyReason,
          coreThesis: card.coreThesis,
          valuationAssumption: card.valuationAssumption,
          fairValue: card.fairValue ? Number(card.fairValue) : null,
          exitConditions: card.exitConditions,
          risks: card.risks,
        }
      : null,
    news: news.map(n => ({
      title: n.title,
      sentiment: n.sentiment,
      impactScore: n.impactScore,
      summary: n.summary,
    })),
  };

  const result = await withAiRunLog(
    {
      userId,
      kind: "price_band_plan",
      symbol,
      model: PRICE_BAND_MODEL,
      summarize: r =>
        `${r.bands.length} 段を生成: ${r.bands
          .map(b => `${b.action}(${b.lowerPrice ?? "―"}〜${b.upperPrice ?? "―"})`)
          .join(" / ")}`,
    },
    () => generatePriceBandPlan(ctx)
  );

  await savePlan({
    userId,
    symbol,
    currency: holding.currency,
    scope: "HOLDING",
    result,
    model: PRICE_BAND_MODEL,
    editedByUser: false,
  });

  const saved = await getPlan(userId, symbol, currentPrice);
  if (!saved) throw new Error("プランの保存に失敗しました");
  return saved;
}

/**
 * ウォッチリスト銘柄（未保有）のプランを AI で生成して保存する。
 *
 * 保有銘柄との違いは基準になる数字がないこと。取得単価が無いため
 * 52週レンジ・配当利回り・フェアバリューを基準にするようプロンプト側で切り替える。
 * 目標買付価格を登録済みならそれも渡し、本人の意図を無視した段組みにならないようにする。
 */
export async function generateAndSavePlanForWatchItem(
  userId: number,
  symbol: string
): Promise<PriceBandPlanView> {
  const item = await db.getWatchBySymbol(userId, symbol);
  if (!item) throw new Error(`ウォッチリストに ${symbol} が見つかりません`);

  const [card, news, history] = await Promise.all([
    db.getCard(userId, symbol),
    db.listNews(userId, { symbol, limit: 12 }),
    fetchPriceHistory(symbol, "6mo", "1d"),
  ]);

  const returnOver = (days: number): number | null => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const cutoff = last.t - days * 24 * 60 * 60 * 1000;
    const base = history.find(b => b.t >= cutoff);
    if (!base || base.c === 0) return null;
    return ((last.c - base.c) / base.c) * 100;
  };

  const currentPrice = item.currentPrice === null ? null : Number(item.currentPrice);

  /*
   * 52週高値・安値はウォッチリストのテーブルに持っていないため、
   * 6か月の価格履歴から算出する。保有銘柄は株価更新時に保存しているが、
   * ウォッチリストは同じ列を持たないので、ここで計算して渡す。
   * 6か月しかないので厳密な 52週ではないが、レンジ内の位置を測る目的には足りる。
   */
  const closes = history.map(h => h.c).filter(c => Number.isFinite(c) && c > 0);
  const rangeHigh = closes.length > 0 ? Math.max(...closes) : null;
  const rangeLow = closes.length > 0 ? Math.min(...closes) : null;

  const targetPrice = item.targetPrice === null ? null : Number(item.targetPrice);

  /*
   * 目標買付価格と買付条件は投資カードの枠に載せて渡す。
   * 専用の枠を作るとプロンプトの構造が保有銘柄と分岐して保守が難しくなるため、
   * 「本人が記録した考え」という同じ意味の枠にまとめる。
   */
  const cardBlock = {
    buyReason: item.watchReason ?? card?.buyReason ?? null,
    coreThesis: card?.coreThesis ?? null,
    valuationAssumption: card?.valuationAssumption ?? null,
    fairValue: card?.fairValue ? Number(card.fairValue) : null,
    exitConditions: card?.exitConditions ?? null,
    risks: card?.risks ?? null,
  };

  const ctx: PlannerContext = {
    name: item.name,
    symbol,
    currency: item.currency,
    sector: item.sector,
    industry: item.industry,
    position: null, // 未保有。これによりプロンプトが新規購入向けに切り替わる
    currentPrice,
    fiftyTwoWeekHigh: rangeHigh,
    fiftyTwoWeekLow: rangeLow,
    return1m: returnOver(30),
    return3m: returnOver(90),
    annualDividend: null,
    dividendYieldPct: null,
    card:
      cardBlock.buyReason ||
      cardBlock.coreThesis ||
      cardBlock.fairValue !== null ||
      targetPrice !== null
        ? {
            ...cardBlock,
            // 目標買付価格があれば本人の想定水準として渡す
            valuationAssumption: [
              cardBlock.valuationAssumption,
              targetPrice !== null
                ? `本人が登録した目標買付価格: ${targetPrice} ${item.currency}`
                : null,
              item.buyConditions ? `買付条件: ${item.buyConditions}` : null,
            ]
              .filter(Boolean)
              .join(" / ") || null,
          }
        : null,
    news: news.map(n => ({
      title: n.title,
      sentiment: n.sentiment,
      impactScore: n.impactScore,
      summary: n.summary,
    })),
  };

  const result = await withAiRunLog(
    {
      userId,
      kind: "price_band_plan",
      symbol,
      model: PRICE_BAND_MODEL,
      summarize: r =>
        `${r.bands.length} 段を生成（未保有）: ${r.bands
          .map(b => `${b.action}(${b.lowerPrice ?? "―"}〜${b.upperPrice ?? "―"})`)
          .join(" / ")}`,
    },
    () => generatePriceBandPlan(ctx)
  );

  await savePlan({
    userId,
    symbol,
    currency: item.currency,
    scope: "WATCHLIST",
    result,
    model: PRICE_BAND_MODEL,
    editedByUser: false,
  });

  const saved = await getPlan(userId, symbol, currentPrice);
  if (!saved) throw new Error("プランの保存に失敗しました");
  return saved;
}

/** 保有銘柄すべてのプラン有無を返す（一覧表示・一括生成の進捗確認に使う） */
export async function runChecksForBand(
  userId: number,
  bandId: number
): Promise<PriceBandPlanView> {
  const d = await requireDb();

  const [band] = await d.select().from(priceBands).where(eq(priceBands.id, bandId)).limit(1);
  if (!band) throw new Error("価格帯が見つかりません");

  const [plan] = await d
    .select()
    .from(priceBandPlans)
    .where(and(eq(priceBandPlans.id, band.planId), eq(priceBandPlans.userId, userId)))
    .limit(1);
  if (!plan) throw new Error("この価格帯を参照する権限がありません");

  const items = (band.checkItems as string[] | null) ?? [];
  if (items.length === 0) throw new Error("この価格帯には確認項目が設定されていません");

  const holdings = await db.listHoldings(userId);
  const holding = holdings.find(h => h.symbol === plan.symbol);
  if (!holding) throw new Error(`保有銘柄に ${plan.symbol} が見つかりません`);

  const [news, portfolio] = await Promise.all([
    db.listNews(userId, { symbol: plan.symbol, limit: 20 }),
    buildPortfolio(userId),
  ]);
  const view = portfolio.groups.find(g => g.symbol === plan.symbol);
  const currentPrice = view?.currentPrice ?? null;

  /*
   * 価格帯に入っていない段の確認は実行しない。
   * 常に動かすと AI 利用枠を無駄に消費するうえ、まだ関係のない懸念材料を
   * 目にすることで判断が濁る。確認は必要な場面に絞る。
   */
  const lower = band.lowerPrice === null ? null : Number(band.lowerPrice);
  const upper = band.upperPrice === null ? null : Number(band.upperPrice);
  const inBand =
    currentPrice !== null &&
    (lower === null || currentPrice >= lower) &&
    (upper === null || currentPrice <= upper);
  if (!inBand) {
    throw new Error(
      `現在値${currentPrice !== null ? `（${currentPrice}）` : ""}はこの価格帯の外です。この価格帯に入ってから確認してください。`
    );
  }

  const outcomes = await withAiRunLog(
    {
      userId,
      kind: "band_check",
      symbol: plan.symbol,
      model: BAND_CHECKER_MODEL,
      summarize: rows =>
        `${rows.length} 項目を照合: ` +
        `懸念 ${rows.filter(r => r.status === "CONCERN").length} / ` +
        `問題なし ${rows.filter(r => r.status === "CLEAR").length} / ` +
        `不明 ${rows.filter(r => r.status === "UNKNOWN").length}`,
    },
    () =>
      runBandChecks({
        name: holding.name,
        symbol: plan.symbol,
        actionLabel: band.actionLabel,
        checkItems: items,
        news: news.map(n => ({
          title: n.title,
          summary: n.summary,
          sentiment: n.sentiment,
          impactScore: n.impactScore,
          publishedAt: n.publishedAt,
          source: n.source,
        })),
      })
  );

  /*
   * 同じ項目を再確認した場合は古い結果を消してから入れる。
   * 残しておくと「いつの判断か」が混ざり、古い懸念を今のものと誤読する。
   */
  for (const o of outcomes) {
    await d
      .delete(bandCheckResults)
      .where(and(eq(bandCheckResults.bandId, bandId), eq(bandCheckResults.checkItem, o.checkItem)));
    await d.insert(bandCheckResults).values({
      userId,
      bandId,
      checkItem: o.checkItem,
      status: o.status,
      finding: o.finding,
      sourceCount: o.sourceCount,
    });
  }

  const saved = await getPlan(userId, plan.symbol, currentPrice);
  if (!saved) throw new Error("プランを取得できませんでした");
  return saved;
}

export async function listPlanStatus(
  userId: number
): Promise<Array<{ symbol: string; name: string; hasPlan: boolean; generatedAt: Date | null }>> {
  const d = await requireDb();
  const holdings = await db.listHoldings(userId);
  const plans = await d
    .select()
    .from(priceBandPlans)
    .where(eq(priceBandPlans.userId, userId));
  const planMap = new Map<string, PriceBandPlan>(plans.map(p => [p.symbol, p]));

  const seen = new Set<string>();
  const out: Array<{ symbol: string; name: string; hasPlan: boolean; generatedAt: Date | null }> =
    [];
  for (const h of holdings) {
    if (seen.has(h.symbol)) continue;
    seen.add(h.symbol);
    const plan = planMap.get(h.symbol);
    out.push({
      symbol: h.symbol,
      name: h.name,
      hasPlan: !!plan,
      generatedAt: plan?.generatedAt ?? null,
    });
  }
  return out;
}

export type MissingPlanBatchResult = {
  total: number;
  eligible: number;
  processed: number;
  generated: number;
  skipped: Array<{ symbol: string; reason: string }>;
  failed: Array<{ symbol: string; reason: string }>;
  remaining: number;
  nextOffset: number | null;
  quotaExhausted: boolean;
};

/**
 * 既存プランを一切上書きせず、保有中でプランが無い銘柄だけを小さなバッチで生成する。
 * 最近失敗した銘柄は自動実行時だけ冷却し、恒久的な失敗が全体を塞がないようにする。
 */
export async function generateMissingHoldingPlans(
  userId: number,
  opts: { batchSize?: number; retryFailed?: boolean; failureCooldownMs?: number } = {},
  deps: {
    listPlanStatus: typeof listPlanStatus;
    buildPortfolio: typeof buildPortfolio;
    listAiRuns: typeof listAiRuns;
    generatePlan: typeof generateAndSavePlanForHolding;
  } = {
    listPlanStatus,
    buildPortfolio,
    listAiRuns,
    generatePlan: generateAndSavePlanForHolding,
  }
): Promise<MissingPlanBatchResult> {
  const batchSize = Math.min(4, Math.max(1, opts.batchSize ?? 2));
  const retryFailed = opts.retryFailed ?? false;
  const failureCooldownMs = opts.failureCooldownMs ?? 6 * 60 * 60 * 1000;
  const [status, portfolio, recentRuns] = await Promise.all([
    deps.listPlanStatus(userId),
    deps.buildPortfolio(userId),
    deps.listAiRuns(userId, { kind: "price_band_plan", limit: 300 }),
  ]);

  const valueBySymbol = new Map(
    portfolio.groups.map(group => [group.symbol, group.marketValueBase ?? 0])
  );
  const priceBySymbol = new Map(
    portfolio.groups.map(group => [group.symbol, group.currentPrice])
  );
  const missing = status
    .filter(item => !item.hasPlan)
    .map(item => ({ ...item, value: valueBySymbol.get(item.symbol) ?? 0 }));
  const { eligible } = selectBackfillQueue(missing, recentRuns, {
    retryFailed,
    failureCooldownMs,
  });
  const batch = eligible.slice(0, batchSize);
  const failed: MissingPlanBatchResult["failed"] = [];
  const skipped: MissingPlanBatchResult["skipped"] = [];
  let generated = 0;
  let quotaExhausted = false;

  for (const item of batch) {
    if (priceBySymbol.get(item.symbol) === null) {
      skipped.push({ symbol: item.symbol, reason: "現在値が未取得です" });
      continue;
    }
    try {
      await deps.generatePlan(userId, item.symbol);
      generated += 1;
    } catch (error) {
      failed.push({
        symbol: item.symbol,
        reason: error instanceof Error ? error.message : String(error),
      });
      const message = error instanceof Error ? error.message : String(error);
      if (/quota|rate limit|too many requests|利用枠/i.test(message)) {
        quotaExhausted = true;
        break;
      }
    }
  }

  const remaining = Math.max(0, missing.length - generated);
  return {
    total: missing.length,
    eligible: eligible.length,
    processed: batch.length,
    generated,
    skipped,
    failed,
    remaining,
    nextOffset: quotaExhausted || remaining === 0 ? null : 0,
    quotaExhausted,
  };
}

/** 買い増しプランの一覧（今どの段にいるかを横断で見るため） */
export type PlanOverviewRow = {
  symbol: string;
  name: string;
  currency: string;
  currentPrice: number | null;
  /** 現在いる段。帯の外なら null */
  action: BandAction | null;
  actionLabel: string | null;
  /** 帯の外にいるか（登録した価格帯より上／下） */
  outsideDirection: "ABOVE" | "BELOW" | null;
  /** 次の段までの変化率（%）。すでに一番下ならnull */
  nextGapPct: number | null;
  nextActionLabel: string | null;
  /** 確認が必要な段にいて、まだ照合していない項目があるか */
  needsCheck: boolean;
  /** 照合済みで懸念ありの件数 */
  concernCount: number;
  generatedAt: Date;
  /** 保有額（円換算）。複数口座に分かれていても合算する */
  holdingValueJpy: number | null;
  /** 株式時価全体に対する構成比（%） */
  weightPct: number | null;
  /** 取得単価（現地通貨）。複数口座なら株数で重み付けした平均 */
  avgCost: number | null;
  /**
   * 損益率（%）。取得原価が 0 以下の銘柄（オプションのプレミアム受取で
   * 原価を回収済み）では率に意味がないため null を返す。
   */
  pnlPct: number | null;
  /** 取得原価が 0 以下で率を出せない状態か */
  costRecovered: boolean;
  /** 保有しているか。false ならウォッチリストの未保有銘柄 */
  held: boolean;
  /** 未保有銘柄の目標買付価格（現地通貨） */
  watchTargetPrice: number | null;
  /** 目標価格まであと何%動けば届くか。現在値を分母にする */
  watchGapPct: number | null;
  /** 未保有銘柄の優先度（HIGH / MEDIUM / LOW） */
  watchPriority: string | null;
  /**
   * 目標価格が現在値から -30% 以上離れているか。
   * 半値近くまで待つ設定は実質「買わない」と同じで、
   * 機会損失を防ぐ目的に反するため作り直すべきだと分かるようにする。
   */
  targetTooFar: boolean;
};

/** 構成比を判断するための全体の目安。上限という線は引かず、比較材料だけを出す */
export type PlanOverviewStats = {
  /** 株式時価の合計（円） */
  totalValueJpy: number;
  /** 銘柄数 */
  symbolCount: number;
  /** 1 銘柄あたりの平均構成比（%） */
  avgWeightPct: number | null;
  /** 上位 10 銘柄の平均構成比（%）。主力としての普通の大きさの目安 */
  topAvgWeightPct: number | null;
};

/**
 * 全銘柄のプランを 1 回のクエリでまとめて評価する。
 *
 * 銘柄ごとに getPlan を呼ぶと 112 銘柄 × 3 クエリになり実用にならないため、
 * プラン・段・照合結果をそれぞれ 1 回引いてメモリ上で突き合わせる。
 */
export async function listPlanOverview(userId: number): Promise<PlanOverviewRow[]> {
  const d = await requireDb();
  const [holdings, plans, settings, watchItems] = await Promise.all([
    db.listHoldings(userId),
    d.select().from(priceBandPlans).where(eq(priceBandPlans.userId, userId)),
    db.getSettings(userId),
    db.listWatchlist(userId),
  ]);
  if (plans.length === 0) return [];

  const planIds = plans.map(p => p.id);
  const [bandRows, checkRows] = await Promise.all([
    d.select().from(priceBands).where(inArray(priceBands.planId, planIds)),
    d.select().from(bandCheckResults).where(eq(bandCheckResults.userId, userId)),
  ]);

  const bandsByPlan = new Map<number, typeof bandRows>();
  for (const r of bandRows) {
    const list = bandsByPlan.get(r.planId) ?? [];
    list.push(r);
    bandsByPlan.set(r.planId, list);
  }

  /*
   * 現在値は保有から取る。同じ銘柄を複数口座で持つ場合はどれも同じ株価なので
   * 最初に見つかったものを使う。名前も保有側の表記に合わせる。
   */
  const priceBySymbol = new Map<string, { price: number | null; name: string }>();
  for (const h of holdings) {
    if (priceBySymbol.has(h.symbol)) continue;
    priceBySymbol.set(h.symbol, {
      price: h.currentPrice === null ? null : Number(h.currentPrice),
      name: h.name,
    });
  }

  /*
   * ウォッチリスト（まだ買っていない銘柄）も同じ一覧に載せる。
   *
   * 買い場に来ているかどうかは保有・未保有で分けて見るものではない。
   * 別画面に分かれていると「保有 5 銘柄が買い増し圏」を見た後に
   * ウォッチリストを開き直す必要があり、未保有の買い場を見落とす。
   * 保有側を優先するのは、同じ銘柄がウォッチリストにも残っている場合に
   * 保有側の株価・名称の方が実態に近いため。
   */
  const watchBySymbol = new Map<string, (typeof watchItems)[number]>();
  for (const w of watchItems) {
    watchBySymbol.set(w.symbol, w);
    if (priceBySymbol.has(w.symbol)) continue;
    priceBySymbol.set(w.symbol, {
      price: w.currentPrice === null ? null : Number(w.currentPrice),
      name: w.name,
    });
  }

  /*
   * 保有額・取得原価・株数を銘柄単位で合算する。
   *
   * 同じ銘柄を複数口座で持つ場合、口座ごとに取得単価が違う（楽天で買った
   * トヨタと IBKR で買ったトヨタは別の値段）。買い増しの判断で見たいのは
   * 「この銘柄を全体でいくら持っているか」なので、株数で重み付けした
   * 平均取得単価を出す。単純平均だと 1 株だけの口座が過大に効く。
   */
  const rates: FxRates = {
    usdJpy: toNum(settings?.usdJpyRate) ?? FX_FALLBACK.usdJpy,
    sgdJpy: toNum(settings?.sgdJpyRate) ?? FX_FALLBACK.sgdJpy,
    hkdJpy: toNum(settings?.hkdJpyRate) ?? FX_FALLBACK.hkdJpy,
  };
  const aggBySymbol = new Map<
    string,
    { qty: number; costLocal: number; valueJpy: number | null; currency: string }
  >();
  for (const h of holdings) {
    const qty = Number(h.quantity);
    const cost = Number(h.avgCost);
    const price = h.currentPrice === null ? null : Number(h.currentPrice);
    const entry =
      aggBySymbol.get(h.symbol) ??
      { qty: 0, costLocal: 0, valueJpy: null, currency: h.currency };
    entry.qty += qty;
    entry.costLocal += qty * cost;
    if (price !== null) {
      const jpy = convertToJpy(qty * price, h.currency, rates);
      if (jpy !== null) entry.valueJpy = (entry.valueJpy ?? 0) + jpy;
    }
    aggBySymbol.set(h.symbol, entry);
  }

  // 構成比の分母。株価が未取得の銘柄は分母にも入れない（比率が過小になるため）
  let totalValueJpy = 0;
  aggBySymbol.forEach(v => {
    totalValueJpy += v.valueJpy ?? 0;
  });

  const out: PlanOverviewRow[] = [];
  for (const plan of plans) {
    const info = priceBySymbol.get(plan.symbol);
    /*
     * 保有もウォッチリストにもない銘柄のプランは出さない。
     * 売却してウォッチリストからも消した銘柄が残り続けるのを防ぐ。
     */
    if (!info) continue;

    const bands: BandInput[] = (bandsByPlan.get(plan.id) ?? []).map(r => ({
      id: r.id,
      lowerPrice: r.lowerPrice === null ? null : Number(r.lowerPrice),
      upperPrice: r.upperPrice === null ? null : Number(r.upperPrice),
      action: r.action,
      actionLabel: r.actionLabel,
      reason: r.reason,
      checkItems: (r.checkItems as string[] | null) ?? null,
      plannedAmount: r.plannedAmount === null ? null : Number(r.plannedAmount),
      sortOrder: r.sortOrder,
    }));

    const ev = evaluateBands(info.price, bands);
    const current = ev.currentBand;

    /*
     * 「確認が必要」は、確認項目がある段にいて、まだ照合していない項目が
     * 残っている場合だけ立てる。帯の外にいる銘柄では立てない。
     */
    let needsCheck = false;
    let concernCount = 0;
    if (current?.checkItems?.length) {
      const done = new Set(
        checkRows.filter(c => c.bandId === current.id).map(c => c.checkItem)
      );
      needsCheck = current.checkItems.some(item => !done.has(item));
      concernCount = checkRows.filter(
        c => c.bandId === current.id && c.status === "CONCERN"
      ).length;
    }

    out.push({
      symbol: plan.symbol,
      name: info.name,
      currency: plan.currency,
      currentPrice: info.price,
      action: current?.action ?? null,
      actionLabel: current?.actionLabel ?? null,
      outsideDirection: ev.abovePlan ? "ABOVE" : ev.belowPlan ? "BELOW" : null,
      nextGapPct: ev.gapToNextPct,
      nextActionLabel: ev.nextBand?.actionLabel ?? null,
      needsCheck,
      concernCount,
      generatedAt: plan.generatedAt,
      ...buildHoldingFacts(aggBySymbol.get(plan.symbol), info.price, totalValueJpy),
      ...buildWatchFacts(watchBySymbol.get(plan.symbol), info.price, aggBySymbol.has(plan.symbol)),
    });
  }
  return out;
}

/**
 * 未保有銘柄（ウォッチリスト）の情報を組み立てる。
 *
 * 目標価格までの距離は「今の株価から見てあと何%動けば届くか」で出す。
 * 分母を目標価格にすると同じ距離でも数字が変わり、注文の判断に使えない。
 *
 * 目標が現在値から極端に離れている場合は印を付ける。実測では INPEX の
 * 目標が 1,900 円に対し現在値 3,765 円（-49.5%）で、半値になるのを待つのは
 * 実質「買わない」と同じ。機会損失を防ぐという当初の目的に反するため、
 * 作り直すべきだと分かるようにする。
 */
function buildWatchFacts(
  item:
    | { targetPrice: string | null; priority: string; watchReason: string | null }
    | undefined,
  price: number | null,
  held: boolean
): Pick<
  PlanOverviewRow,
  "held" | "watchTargetPrice" | "watchGapPct" | "watchPriority" | "targetTooFar"
> {
  if (held || !item) {
    return {
      held,
      watchTargetPrice: null,
      watchGapPct: null,
      watchPriority: null,
      targetTooFar: false,
    };
  }
  const target = item.targetPrice === null ? null : Number(item.targetPrice);
  // 判定は shared に集約する。ウォッチリスト画面と同じ閾値・同じ基準にするため
  const distance = computeTargetDistance(price, target);
  return {
    held: false,
    watchTargetPrice: target,
    watchGapPct: distance.gapPct,
    watchPriority: item.priority,
    targetTooFar: distance.needsRework,
  };
}

/**
 * 保有額・構成比・取得単価・損益率を組み立てる。
 *
 * 損益率は calcPnlPct に通す。原価がマイナスの銘柄（AMD はオプションの
 * プレミアム受取で原価を回収済み）を素朴に割ると符号が反転して
 * 含み益が巨額の損失に見えるため、率を出さず「原価回収済み」として扱う。
 */
function buildHoldingFacts(
  agg: { qty: number; costLocal: number; valueJpy: number | null } | undefined,
  price: number | null,
  totalValueJpy: number
): Pick<
  PlanOverviewRow,
  "holdingValueJpy" | "weightPct" | "avgCost" | "pnlPct" | "costRecovered"
> {
  if (!agg || agg.qty === 0) {
    return {
      holdingValueJpy: null,
      weightPct: null,
      avgCost: null,
      pnlPct: null,
      costRecovered: false,
    };
  }
  const avgCost = agg.costLocal / agg.qty;
  const marketLocal = price === null ? null : price * agg.qty;
  return {
    holdingValueJpy: agg.valueJpy,
    weightPct:
      agg.valueJpy !== null && totalValueJpy > 0
        ? (agg.valueJpy / totalValueJpy) * 100
        : null,
    avgCost,
    // calcPnlPct は含み損益（時価 − 原価）を受け取る。時価そのものではない
    pnlPct:
      marketLocal === null ? null : calcPnlPct(marketLocal - agg.costLocal, agg.costLocal),
    costRecovered: isCostRecovered(agg.costLocal),
  };
}

/**
 * 構成比を判断するための目安を出す。
 *
 * 「1 銘柄 5% 以下」という一般的な目安は 20〜30 銘柄で運用する前提の数字で、
 * 112 銘柄には当てはまらない（均等なら 1 銘柄 0.9%）。固定の上限を引くと
 * 根拠のない線になるため、実際の分布から比較材料だけを出す。
 */
export function computeOverviewStats(rows: PlanOverviewRow[]): PlanOverviewStats {
  const weights = rows
    .map(r => r.weightPct)
    .filter((w): w is number => w !== null)
    .sort((a, b) => b - a);
  let totalValueJpy = 0;
  for (const r of rows) totalValueJpy += r.holdingValueJpy ?? 0;
  const top = weights.slice(0, 10);
  return {
    totalValueJpy,
    symbolCount: weights.length,
    avgWeightPct:
      weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : null,
    topAvgWeightPct: top.length > 0 ? top.reduce((a, b) => a + b, 0) / top.length : null,
  };
}
