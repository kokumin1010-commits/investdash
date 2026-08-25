import { callDataApi } from "../_core/dataApi";

/**
 * Yahoo Finance Data API から株価と企業プロファイルを取得する薄いラッパー。
 * レスポンス構造は実測に基づく（docs/research-notes.md 参照）。
 */
import type { DividendEvent, SplitEvent } from "./dividend";

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
      events?: {
        dividends?: Record<string, { amount?: unknown; date?: unknown }>;
        splits?: Record<
          string,
          { date?: unknown; numerator?: unknown; denominator?: unknown; splitRatio?: unknown }
        >;
      };
    }>;
    error?: unknown;
  };
};

type ChartQuery = {
  interval: string;
  range: string;
  events?: string;
  includeAdjustedClose?: string;
};

const PUBLIC_YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const PUBLIC_YAHOO_SEARCH = "https://query1.finance.yahoo.com/v1/finance/search";
const DATA_API_QUOTA_BACKOFF_MS = 15 * 60 * 1000;
let dataApiRetryAfter = 0;

function dataApiCircuitOpen(): boolean {
  return Date.now() < dataApiRetryAfter;
}

function rememberDataApiFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (/usage exhausted|failed_precondition|quota/i.test(message)) {
    dataApiRetryAfter = Date.now() + DATA_API_QUOTA_BACKOFF_MS;
  }
}

async function fetchPublicChart(symbol: string, query: ChartQuery): Promise<ChartResponse> {
  const params = new URLSearchParams({
    interval: query.interval,
    range: query.range,
  });
  if (query.events) {
    params.set("events", query.events.replace(/(^|,)split(,|$)/g, "$1splits$2"));
  }
  if (query.includeAdjustedClose) {
    params.set("includeAdjustedClose", query.includeAdjustedClose);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(
      `${PUBLIC_YAHOO_CHART}/${encodeURIComponent(symbol)}?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; InvestDash/1.0)",
        },
        signal: controller.signal,
      }
    );
    if (!response.ok) {
      throw new Error(`Yahoo public chart failed (${response.status} ${response.statusText})`);
    }
    return (await response.json()) as ChartResponse;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchChart(symbol: string, query: ChartQuery): Promise<ChartResponse> {
  if (!dataApiCircuitOpen()) {
    try {
      return (await callDataApi("YahooFinance/get_stock_chart", {
        query: { symbol, region: "US", ...query },
      })) as ChartResponse;
    } catch (dataApiError) {
      rememberDataApiFailure(dataApiError);
      console.warn(
        `[marketData] Data API unavailable for ${symbol}; trying Yahoo public chart:`,
        dataApiError
      );
    }
  }
  return fetchPublicChart(symbol, query);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * 配当と株式分割の履歴。
 * 分割は配当額の補正に必要（Yahoo の配当額は分割調整されていない）。
 */
export type DividendHistory = {
  symbol: string;
  currency: string;
  price: number | null;
  dividends: DividendEvent[];
  splits: SplitEvent[];
};

/**
 * 配当と分割の履歴を取得する。
 *
 * range は 2y を使う。1 年分では分割の検出に不足があり、
 * 3y を指定すると配当イベントが空で返る銘柄があったため（5401.T で確認）。
 */
export async function fetchDividendHistory(symbol: string): Promise<DividendHistory | null> {
  try {
    const res = await fetchChart(symbol, {
      interval: "1d",
      range: "2y",
      events: "div,split",
    });

    const result = res?.chart?.result?.[0];
    if (!result?.meta) return null;

    const dividends: DividendEvent[] = [];
    for (const raw of Object.values(result.events?.dividends ?? {})) {
      const amount = num(raw?.amount);
      const date = num(raw?.date);
      if (amount !== null && date !== null) dividends.push({ amount, date });
    }

    const splits: SplitEvent[] = [];
    for (const raw of Object.values(result.events?.splits ?? {})) {
      const date = num(raw?.date);
      if (date === null) continue;
      const numerator = num(raw?.numerator);
      const denominator = num(raw?.denominator);
      if (numerator !== null && denominator !== null && denominator !== 0) {
        splits.push({ date, numerator, denominator });
        continue;
      }
      // numerator/denominator が無い場合は "5:1" 形式の文字列から読む
      const ratio = str(raw?.splitRatio);
      if (ratio) {
        const [a, b] = ratio.split(":").map(v => Number(v.trim()));
        if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) {
          splits.push({ date, numerator: a, denominator: b });
        }
      }
    }

    return {
      symbol: str(result.meta.symbol) ?? symbol,
      currency: str(result.meta.currency) ?? "JPY",
      price: num(result.meta.regularMarketPrice),
      dividends,
      splits,
    };
  } catch (error) {
    console.warn(`[marketData] fetchDividendHistory failed for ${symbol}:`, error);
    return null;
  }
}

/**
 * 単一銘柄の相場情報を取得する。取得できない場合は null。
 */
export async function fetchQuote(symbol: string): Promise<Quote | null> {
  try {
    const res = await fetchChart(symbol, {
      interval: "1d",
      range: "5d",
      // Data API のクエリ値は文字列である必要がある（真偽値を渡すと 400 になる）
      includeAdjustedClose: "true",
    });

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
    const res = await fetchChart(symbol, {
      interval,
      range,
      includeAdjustedClose: "true",
    });

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

type SearchResponse = {
  quotes?: Array<{
    symbol?: unknown;
    sector?: unknown;
    industry?: unknown;
    quoteType?: unknown;
  }>;
};

function classificationFromQuoteType(quoteType: string | null): {
  sector: string;
  industry: string;
} | null {
  switch (quoteType?.toUpperCase()) {
    case "ETF":
      return { sector: "ETF・ファンド", industry: "上場投資信託" };
    case "MUTUALFUND":
      return { sector: "ETF・ファンド", industry: "投資信託" };
    case "MONEYMARKET":
      return { sector: "現金性資産", industry: "マネー・マーケット" };
    case "CURRENCY":
      return { sector: "現金性資産", industry: "通貨" };
    case "CRYPTOCURRENCY":
      return { sector: "暗号資産", industry: "暗号資産" };
    case "OPTION":
    case "FUTURE":
      return { sector: "デリバティブ", industry: quoteType.toUpperCase() };
    default:
      return null;
  }
}

async function fetchPublicProfile(symbol: string): Promise<CompanyProfile | null> {
  const params = new URLSearchParams({
    q: symbol,
    quotesCount: "3",
    newsCount: "0",
    listsCount: "0",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${PUBLIC_YAHOO_SEARCH}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; InvestDash/1.0)",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as SearchResponse;
    const quote =
      payload.quotes?.find(item => str(item.symbol)?.toUpperCase() === symbol.toUpperCase()) ??
      payload.quotes?.[0];
    if (!quote) return null;
    const sector = str(quote.sector);
    const industry = str(quote.industry);
    const instrumentClassification = classificationFromQuoteType(str(quote.quoteType));
    if (!sector && !industry && !instrumentClassification) return null;
    return {
      sector: sector ?? instrumentClassification?.sector ?? null,
      industry: industry ?? instrumentClassification?.industry ?? null,
      country: null,
      website: null,
      businessSummary: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 企業プロファイル（セクター・業種・事業概要）を取得する。
 */
export async function fetchCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  if (!dataApiCircuitOpen()) {
    try {
      const res = (await callDataApi("YahooFinance/get_stock_profile", {
        query: { symbol, region: "US", lang: "en-US" },
      })) as ProfileResponse;

      const sp = res?.quoteSummary?.result?.[0]?.summaryProfile;
      if (sp) {
        const profile = {
          sector: str(sp.sector),
          industry: str(sp.industry),
          country: str(sp.country),
          website: str(sp.website),
          businessSummary: str(sp.longBusinessSummary),
        };
        if (profile.sector || profile.industry) return profile;
      }
    } catch (error) {
      rememberDataApiFailure(error);
      console.warn(`[marketData] Data API profile failed for ${symbol}; trying public search:`, error);
    }
  }

  try {
    return await fetchPublicProfile(symbol);
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

/**
 * SGD/JPY レートを取得する。失敗時は null。
 *
 * IBKR シンガポール口座は基軸通貨が SGD で、借入額・維持証拠金も SGD 建て。
 * USD/SGD からの間接換算では実勢とずれるため、直接レートを取得する。
 */
export async function fetchSgdJpyRate(): Promise<number | null> {
  const q = await fetchQuote("SGDJPY=X");
  return q?.price ?? null;
}

/**
 * HKD/JPY レートを取得する。失敗時は null。
 *
 * 富途香港口座は港股（HKD 建て）と港元貨幣基金を持つ。HKD は米ドルペッグ
 * （約 7.75〜7.85）だが、USD/HKD からの間接換算は近似になるため直接レートを使う。
 */
export async function fetchHkdJpyRate(): Promise<number | null> {
  const q = await fetchQuote("HKDJPY=X");
  return q?.price ?? null;
}
