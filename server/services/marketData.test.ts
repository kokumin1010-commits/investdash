import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../_core/dataApi", () => ({
  callDataApi: vi.fn().mockRejectedValue(new Error("usage exhausted")),
}));

import { fetchCompanyProfile, fetchQuote } from "./marketData";

describe("market data fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses Yahoo's public chart when the Data API quota is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        chart: {
          result: [
            {
              meta: {
                symbol: "7203.T",
                longName: "Toyota Motor Corporation",
                currency: "JPY",
                fullExchangeName: "Tokyo",
                regularMarketPrice: 3080,
                chartPreviousClose: 3022,
                regularMarketDayHigh: 3120,
                regularMarketDayLow: 3073,
                regularMarketVolume: 11728200,
                fiftyTwoWeekHigh: 4000,
                fiftyTwoWeekLow: 2686,
                regularMarketTime: 1787633199,
              },
            },
          ],
          error: null,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const quote = await fetchQuote("7203.T");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "query1.finance.yahoo.com/v8/finance/chart/7203.T"
    );
    expect(quote).toMatchObject({
      symbol: "7203.T",
      longName: "Toyota Motor Corporation",
      currency: "JPY",
      price: 3080,
      previousClose: 3022,
      fiftyTwoWeekHigh: 4000,
      fiftyTwoWeekLow: 2686,
    });
  });

  it("uses Yahoo's public search for sector and industry profile fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        quotes: [
          {
            symbol: "7203.T",
            sector: "Consumer Cyclical",
            industry: "Auto Manufacturers",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const profile = await fetchCompanyProfile("7203.T");

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "query1.finance.yahoo.com/v1/finance/search"
    );
    expect(profile).toEqual({
      sector: "Consumer Cyclical",
      industry: "Auto Manufacturers",
      country: null,
      website: null,
      businessSummary: null,
    });
  });

  it("classifies ETFs from Yahoo quoteType without inventing a company sector", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        quotes: [{ symbol: "1306.T", quoteType: "ETF" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCompanyProfile("1306.T")).resolves.toEqual({
      sector: "ETF・ファンド",
      industry: "上場投資信託",
      country: null,
      website: null,
      businessSummary: null,
    });
  });

  it("keeps an unknown instrument unclassified when Yahoo gives no evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ quotes: [{ symbol: "UNKNOWN", quoteType: "EQUITY" }] }),
      })
    );

    await expect(fetchCompanyProfile("UNKNOWN")).resolves.toBeNull();
  });
});
