/**
 * 候補銘柄の提案をポートフォリオから組み立て、実在検証してから返す。
 *
 * AI は存在しない銘柄コードや上場廃止済みの銘柄を挙げることがある。
 * そのまま画面に出すと「株価が取れない銘柄」がウォッチリストに入り、
 * 価格帯も作れず判定もできない使えない行になる。
 * そのため必ず株価取得を試し、取れないものは捨てる。
 */
import * as db from "../db";
import { fetchQuote, fetchCompanyProfile } from "./marketData";
import { buildPortfolio } from "./portfolio";
import { marketLabel, type Market } from "@shared/investing";
import {
  suggestCandidates,
  CANDIDATE_MODEL,
  type SuggesterContext,
  type SuggestedCandidate,
  type PortfolioGap,
} from "./candidateSuggester";
import { withAiRunLog } from "./aiRunLog";

/** 実在検証を通った候補 */
export type VerifiedCandidate = SuggestedCandidate & {
  /** 実際に取得できた銘柄名（AI の書いた名前より信頼できる） */
  verifiedName: string;
  /** 現在値（現地通貨） */
  currentPrice: number | null;
  /** 通貨 */
  currency: string;
  /** 52週高値・安値。価格帯の妥当性判断に使う */
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** 実際のセクター（AI の思い込みではなく取得値） */
  sector: string | null;
  industry: string | null;
  /** 市場ラベル（表示用） */
  marketLabel: string;
  /**
   * 現在値から目標値までの下落率（%）。負の値。
   * 「あと何 % 下がれば買いたい値段になるか」を画面で出すために使う。
   */
  gapToTargetPct: number | null;
  /**
   * 目標価格をこちらで補正した場合の説明。補正していなければ null。
   * AI が現在値以上の値を返すことがあり、そのまま出すと待つ意味がなくなるため。
   */
  targetAdjustedNote: string | null;
};

/**
 * 買いたい値段の妥当性を確かめる。
 *
 * AI は「今が買い時」と判断すると現在値と同じか高い値を返すことがある。
 * それをそのまま出すと、待って買うという使い方が成立しない。
 * かといって捨ててしまうと候補自体が消えるため、現在値の 8% 下に補正し、
 * 補正したことを画面に明示する。黙って書き換えると数字を信用できなくなる。
 */
export function resolveTargetPrice(
  aiTarget: number | null | undefined,
  currentPrice: number | null
): { targetPrice: number | null; gapPct: number | null; note: string | null } {
  if (currentPrice === null || currentPrice <= 0) {
    return { targetPrice: aiTarget ?? null, gapPct: null, note: null };
  }
  if (aiTarget == null || !Number.isFinite(aiTarget) || aiTarget <= 0) {
    const fallback = round2(currentPrice * 0.92);
    return {
      targetPrice: fallback,
      gapPct: -8,
      note: "AI が買いたい値段を返さなかったため、現在値の 8% 下を暫定値にしています。ご自身で見直してください。",
    };
  }
  if (aiTarget >= currentPrice) {
    const fallback = round2(currentPrice * 0.92);
    return {
      targetPrice: fallback,
      gapPct: -8,
      note: `AI の提示額（${aiTarget}）が現在値以上で待つ意味がないため、現在値の 8% 下に補正しました。ご自身で見直してください。`,
    };
  }
  return {
    targetPrice: aiTarget,
    gapPct: round2(((aiTarget - currentPrice) / currentPrice) * 100),
    note: null,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export type CandidateSuggestionResult = {
  gaps: PortfolioGap[];
  candidates: VerifiedCandidate[];
  overview: string;
  /** 実在検証で捨てられた銘柄。何が捨てられたか分かるようにする */
  rejected: Array<{ name: string; symbol: string; reason: string }>;
};

/**
 * ポートフォリオから偏り分析用のコンテキストを組み立てる。
 *
 * 市場別の構成比は marketSlices ではなく positions から直接集計する。
 * marketSlices は配当や損益も含む重い構造で、ここでは構成比だけが必要なため。
 */
async function buildSuggesterContext(userId: number): Promise<SuggesterContext> {
  const [portfolio, watchItems] = await Promise.all([
    buildPortfolio(userId),
    db.listWatchlist(userId),
  ]);

  const total = portfolio.summary.totalValueBase;

  const marketMap = new Map<Market, { value: number; symbols: Set<string> }>();
  for (const p of portfolio.positions) {
    const m = marketMap.get(p.market) ?? { value: 0, symbols: new Set<string>() };
    m.value += p.marketValueBase ?? 0;
    m.symbols.add(p.symbol);
    marketMap.set(p.market, m);
  }

  const markets = Array.from(marketMap.entries())
    .map(([market, v]) => ({
      label: marketLabel(market),
      pct: total > 0 ? (v.value / total) * 100 : 0,
      count: v.symbols.size,
    }))
    .sort((a, b) => b.pct - a.pct);

  /*
   * 構成比上位は 12 件に絞る。全 112 銘柄を渡すとプロンプトが膨らむだけで、
   * 「同じ材料で動く銘柄が並んでいないか」の判断には上位だけで足りる。
   */
  const topHoldings = portfolio.groups
    .filter(g => g.weightPct !== null)
    .sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
    .slice(0, 12)
    .map(g => ({
      name: g.name,
      symbol: g.symbol,
      pct: g.weightPct ?? 0,
      sector: g.sector,
    }));

  /*
   * 借入金利は口座別の明細から加重平均を取る。
   * 配当利回りとの差が薄いかどうかが「利回り改善が課題か」の判断材料になる。
   */
  let borrowRatePct: number | null = null;
  /*
   * 借入金利は口座別の carry（配当と利息の比較）から取る。
   * 借入額で重み付けするのは、複数口座で金利が違う場合に
   * 単純平均だと実態とずれるため。
   */
  const withCarry = portfolio.brokers.filter(b => b.leverage?.interest != null);
  if (withCarry.length > 0) {
    const totalBorrowed = withCarry.reduce(
      (s, b) => s + Math.abs(b.leverage?.borrowedBase ?? 0),
      0
    );
    if (totalBorrowed > 0) {
      const weighted = withCarry.reduce(
        (s, b) =>
          s +
          (b.leverage?.interest?.effectiveRatePct ?? 0) *
            Math.abs(b.leverage?.borrowedBase ?? 0),
        0
      );
      borrowRatePct = weighted / totalBorrowed;
    }
  }

  return {
    totalValueBase: total,
    borrowedBase: Math.abs(portfolio.summary.totalBorrowedBase ?? 0),
    leverage: portfolio.summary.overallLeverage ?? null,
    dividendYieldPct: portfolio.dividends?.yieldPct ?? null,
    borrowRatePct,
    sectors: portfolio.sectors.map(s => ({ label: s.label, pct: s.pct, count: s.count })),
    markets,
    topHoldings,
    heldSymbols: Array.from(new Set(portfolio.positions.map(p => p.symbol))),
    watchedSymbols: watchItems.map(w => w.symbol),
  };
}

/**
 * 候補銘柄を提案する。AI の出力は必ず実在検証を通す。
 */
export async function generateCandidateSuggestions(
  userId: number
): Promise<CandidateSuggestionResult> {
  const ctx = await buildSuggesterContext(userId);

  const result = await withAiRunLog(
    {
      userId,
      kind: "candidate_suggestion",
      symbol: null,
      model: CANDIDATE_MODEL,
      summarize: r =>
        `偏り ${r.gaps.length} 件・候補 ${r.candidates.length} 件: ${r.candidates
          .map(c => c.symbol)
          .join(", ")}`,
    },
    () => suggestCandidates(ctx)
  );

  /*
   * 実在検証。株価が取れない銘柄は捨てる。
   * 並列で投げるが、Yahoo Finance に一度に大量に投げると弾かれるため
   * 候補は最大 8 件に制限されている前提で全件並列にする。
   */
  const verified: VerifiedCandidate[] = [];
  const rejected: Array<{ name: string; symbol: string; reason: string }> = [];

  await Promise.all(
    result.candidates.map(async c => {
      const symbol = c.symbol.trim().toUpperCase();
      try {
        const quote = await fetchQuote(symbol);
        if (!quote || quote.price === null) {
          rejected.push({
            name: c.name,
            symbol,
            reason: "株価が取得できませんでした（存在しないコード、または上場廃止の可能性）",
          });
          return;
        }

        const profile = await fetchCompanyProfile(symbol).catch(() => null);

        const target = resolveTargetPrice(c.targetPrice, quote.price);

        verified.push({
          ...c,
          symbol,
          verifiedName: quote.longName ?? quote.shortName ?? c.name,
          currentPrice: quote.price,
          currency: quote.currency,
          fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
          sector: profile?.sector ?? null,
          industry: profile?.industry ?? null,
          marketLabel: marketLabel(c.market as Market),
          targetPrice: target.targetPrice ?? c.targetPrice,
          gapToTargetPct: target.gapPct,
          targetAdjustedNote: target.note,
        });
      } catch (e) {
        rejected.push({
          name: c.name,
          symbol,
          reason: e instanceof Error ? e.message : "検証中にエラーが発生しました",
        });
      }
    })
  );

  // 優先度順に並べる（HIGH が先）
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  verified.sort((a, b) => order[a.priority] - order[b.priority]);

  return { gaps: result.gaps, candidates: verified, overview: result.overview, rejected };
}

/**
 * 提案された候補をウォッチリストに取り込む。
 *
 * 目標価格は AI が提案した値を使うが、価格帯そのものは作らない。
 * 価格帯の生成は 1 銘柄 20 秒前後かかり、取り込み時に全件まとめて作ると
 * リクエスト上限（180 秒）を超えるため、取り込み後に個別に生成する。
 */
export async function addCandidatesToWatchlist(
  userId: number,
  candidates: Array<{
    symbol: string;
    name: string;
    market: string;
    priority: "HIGH" | "MEDIUM" | "LOW";
    targetPrice: number | null;
    reason: string;
    concern: string;
  }>
): Promise<{ added: number; skipped: string[] }> {
  const existing = await db.listWatchlist(userId);
  const existingSymbols = new Set(existing.map(w => w.symbol.toUpperCase()));

  let added = 0;
  const skipped: string[] = [];

  for (const c of candidates) {
    const symbol = c.symbol.trim().toUpperCase();
    if (existingSymbols.has(symbol)) {
      skipped.push(symbol);
      continue;
    }

    const quote = await fetchQuote(symbol).catch(() => null);
    if (!quote || quote.price === null) {
      skipped.push(symbol);
      continue;
    }

    const profile = await fetchCompanyProfile(symbol).catch(() => null);

    /*
     * 注目理由には AI の理由と懸念の両方を入れる。
     * 理由だけ残すと、後から見たときに良い面しか思い出せず
     * 「なぜ待っていたのか」の判断材料が片方だけになる。
     */
    await db.insertWatchItem({
      userId,
      symbol,
      tickerCode: symbol.replace(/\.(T|SI|HK)$/i, ""),
      name: quote.longName ?? quote.shortName ?? c.name,
      market: c.market as Market,
      currency: quote.currency,
      priority: c.priority,
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
      currentPrice: quote.price != null ? String(quote.price) : null,
      targetPrice: c.targetPrice != null ? String(c.targetPrice) : null,
      priceUpdatedAt: new Date(),
      watchReason: `${c.reason}\n\n【懸念】${c.concern}`,
    });

    existingSymbols.add(symbol);
    added += 1;
  }

  return { added, skipped };
}
