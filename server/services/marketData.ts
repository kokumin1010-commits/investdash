import { callDataApi } from "../_core/dataApi";

/**
 * Yahoo Finance Data API から株価と企業プロファイルを取得する薄いラッパー。
 * レスポンス構造は実測に基づく（docs/research-notes.md 参照）。
 */

export type Quote = {
  symbol: string;
  longName: string | null;
  shortName: string | null;
  currency: string;
  exchangeName: string | null;
  price: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  marketTime: Date | null;
};

export type PriceBar = { t: number; c: number };

type ChartResponse = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
    error?: unknown;
  };
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * 単一銘柄の相場情報を取得する。取得できない場合は null。
 */
export async function fetchQuote(symbol: string): Promise<Quote | null> {
  try {
    const res = (await callDataApi("YahooFinance/get_stock_chart", {
      query: {
        symbol,
        region: "US",
        interval: "1d",
        range: "5d",
        // Data API のクエリ値は文字列である必要がある（真偽値を渡すと 400 になる）
        includeAdjustedClose: "true",
      },
    })) as ChartResponse;

    const meta = res?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const marketTimeSec = num(meta.regularMarketTime);

    return {
      symbol: str(meta.symbol) ?? symbol,
      longName: str(meta.longName),
      shortName: str(meta.shortName),
      currency: str(meta.currency) ?? "JPY",
      exchangeName: str(meta.fullExchangeName) ?? str(meta.exchangeName),
      price: num(meta.regularMarketPrice),
      previousClose: num(meta.chartPreviousClose) ?? num(meta.previousClose),
      dayHigh: num(meta.regularMarketDayHigh),
      dayLow: num(meta.regularMarketDayLow),
      volume: num(meta.regularMarketVolume),
      fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow),
      marketTime: marketTimeSec ? new Date(marketTimeSec * 1000) : null,
    };
  } catch (error) {
    console.warn(`[marketData] fetchQuote failed for ${symbol}:`, error);
    return null;
  }
}

/**
 * 価格チャート用の時系列（終値のみ）。
 */
export async function fetchPriceHistory(
  symbol: string,
  range = "6mo",
  interval = "1d"
): Promise<PriceBar[]> {
  try {
    const res = (await callDataApi("YahooFinance/get_stock_chart", {
      query: { symbol, region: "US", interval, range, includeAdjustedClose: "true" },
    })) as ChartResponse;

    const result = res?.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];

    const bars: PriceBar[] = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const c = closes[i];
      if (typeof c === "number" && Number.isFinite(c)) {
        bars.push({ t: timestamps[i] * 1000, c });
      }
    }
    return bars;
  } catch (error) {
    console.warn(`[marketData] fetchPriceHistory failed for ${symbol}:`, error);
    return [];
  }
}

export type CompanyProfile = {
  sector: string | null;
  industry: string | null
  country: string | null;
  website: string | null;
  businessSummary: string | null;
};

type ProfileResponse = {
  quoteSummary?: {
    result?: Array<{ summaryProfile?: Record<string, unknown> }>;
  };
};

/**
 * 企業プロファイル（セクター・業種・事業概要）を取得する。
 */
export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  try {
    const res = (await callDataApi("YahooFinance/get_stock_profile", {
      query: { symbol, region: "US", lang: "en-US" },
    })) as ProfileResponse;

    const sp = res?.quoteSummary?.result?.[0]?.summaryProfile;
    if (!sp) return null;

    return {
      sector: str(sp.sector),
      industry: str(sp.industry),
      country: str(sp.country),
      website: str(sp.website),
      businessSummary: str(sp.longBusinessSummary),
    };
  } catch (error) {
    console.warn(`[marketData] fetchCompanyProfile failed for ${symbol}:`, error);
    return null;
  }
}

/**
 * 複数銘柄の相場情報を控えめな並列度で取得する。
 * Autoscale の 1 vCPU 制約を考慮し同時実行を 4 に制限。
 */
export async function fetchQuotes(symbols: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>();
  const unique = Array.from(new Set(symbols.filter(Boolean)));
  const concurrency = 4;

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(s => fetchQuote(s)));
    results.forEach((q, idx) => {
      if (q) out.set(batch[idx], q);
    });
  }
  return out;
}

/**
 * 主要な為替レート（USD/JPY）を取得する。失敗時は null。
 */
export async function fetchUsdJpyRate(): Promise<number | null> {
  const q = await fetchQuote("USDJPY=X");
  return q?.price ?? null;
}
