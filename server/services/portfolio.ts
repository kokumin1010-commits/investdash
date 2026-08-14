import type { Holding, WatchlistItem } from "../../drizzle/schema";
import * as db from "../db";
import {
  analyzeNewsBatch,
  generateSignal,
  generateWatchSignal,
  type SignalContext,
} from "./analysis";
import { fetchCompanyProfile, fetchPriceHistory, fetchQuotes } from "./marketData";
import { buildNewsQuery, filterNoise, searchNews } from "./news";
import { BROKER_LABELS, type Broker } from "../../shared/investing";

/**
 * 保有ポジションとウォッチリストに対する横断処理。
 * ルーターから呼ばれるユースケース層。
 */

const n = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

export type PositionView = {
  id: number;
  symbol: string;
  tickerCode: string;
  name: string;
  market: "JP" | "US" | "OTHER";
  currency: string;
  /** どの証券プラットフォームで保有しているか */
  broker: "moomoo_jp" | "rakuten_ispeed" | "futu" | "other";
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  businessSummary: string | null;
  /** 現地通貨での評価額 */
  marketValue: number | null;
  costValue: number;
  pnl: number | null;
  pnlPct: number | null;
  dayChangePct: number | null;
  /** 基準通貨（JPY）換算の評価額 */
  marketValueBase: number | null;
  costValueBase: number;
  weightPct: number | null;
  priceUpdatedAt: Date | null;
  hasCard: boolean;
  signal: {
    action: "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT";
    confidence: number | null;
    rationale: string;
    createdAt: Date;
  } | null;
  newsCount: number;
  negativeNewsCount: number;
};

export type PortfolioSummary = {
  totalValueBase: number;
  totalCostBase: number;
  totalPnl: number;
  totalPnlPct: number | null;
  dayChangeBase: number | null;
  dayChangePct: number | null;
  positionCount: number;
  cashBalance: number;
  totalAssets: number;
  baseCurrency: string;
  usdJpyRate: number;
  lastPriceSyncAt: Date | null;
  lastNewsSyncAt: Date | null;
  /** 価格未取得の銘柄数 */
  missingPriceCount: number;
};

export type SectorSlice = { key: string; label: string; value: number; pct: number; count: number };

/** 証券プラットフォーム別の内訳。口座ごとの成績を比較できるよう損益も持たせる */
export type BrokerSlice = SectorSlice & { pnl: number; pnlPct: number | null };

export type ConcentrationAlert = {
  level: "HIGH" | "MEDIUM";
  kind: "POSITION" | "SECTOR" | "CURRENCY";
  label: string;
  pct: number;
  threshold: number;
  message: string;
};

/**
 * 保有一覧を計算済みビューに変換する。
 */
export async function buildPortfolio(userId: number): Promise<{
  positions: PositionView[];
  summary: PortfolioSummary;
  sectors: SectorSlice[];
  currencies: SectorSlice[];
  brokers: BrokerSlice[];
  alerts: ConcentrationAlert[];
}> {
  const [rows, settings, signalMap, cards, allNews] = await Promise.all([
    db.listHoldings(userId),
    db.getSettings(userId),
    db.latestSignals(userId),
    db.listCards(userId),
    db.listNews(userId, { limit: 500 }),
  ]);

  const usdJpy = n(settings.usdJpyRate) ?? 150;
  const cardSymbols = new Set(cards.map(c => c.symbol));

  const newsBySymbol = new Map<string, { total: number; negative: number }>();
  for (const item of allNews) {
    const entry = newsBySymbol.get(item.symbol) ?? { total: 0, negative: 0 };
    entry.total += 1;
    if (item.sentiment === "NEGATIVE" && (item.impactScore ?? 0) >= 40) entry.negative += 1;
    newsBySymbol.set(item.symbol, entry);
  }

  const toBase = (value: number | null, currency: string): number | null => {
    if (value === null) return null;
    if (currency === "JPY") return value;
    if (currency === "USD") return value * usdJpy;
    return value;
  };

  const partial = rows.map(h => {
    const quantity = n(h.quantity) ?? 0;
    const avgCost = n(h.avgCost) ?? 0;
    const currentPrice = n(h.currentPrice);
    const previousClose = n(h.previousClose);
    const marketValue = currentPrice === null ? null : currentPrice * quantity;
    const costValue = avgCost * quantity;
    const pnl = marketValue === null ? null : marketValue - costValue;
    const pnlPct = pnl === null || costValue === 0 ? null : (pnl / costValue) * 100;
    const dayChangePct =
      currentPrice === null || previousClose === null || previousClose === 0
        ? null
        : ((currentPrice - previousClose) / previousClose) * 100;
    const sig = signalMap.get(h.symbol);
    const newsStat = newsBySymbol.get(h.symbol) ?? { total: 0, negative: 0 };

    return {
      id: h.id,
      symbol: h.symbol,
      tickerCode: h.tickerCode,
      name: h.name,
      market: h.market,
      currency: h.currency,
      broker: h.broker,
      quantity,
      avgCost,
      currentPrice,
      previousClose,
      fiftyTwoWeekHigh: n(h.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: n(h.fiftyTwoWeekLow),
      sector: h.sector,
      industry: h.industry,
      website: h.website,
      businessSummary: h.businessSummary,
      marketValue,
      costValue,
      pnl,
      pnlPct,
      dayChangePct,
      marketValueBase: toBase(marketValue, h.currency),
      costValueBase: toBase(costValue, h.currency) ?? costValue,
      weightPct: null as number | null,
      priceUpdatedAt: h.priceUpdatedAt,
      hasCard: cardSymbols.has(h.symbol),
      signal: sig
        ? {
            action: sig.action,
            confidence: sig.confidence,
            rationale: sig.rationale,
            createdAt: sig.createdAt,
          }
        : null,
      newsCount: newsStat.total,
      negativeNewsCount: newsStat.negative,
    } satisfies PositionView;
  });

  const totalValueBase = partial.reduce((acc, p) => acc + (p.marketValueBase ?? 0), 0);
  const totalCostBase = partial.reduce((acc, p) => acc + p.costValueBase, 0);

  const positions = partial
    .map(p => ({
      ...p,
      weightPct:
        totalValueBase > 0 && p.marketValueBase !== null
          ? (p.marketValueBase / totalValueBase) * 100
          : null,
    }))
    .sort((a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0));

  const prevValueBase = partial.reduce((acc, p) => {
    if (p.previousClose === null) return acc + (p.marketValueBase ?? 0);
    const prev = p.previousClose * p.quantity;
    return acc + (toBase(prev, p.currency) ?? prev);
  }, 0);

  const dayChangeBase = prevValueBase > 0 ? totalValueBase - prevValueBase : null;
  const cashBalance = n(settings.cashBalance) ?? 0;

  const summary: PortfolioSummary = {
    totalValueBase,
    totalCostBase,
    totalPnl: totalValueBase - totalCostBase,
    totalPnlPct:
      totalCostBase > 0 ? ((totalValueBase - totalCostBase) / totalCostBase) * 100 : null,
    dayChangeBase,
    dayChangePct:
      dayChangeBase !== null && prevValueBase > 0 ? (dayChangeBase / prevValueBase) * 100 : null,
    positionCount: positions.length,
    cashBalance,
    totalAssets: totalValueBase + cashBalance,
    baseCurrency: settings.baseCurrency,
    usdJpyRate: usdJpy,
    lastPriceSyncAt: settings.lastPriceSyncAt,
    lastNewsSyncAt: settings.lastNewsSyncAt,
    missingPriceCount: positions.filter(p => p.currentPrice === null).length,
  };

  /* --- 分布集計 --- */
  const sectorMap = new Map<string, { value: number; count: number }>();
  const currencyMap = new Map<string, { value: number; count: number }>();
  const brokerMap = new Map<string, { value: number; count: number; cost: number }>();

  for (const p of positions) {
    const v = p.marketValueBase ?? 0;
    const sKey = p.sector ?? "未分類";
    const s = sectorMap.get(sKey) ?? { value: 0, count: 0 };
    s.value += v;
    s.count += 1;
    sectorMap.set(sKey, s);

    const c = currencyMap.get(p.currency) ?? { value: 0, count: 0 };
    c.value += v;
    c.count += 1;
    currencyMap.set(p.currency, c);

    const b = brokerMap.get(p.broker) ?? { value: 0, count: 0, cost: 0 };
    b.value += v;
    b.count += 1;
    b.cost += p.costValueBase;
    brokerMap.set(p.broker, b);
  }

  const toSlices = (m: Map<string, { value: number; count: number }>): SectorSlice[] =>
    Array.from(m.entries())
      .map(([key, v]) => ({
        key,
        label: key,
        value: v.value,
        pct: totalValueBase > 0 ? (v.value / totalValueBase) * 100 : 0,
        count: v.count,
      }))
      .sort((a, b) => b.value - a.value);

  /* --- 集中度アラート --- */
  const alerts: ConcentrationAlert[] = [];
  const posThreshold = settings.concentrationThreshold;
  const secThreshold = settings.sectorConcentrationThreshold;

  for (const p of positions) {
    if (p.weightPct !== null && p.weightPct >= posThreshold) {
      alerts.push({
        level: p.weightPct >= posThreshold * 1.5 ? "HIGH" : "MEDIUM",
        kind: "POSITION",
        label: p.name,
        pct: p.weightPct,
        threshold: posThreshold,
        message: `${p.name} が資産の ${p.weightPct.toFixed(1)}% を占めています（しきい値 ${posThreshold}%）。単一銘柄への集中リスクを確認してください。`,
      });
    }
  }

  for (const s of toSlices(sectorMap)) {
    if (s.pct >= secThreshold && s.key !== "未分類") {
      alerts.push({
        level: s.pct >= secThreshold * 1.4 ? "HIGH" : "MEDIUM",
        kind: "SECTOR",
        label: s.key,
        pct: s.pct,
        threshold: secThreshold,
        message: `${s.key} セクターが ${s.pct.toFixed(1)}%（${s.count} 銘柄）を占めています（しきい値 ${secThreshold}%）。業種分散を確認してください。`,
      });
    }
  }

  return {
    positions,
    summary,
    sectors: toSlices(sectorMap),
    currencies: toSlices(currencyMap),
    brokers: Array.from(brokerMap.entries())
      .map(([key, v]) => ({
        key,
        label: BROKER_LABELS[key as Broker] ?? key,
        value: v.value,
        pct: totalValueBase > 0 ? (v.value / totalValueBase) * 100 : 0,
        count: v.count,
        /** 口座単位の含み損益。口座ごとの成績を比較できるようにする */
        pnl: v.value - v.cost,
        pnlPct: v.cost > 0 ? ((v.value - v.cost) / v.cost) * 100 : null,
      }))
      .sort((a, b) => b.value - a.value),
    alerts: alerts.sort((a, b) => b.pct - a.pct),
  };
}

/**
 * 保有・ウォッチリスト全銘柄の株価を更新する。
 */
export async function syncPrices(userId: number): Promise<{
  updated: number;
  failed: string[];
}> {
  const [hs, ws] = await Promise.all([db.listHoldings(userId), db.listWatchlist(userId)]);
  const symbols = [...hs.map(h => h.symbol), ...ws.map(w => w.symbol)];
  if (symbols.length === 0) {
    await db.updateSettings(userId, { lastPriceSyncAt: new Date() });
    return { updated: 0, failed: [] };
  }

  const quotes = await fetchQuotes(symbols);
  const failed: string[] = [];
  let updated = 0;
  const now = new Date();

  for (const h of hs) {
    const q = quotes.get(h.symbol);
    if (!q || q.price === null) {
      failed.push(h.symbol);
      continue;
    }
    await db.updateHolding(userId, h.id, {
      currentPrice: String(q.price),
      previousClose: q.previousClose === null ? undefined : String(q.previousClose),
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh === null ? undefined : String(q.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: q.fiftyTwoWeekLow === null ? undefined : String(q.fiftyTwoWeekLow),
      currency: q.currency,
      priceUpdatedAt: now,
    });
    updated += 1;
  }

  for (const w of ws) {
    const q = quotes.get(w.symbol);
    if (!q || q.price === null) {
      failed.push(w.symbol);
      continue;
    }
    await db.updateWatchItem(userId, w.id, {
      currentPrice: String(q.price),
      previousClose: q.previousClose === null ? undefined : String(q.previousClose),
      currency: q.currency,
      priceUpdatedAt: now,
    });
    updated += 1;
  }

  await db.updateSettings(userId, { lastPriceSyncAt: now });

  // ポートフォリオ推移用のスナップショットを保存
  try {
    const { summary } = await buildPortfolio(userId);
    if (summary.positionCount > 0) {
      await db.insertSnapshot({
        userId,
        totalValue: summary.totalValueBase.toFixed(2),
        totalCost: summary.totalCostBase.toFixed(2),
        positionCount: summary.positionCount,
      });
    }
  } catch (error) {
    console.warn("[portfolio] snapshot failed:", error);
  }

  return { updated, failed: Array.from(new Set(failed)) };
}

/**
 * 企業プロファイル（セクター等）が未取得の銘柄を補完する。
 */
export async function enrichProfiles(userId: number, force = false): Promise<number> {
  const hs = await db.listHoldings(userId);
  const targets = force ? hs : hs.filter(h => !h.sector || !h.profileUpdatedAt);
  let count = 0;

  for (const h of targets.slice(0, 20)) {
    const p = await fetchCompanyProfile(h.symbol);
    if (!p) continue;
    await db.updateHolding(userId, h.id, {
      sector: p.sector ?? undefined,
      industry: p.industry ?? undefined,
      website: p.website ?? undefined,
      businessSummary: p.businessSummary ?? undefined,
      profileUpdatedAt: new Date(),
    });
    count += 1;
  }

  const ws = await db.listWatchlist(userId);
  for (const w of (force ? ws : ws.filter(x => !x.sector)).slice(0, 20)) {
    const p = await fetchCompanyProfile(w.symbol);
    if (!p) continue;
    await db.updateWatchItem(userId, w.id, {
      sector: p.sector ?? undefined,
      industry: p.industry ?? undefined,
    });
    count += 1;
  }

  return count;
}

type NewsTarget = { symbol: string; name: string; tickerCode: string; market: "JP" | "US" | "OTHER" };

/**
 * 指定銘柄のニュースを取得し、AI 判定して保存する。
 */
export async function syncNewsForTargets(
  userId: number,
  targets: NewsTarget[],
  opts: { windowDays?: number } = {}
): Promise<{ fetched: number; analyzed: number }> {
  let fetched = 0;
  let analyzed = 0;

  for (const t of targets) {
    try {
      const query = buildNewsQuery(t);
      const raw = filterNoise(
        await searchNews(query, { market: t.market, windowDays: opts.windowDays ?? 30, limit: 14 })
      );
      if (raw.length === 0) continue;

      const existing = await db.existingNewsHashes(
        userId,
        raw.map(r => r.urlHash)
      );
      const fresh = raw.filter(r => !existing.has(r.urlHash));
      if (fresh.length === 0) continue;

      await db.insertNews(
        fresh.map(r => ({
          userId,
          symbol: t.symbol,
          title: r.title,
          url: r.url,
          urlHash: r.urlHash,
          source: r.source ?? undefined,
          publishedAt: r.publishedAt ?? undefined,
        }))
      );
      fetched += fresh.length;

      const verdicts = await analyzeNewsBatch(t.name, fresh);
      for (const v of verdicts) {
        await db.updateNewsVerdict(userId, v.urlHash, {
          sentiment: v.sentiment,
          impactScore: v.impactScore,
          summary: v.summary,
          reasoning: v.reasoning,
        });
        analyzed += 1;
      }
    } catch (error) {
      console.warn(`[portfolio] news sync failed for ${t.symbol}:`, error);
    }
  }

  await db.updateSettings(userId, { lastNewsSyncAt: new Date() });
  return { fetched, analyzed };
}

export async function syncNewsForUser(userId: number): Promise<{ fetched: number; analyzed: number }> {
  const [hs, ws] = await Promise.all([db.listHoldings(userId), db.listWatchlist(userId)]);
  const targets: NewsTarget[] = [
    ...hs.map(h => ({ symbol: h.symbol, name: h.name, tickerCode: h.tickerCode, market: h.market })),
    ...ws.map(w => ({ symbol: w.symbol, name: w.name, tickerCode: w.tickerCode, market: w.market })),
  ];
  return syncNewsForTargets(userId, targets);
}

/**
 * 1 銘柄のシグナルを生成して保存する。
 */
export async function regenerateSignal(userId: number, holding: Holding) {
  const [card, news, portfolio, history] = await Promise.all([
    db.getCard(userId, holding.symbol),
    db.listNews(userId, { symbol: holding.symbol, limit: 12 }),
    buildPortfolio(userId),
    fetchPriceHistory(holding.symbol, "6mo", "1d"),
  ]);

  const view = portfolio.positions.find(p => p.id === holding.id);

  const returnOver = (days: number): number | null => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const cutoff = last.t - days * 24 * 60 * 60 * 1000;
    const base = history.find(b => b.t >= cutoff);
    if (!base || base.c === 0) return null;
    return ((last.c - base.c) / base.c) * 100;
  };

  const ctx: SignalContext = {
    name: holding.name,
    symbol: holding.symbol,
    currency: holding.currency,
    quantity: Number(holding.quantity),
    avgCost: Number(holding.avgCost),
    currentPrice: view?.currentPrice ?? null,
    pnlPct: view?.pnlPct ?? null,
    weightPct: view?.weightPct ?? null,
    sector: holding.sector,
    industry: holding.industry,
    fiftyTwoWeekHigh: view?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: view?.fiftyTwoWeekLow ?? null,
    return1m: returnOver(30),
    return3m: returnOver(90),
    card: card
      ? {
          buyReason: card.buyReason,
          coreThesis: card.coreThesis,
          valuationAssumption: card.valuationAssumption,
          fairValue: card.fairValue ? Number(card.fairValue) : null,
          keyFinancials: card.keyFinancials,
          exitConditions: card.exitConditions,
          risks: card.risks,
        }
      : null,
    news: news.map(x => ({
      title: x.title,
      sentiment: x.sentiment,
      impactScore: x.impactScore,
      summary: x.summary,
      publishedAt: x.publishedAt,
    })),
  };

  const result = await generateSignal(ctx);

  await db.insertSignal({
    userId,
    symbol: holding.symbol,
    action: result.action,
    confidence: result.confidence,
    rationale: result.rationale,
    factors: result.factors,
    priceAtSignal: view?.currentPrice !== null && view?.currentPrice !== undefined ? String(view.currentPrice) : undefined,
    pnlPctAtSignal: view?.pnlPct !== null && view?.pnlPct !== undefined ? view.pnlPct.toFixed(4) : undefined,
    scope: "HOLDING",
  });

  return result;
}

export async function regenerateWatchSignal(userId: number, item: WatchlistItem) {
  const news = await db.listNews(userId, { symbol: item.symbol, limit: 10 });
  const result = await generateWatchSignal({
    name: item.name,
    symbol: item.symbol,
    currency: item.currency,
    currentPrice: item.currentPrice ? Number(item.currentPrice) : null,
    targetPrice: item.targetPrice ? Number(item.targetPrice) : null,
    buyConditions: item.buyConditions,
    watchReason: item.watchReason,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    news: news.map(x => ({
      title: x.title,
      sentiment: x.sentiment,
      impactScore: x.impactScore,
      summary: x.summary,
    })),
  });

  await db.insertSignal({
    userId,
    symbol: item.symbol,
    action: result.action,
    confidence: result.confidence,
    rationale: result.rationale,
    factors: result.factors,
    priceAtSignal: item.currentPrice ?? undefined,
    scope: "WATCHLIST",
  });

  return result;
}
