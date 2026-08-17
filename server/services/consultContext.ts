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
import { newsItems } from "../../drizzle/schema";
import { buildPortfolio } from "./portfolio";
import { listPlanOverview } from "./priceBandService";

/** 個別に明細を渡す銘柄数。多すぎると重要な情報が埋もれる */
export const TOP_HOLDINGS_LIMIT = 12;

/** 相談対象銘柄について渡すニュース件数 */
export const SYMBOL_NEWS_LIMIT = 6;

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
  focusSymbol?: string | null
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

  const div = overview.dividends;

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
