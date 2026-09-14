import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDirectSecurityCandidates,
  displayTickerForSearch,
  inferSecuritySearchMarket,
  recentSecuritySearchIdsToPrune,
  securitySearchMarketLabel,
} from "../shared/securitySearch";

const marketMocks = vi.hoisted(() => ({
  fetchQuote: vi.fn(),
  searchPublicSecurities: vi.fn(),
}));

vi.mock("./services/marketData", () => marketMocks);

import {
  resolveSecurityCode,
  searchSecurityCandidates,
} from "./services/securitySearchService";

function quote(symbol: string, price: number, currency = "SGD") {
  return {
    symbol,
    longName: symbol === "V03.SI" ? "Venture Corporation Limited" : null,
    shortName: symbol,
    currency,
    exchangeName: symbol.endsWith(".SI") ? "SES" : "NASDAQ",
    price,
    previousClose: price - 0.1,
    dayHigh: null,
    dayLow: null,
    volume: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    marketTime: new Date("2026-09-11T08:00:00Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  marketMocks.searchPublicSecurities.mockResolvedValue([]);
  marketMocks.fetchQuote.mockResolvedValue(null);
});

describe("security search market rules", () => {
  it("builds verified SGX fallbacks for bare alphanumeric codes", () => {
    expect(buildDirectSecurityCandidates("V03")).toEqual(["V03", "V03.SI"]);
    expect(buildDirectSecurityCandidates("5DD")).toEqual(["5DD", "5DD.SI"]);
    expect(buildDirectSecurityCandidates("DCRU.SI")).toEqual(["DCRU.SI"]);
  });

  it("keeps Japan first and exposes Taiwan, Hong Kong and Korea candidates", () => {
    expect(buildDirectSecurityCandidates("7203")).toEqual([
      "7203.T",
      "7203.TW",
      "7203.TWO",
      "7203.HK",
    ]);
    expect(buildDirectSecurityCandidates("005930")).toEqual(["005930.KS", "005930.KQ"]);
    expect(inferSecuritySearchMarket("2330.TW")).toBe("TW");
    expect(inferSecuritySearchMarket("005930.KS")).toBe("KR");
    expect(securitySearchMarketLabel("SG")).toBe("シンガポール株");
    expect(displayTickerForSearch("V03.SI")).toBe("V03");
  });

  it("keeps the newest eight recent searches and prunes only older ids", () => {
    const ordered = Array.from({ length: 11 }, (_, index) => ({ id: index + 1 }));
    expect(recentSecuritySearchIdsToPrune(ordered, 8)).toEqual([9, 10, 11]);
    expect(recentSecuritySearchIdsToPrune(ordered.slice(0, 8), 8)).toEqual([]);
  });

  it("resolves V03 to the validated SGX quote instead of inventing a US quote", async () => {
    marketMocks.fetchQuote.mockImplementation(async (symbol: string) =>
      symbol === "V03.SI" ? quote("V03.SI", 16.45) : null
    );

    const result = await resolveSecurityCode("V03");

    expect(result).toMatchObject({
      symbol: "V03.SI",
      name: "Venture Corporation Limited",
      market: "SG",
      currency: "SGD",
      price: 16.45,
    });
  });

  it("puts matching user symbols before remote names and removes invalid quotes", async () => {
    marketMocks.searchPublicSecurities.mockResolvedValue([
      {
        symbol: "VG",
        shortName: "Venture Global",
        longName: "Venture Global, Inc.",
        exchange: "NYQ",
        exchangeDisplay: "NYSE",
        currency: "USD",
        price: 15,
        previousClose: 14,
        quoteType: "EQUITY",
      },
    ]);
    marketMocks.fetchQuote.mockImplementation(async (symbol: string) => {
      if (symbol === "V03.SI") return quote("V03.SI", 16.45);
      if (symbol === "VG") return quote("VG", 15, "USD");
      return null;
    });

    const results = await searchSecurityCandidates(
      "Venture",
      [{ symbol: "V03.SI", name: "Venture Corporation Limited" }],
      8
    );

    expect(results.map(item => item.symbol)).toEqual(["V03.SI", "VG"]);
  });
});
