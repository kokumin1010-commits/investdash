import {
  buildDirectSecurityCandidates,
  displayTickerForSearch,
  inferSecuritySearchMarket,
  securitySearchMarketLabel,
  type SecuritySearchMarket,
} from "../../shared/securitySearch";
import {
  fetchQuote,
  searchPublicSecurities,
  type Quote,
  type SecuritySearchHit,
} from "./marketData";

export type LocalSecuritySearchItem = {
  symbol: string;
  name: string;
};

export type SecuritySearchCandidate = {
  symbol: string;
  tickerCode: string;
  name: string;
  market: SecuritySearchMarket;
  marketLabel: string;
  exchangeName: string | null;
  currency: string | null;
  price: number | null;
  previousClose: number | null;
  priceAsOf: Date | null;
  quoteType: string | null;
};

function normalizeText(value: string): string {
  return value.trim().toUpperCase().normalize("NFKC");
}

function localMatches(query: string, items: LocalSecuritySearchItem[]): LocalSecuritySearchItem[] {
  const needle = normalizeText(query);
  if (!needle) return [];
  return items.filter(item => {
    const symbol = normalizeText(item.symbol);
    const ticker = normalizeText(displayTickerForSearch(item.symbol));
    const name = normalizeText(item.name);
    return symbol.includes(needle) || ticker.includes(needle) || name.includes(needle);
  });
}

function candidateFromQuote(
  quote: Quote,
  fallback?: Partial<SecuritySearchHit> & { name?: string }
): SecuritySearchCandidate {
  const market = inferSecuritySearchMarket(quote.symbol, fallback?.exchange ?? quote.exchangeName);
  return {
    symbol: quote.symbol.toUpperCase(),
    tickerCode: displayTickerForSearch(quote.symbol),
    name: fallback?.name ?? quote.longName ?? quote.shortName ?? displayTickerForSearch(quote.symbol),
    market,
    marketLabel: securitySearchMarketLabel(market),
    exchangeName: fallback?.exchangeDisplay ?? quote.exchangeName,
    currency: quote.currency || fallback?.currency || null,
    price: quote.price,
    previousClose: quote.previousClose,
    priceAsOf: quote.marketTime,
    quoteType: fallback?.quoteType ?? null,
  };
}

export async function resolveSecurityCode(raw: string): Promise<SecuritySearchCandidate | null> {
  const symbols = buildDirectSecurityCandidates(raw);
  if (symbols.length === 0) return null;
  const quotes = await Promise.all(symbols.map(symbol => fetchQuote(symbol)));
  const valid =
    quotes.find((quote): quote is Quote => quote !== null && quote.price !== null) ?? null;
  if (valid) return candidateFromQuote(valid);

  const discovered = await searchPublicSecurities(raw, 8);
  for (const hit of discovered) {
    const quote = await fetchQuote(hit.symbol);
    if (quote && quote.price !== null) {
      return candidateFromQuote(quote, {
        ...hit,
        name: hit.longName ?? hit.shortName ?? undefined,
      });
    }
  }
  return null;
}

export async function searchSecurityCandidates(
  query: string,
  localItems: LocalSecuritySearchItem[],
  limit = 8
): Promise<SecuritySearchCandidate[]> {
  const [remoteHits, directSymbols] = await Promise.all([
    searchPublicSecurities(query, 12),
    Promise.resolve(buildDirectSecurityCandidates(query)),
  ]);
  const local = localMatches(query, localItems);
  const sources = new Map<
    string,
    Partial<SecuritySearchHit> & { name?: string; priority: number }
  >();

  local.forEach(item => {
    sources.set(item.symbol.toUpperCase(), { name: item.name, priority: 0 });
  });
  directSymbols.forEach(symbol => {
    const key = symbol.toUpperCase();
    if (!sources.has(key)) sources.set(key, { priority: 1 });
  });
  remoteHits.forEach(hit => {
    const key = hit.symbol.toUpperCase();
    if (!sources.has(key)) {
      sources.set(key, {
        ...hit,
        name: hit.longName ?? hit.shortName ?? undefined,
        priority: 2,
      });
    }
  });

  const ordered = Array.from(sources.entries())
    .sort(([, a], [, b]) => a.priority - b.priority)
    .slice(0, Math.max(limit * 2, limit));
  const quotes = await Promise.all(
    ordered.map(async ([symbol, fallback]) => ({
      fallback,
      quote: await fetchQuote(symbol),
    }))
  );

  const results: SecuritySearchCandidate[] = [];
  for (const { fallback, quote } of quotes) {
    if (!quote || quote.price === null) continue;
    results.push(candidateFromQuote(quote, fallback));
    if (results.length >= limit) break;
  }
  return results;
}
