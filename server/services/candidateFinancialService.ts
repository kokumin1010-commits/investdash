import { inArray } from "drizzle-orm";
import { candidateFinancialSnapshots } from "../../drizzle/schema";
import {
  CANDIDATE_FINANCIAL_SOURCE,
  CANDIDATE_FINANCIAL_VERSION,
  normalizeCandidateFinancialMetrics,
  type CandidateCardInsight,
  type CandidateFinancialMetrics,
  type CandidateFinancialSeries,
  type CandidateFinancialSeriesPoint,
  type CandidateSizingView,
} from "../../shared/candidateFinancialMetrics";
import { normalizeSymbol } from "../../shared/investing";
import { computePortfolioPositionSizing } from "../../shared/portfolioPositionSizing";
import { getDb } from "../db";
import * as dbq from "../db";
import { summarizeDividends } from "./dividend";
import { convertToJpy } from "./fx";
import {
  fetchCompanyProfile,
  fetchDividendHistory,
  fetchQuote,
} from "./marketData";
import { buildPortfolio } from "./portfolio";

const PUBLIC_YAHOO_TIMESERIES =
  "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const FETCH_CONCURRENCY = 4;
const MAX_SYMBOLS = 60;

const FUNDAMENTAL_TYPES = [
  "trailingPeRatio",
  "trailingMarketCap",
  "annualTotalRevenue",
  "annualOperatingIncome",
  "annualNetIncome",
  "annualDilutedEPS",
  "annualFreeCashFlow",
  "annualStockholdersEquity",
  "annualInvestedCapital",
  "annualTotalDebt",
  "annualNetDebt",
  "annualCashCashEquivalentsAndShortTermInvestments",
  "annualCashAndCashEquivalents",
  "annualCommonStockDividendPaid",
  "annualDividendPerShare",
  "annualTaxProvision",
  "annualPretaxIncome",
] as const;

type FinancialContext = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  currency: string | null;
};

type YahooSeriesRawPoint = {
  asOfDate?: unknown;
  periodType?: unknown;
  currencyCode?: unknown;
  reportedValue?: { raw?: unknown };
};

type YahooSeriesRawResult = {
  meta?: { type?: unknown };
  [key: string]: unknown;
};

type YahooSeriesResponse = {
  timeseries?: {
    result?: YahooSeriesRawResult[];
    error?: unknown;
  };
};

function normalizeRequestedSymbols(symbols: string[]): string[] {
  return Array.from(
    new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))
  ).slice(0, MAX_SYMBOLS);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metricType(result: YahooSeriesRawResult): string | null {
  const raw = result.meta?.type;
  if (Array.isArray(raw)) return stringValue(raw[0]);
  return stringValue(raw);
}

function parseFinancialSeries(payload: YahooSeriesResponse): CandidateFinancialSeries {
  if (payload.timeseries?.error) {
    throw new Error(`Yahoo fundamentals error: ${JSON.stringify(payload.timeseries.error)}`);
  }
  const out: CandidateFinancialSeries = {};
  for (const result of payload.timeseries?.result ?? []) {
    const type = metricType(result);
    if (!type) continue;
    const rawPoints = Array.isArray(result[type])
      ? (result[type] as YahooSeriesRawPoint[])
      : [];
    const parsed = rawPoints.flatMap(point => {
      const asOfDate = stringValue(point.asOfDate);
      const value = numericValue(point.reportedValue?.raw);
      if (!asOfDate || value === null) return [];
      return [
        {
          asOfDate,
          periodType: stringValue(point.periodType),
          currencyCode: stringValue(point.currencyCode),
          value,
        } satisfies CandidateFinancialSeriesPoint,
      ];
    });
    out[type] = parsed;
  }
  return out;
}

async function fetchPublicFinancialSeries(symbol: string): Promise<CandidateFinancialSeries> {
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - 4 * 366 * 24 * 60 * 60;
  const params = new URLSearchParams({
    symbol,
    type: FUNDAMENTAL_TYPES.join(","),
    merge: "false",
    period1: String(startSec),
    period2: String(nowSec),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${PUBLIC_YAHOO_TIMESERIES}/${encodeURIComponent(symbol)}?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; InvestDash/1.0)",
        },
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      throw new Error(
        `Yahoo fundamentals failed (${response.status} ${response.statusText})`
      );
    }
    return parseFinancialSeries((await response.json()) as YahooSeriesResponse);
  } finally {
    clearTimeout(timer);
  }
}

function unavailableMetrics(
  context: FinancialContext,
  fetchedAt: Date,
  error: string
): CandidateFinancialMetrics {
  const metrics = normalizeCandidateFinancialMetrics({
    symbol: context.symbol,
    sector: context.sector,
    industry: context.industry,
    currentPrice: null,
    priceCurrency: context.currency,
    priceAsOfDate: null,
    fetchedAt: fetchedAt.toISOString(),
    series: {},
    dividend: {
      available: false,
      recurringAnnualDividend: null,
      count: 0,
      lastDate: null,
      hasSpecialDividend: false,
    },
  });
  return { ...metrics, notes: [...metrics.notes, `取得エラー: ${error}`] };
}

async function fetchCandidateFinancialMetrics(
  context: FinancialContext,
  now: Date
): Promise<CandidateFinancialMetrics> {
  const [quote, series, dividendHistory, profile] = await Promise.all([
    fetchQuote(context.symbol),
    fetchPublicFinancialSeries(context.symbol),
    fetchDividendHistory(context.symbol),
    context.sector && context.industry
      ? Promise.resolve(null)
      : fetchCompanyProfile(context.symbol),
  ]);
  const dividendSummary = dividendHistory
    ? summarizeDividends(dividendHistory.dividends, dividendHistory.splits, now)
    : null;
  return normalizeCandidateFinancialMetrics({
    symbol: context.symbol,
    sector: context.sector ?? profile?.sector ?? null,
    industry: context.industry ?? profile?.industry ?? null,
    currentPrice: quote?.price ?? null,
    priceCurrency: quote?.currency ?? context.currency,
    priceAsOfDate: quote?.marketTime
      ? quote.marketTime.toISOString().slice(0, 10)
      : null,
    fetchedAt: now.toISOString(),
    series,
    dividend: dividendSummary
      ? {
          available: true,
          recurringAnnualDividend: dividendSummary.recurringDividend,
          count: dividendSummary.count,
          lastDate: dividendSummary.lastDate
            ? dividendSummary.lastDate.toISOString().slice(0, 10)
            : null,
          hasSpecialDividend: dividendSummary.hasSpecialDividend,
        }
      : {
          available: false,
          recurringAnnualDividend: null,
          count: 0,
          lastDate: null,
          hasSpecialDividend: false,
        },
  });
}

function isCandidateFinancialMetrics(value: unknown): value is CandidateFinancialMetrics {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CandidateFinancialMetrics>;
  return (
    row.version === CANDIDATE_FINANCIAL_VERSION &&
    typeof row.symbol === "string" &&
    Boolean(row.metrics) &&
    typeof row.fetchedAt === "string"
  );
}

async function saveSnapshot(
  symbol: string,
  payload: CandidateFinancialMetrics,
  fetchedAt: Date,
  expiresAt: Date,
  lastError: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できませんでした");
  await db
    .insert(candidateFinancialSnapshots)
    .values({
      symbol,
      source: CANDIDATE_FINANCIAL_SOURCE,
      payload,
      lastError,
      fetchedAt,
      expiresAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        source: CANDIDATE_FINANCIAL_SOURCE,
        payload,
        lastError,
        fetchedAt,
        expiresAt,
      },
    });
}

export async function getCandidateFinancialMetricsBatch(
  contexts: FinancialContext[],
  now = new Date()
): Promise<Map<string, CandidateFinancialMetrics>> {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できませんでした");
  const symbols = normalizeRequestedSymbols(contexts.map(context => context.symbol));
  if (symbols.length === 0) return new Map();
  const contextMap = new Map(
    contexts
      .filter(context => symbols.includes(context.symbol.trim().toUpperCase()))
      .map(context => [context.symbol.trim().toUpperCase(), context])
  );
  const rows = await db
    .select()
    .from(candidateFinancialSnapshots)
    .where(inArray(candidateFinancialSnapshots.symbol, symbols));
  const rowMap = new Map(rows.map(row => [row.symbol, row]));
  const out = new Map<string, CandidateFinancialMetrics>();
  const refresh: string[] = [];

  for (const symbol of symbols) {
    const row = rowMap.get(symbol);
    if (
      row &&
      row.expiresAt.getTime() > now.getTime() &&
      isCandidateFinancialMetrics(row.payload)
    ) {
      out.set(symbol, row.payload);
    } else {
      refresh.push(symbol);
    }
  }

  for (let i = 0; i < refresh.length; i += FETCH_CONCURRENCY) {
    const batch = refresh.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async symbol => {
        const context = contextMap.get(symbol) ?? {
          symbol,
          sector: null,
          industry: null,
          currency: null,
        };
        try {
          const metrics = await fetchCandidateFinancialMetrics(context, now);
          await saveSnapshot(
            symbol,
            metrics,
            now,
            new Date(now.getTime() + SNAPSHOT_TTL_MS),
            null
          );
          return [symbol, metrics] as const;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[candidateFinancial] ${symbol} refresh failed:`, error);
          const stale = rowMap.get(symbol)?.payload;
          if (isCandidateFinancialMetrics(stale)) {
            const fallback: CandidateFinancialMetrics = {
              ...stale,
              notes: [
                ...stale.notes,
                "最新更新に失敗したため前回snapshotを表示しています",
              ],
            };
            const originalFetchedAt = new Date(stale.fetchedAt);
            await saveSnapshot(
              symbol,
              stale,
              Number.isFinite(originalFetchedAt.getTime())
                ? originalFetchedAt
                : now,
              new Date(now.getTime() + FAILURE_TTL_MS),
              message.slice(0, 4000)
            );
            return [
              symbol,
              fallback,
            ] as const;
          }
          const metrics = unavailableMetrics(context, now, message);
          await saveSnapshot(
            symbol,
            metrics,
            now,
            new Date(now.getTime() + FAILURE_TTL_MS),
            message.slice(0, 4000)
          );
          return [symbol, metrics] as const;
        }
      })
    );
    results.forEach(([symbol, metrics]) => out.set(symbol, metrics));
  }
  return out;
}

function trancheLabel(tranchePct: number): string {
  if (tranchePct >= 50) return `目標枠の${tranchePct}%（主力1回分）`;
  if (tranchePct > 0) return `目標枠の${tranchePct}%（初回1回分）`;
  return "現在は買付段階ではありません";
}

function buildSizingView(input: {
  symbol: string;
  currency: string | null;
  currentQuantity: number;
  targetPrice: number | null;
  currentPrice: number | null;
  financials: CandidateFinancialMetrics;
  sizing: ReturnType<typeof computePortfolioPositionSizing>;
}): CandidateSizingView {
  const held = input.currentQuantity > 0;
  const priceWait =
    !held &&
    input.targetPrice !== null &&
    input.targetPrice > 0 &&
    input.currentPrice !== null &&
    input.currentPrice > input.targetPrice;
  const engineBuy = input.sizing.status === "BUY";
  const financialGate = input.financials.dataQuality !== "UNAVAILABLE";
  const showReferenceAmount = !held && engineBuy && financialGate;
  const status: CandidateSizingView["status"] = held
    ? "HELD"
    : !showReferenceAmount
      ? "UNAVAILABLE"
      : priceWait
        ? "PRICE_WAIT"
        : "RESEARCH_ONLY";
  const basisPrice =
    priceWait && input.targetPrice !== null ? input.targetPrice : input.currentPrice;
  const constraints = [...input.sizing.reasons];
  if (!financialGate) {
    constraints.unshift("必須財務指標を確認できないため初回数量を確定しません");
  }
  if (priceWait && input.targetPrice !== null) {
    constraints.unshift(`現在値ではなく目標価格 ${input.targetPrice} を前提にした参考量です`);
  }
  if (held) {
    constraints.unshift("全口座合計で保有中のため、初回建仓ではありません");
  }
  const nextTrancheCondition = priceWait
    ? `目標価格 ${input.targetPrice} ${input.currency ?? ""} 到達後に財務・価格帯を再確認`
    : "次の価格帯到達または次回決算確認後に再判定";

  return {
    status,
    engineStatus: input.sizing.status,
    currentQuantity: input.currentQuantity,
    currentWeightPct: input.sizing.currentWeightPct,
    recommendedShares: showReferenceAmount ? input.sizing.shares : null,
    recommendedAmountLocal: showReferenceAmount
      ? input.sizing.amountLocal
      : null,
    recommendedAmountBase: showReferenceAmount ? input.sizing.amountBase : null,
    afterQuantity: showReferenceAmount
      ? input.currentQuantity + input.sizing.shares
      : null,
    afterWeightPct: showReferenceAmount ? input.sizing.afterWeightPct : null,
    currency: input.currency,
    tranchePct: input.sizing.tranchePct,
    trancheCount:
      input.sizing.tranchePct > 0
        ? Math.ceil(100 / input.sizing.tranchePct)
        : null,
    trancheLabel: trancheLabel(input.sizing.tranchePct),
    nextTrancheCondition,
    constraints,
    fundingMode: "CASH_ONLY",
    basis: `既存portfolioPositionSizing／${basisPrice ?? "価格未取得"} ${input.currency ?? ""}基準。分析用参考で自動注文しません`,
  };
}

export async function buildCandidateCardInsights(
  userId: number,
  requestedSymbols: string[],
  now = new Date()
): Promise<CandidateCardInsight[]> {
  const symbols = normalizeRequestedSymbols(requestedSymbols);
  if (symbols.length === 0) return [];
  const [portfolio, settings, watchItems, candidateRows] = await Promise.all([
    buildPortfolio(userId),
    dbq.getSettings(userId),
    dbq.listWatchlist(userId),
    dbq.listCandidateSuggestions(userId, 200),
  ]);
  const groupMap = new Map(portfolio.groups.map(group => [group.symbol, group]));
  const watchMap = new Map(watchItems.map(item => [item.symbol, item]));
  const candidateMap = new Map(candidateRows.map(item => [item.symbol, item]));
  const contexts: FinancialContext[] = symbols.map(symbol => {
    const group = groupMap.get(symbol);
    const watch = watchMap.get(symbol);
    const candidate = candidateMap.get(symbol);
    return {
      symbol,
      sector: group?.sector ?? watch?.sector ?? candidate?.sector ?? null,
      industry: group?.industry ?? watch?.industry ?? candidate?.industry ?? null,
      currency: group?.currency ?? watch?.currency ?? candidate?.currency ?? null,
    };
  });
  const metricMap = await getCandidateFinancialMetricsBatch(contexts, now);
  const ibkr = portfolio.brokers.find(item => item.key === "ibkr")?.leverage ?? null;
  const rates = {
    usdJpy: portfolio.summary.usdJpyRate,
    sgdJpy: portfolio.summary.sgdJpyRate,
    hkdJpy: portfolio.summary.hkdJpyRate,
  };
  const liquidAssetsBase =
    portfolio.summary.cashBalance + portfolio.summary.interestAssetsBase;

  return symbols.flatMap(symbol => {
    const financials = metricMap.get(symbol);
    if (!financials) return [];
    const group = groupMap.get(symbol);
    const watch = watchMap.get(symbol);
    const candidate = candidateMap.get(symbol);
    const sector = group?.sector ?? watch?.sector ?? candidate?.sector ?? null;
    const currency =
      financials.currency ?? group?.currency ?? watch?.currency ?? candidate?.currency ?? null;
    const targetPrice = watch?.targetPrice
      ? Number(watch.targetPrice)
      : candidate?.targetPrice
        ? Number(candidate.targetPrice)
        : null;
    const currentPrice = financials.currentPrice;
    const sizingPrice =
      targetPrice !== null &&
      targetPrice > 0 &&
      currentPrice !== null &&
      currentPrice > targetPrice
        ? targetPrice
        : currentPrice;
    const sectorValueBase =
      portfolio.sectors.find(item => item.key === sector)?.value ?? 0;
    const sizing = computePortfolioPositionSizing({
      action: "ADD_SMALL",
      priority: watch?.priority ?? candidate?.priority ?? "MEDIUM",
      market: normalizeSymbol(symbol).market,
      localPrice: sizingPrice,
      yenPerLocalUnit: currency ? convertToJpy(1, currency, rates) : null,
      netAssetsBase: portfolio.summary.netAssetsBase,
      liquidAssetsBase,
      currentHoldingBase: group?.marketValueBase ?? 0,
      sectorValueBase,
      userSectorLimitPct: settings.sectorConcentrationThreshold,
      ibkrLeverage: ibkr?.leverage ?? null,
      ibkrRiskLevel: ibkr?.riskLevel ?? null,
      ibkrDropToMarginCallPct: ibkr?.dropToMarginCallPct ?? null,
    });
    return [
      {
        symbol,
        financials,
        sizing: buildSizingView({
          symbol,
          currency,
          currentQuantity: group?.quantity ?? 0,
          targetPrice,
          currentPrice,
          financials,
          sizing,
        }),
      },
    ];
  });
}
