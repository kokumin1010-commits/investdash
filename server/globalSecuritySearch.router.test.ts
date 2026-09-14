import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  listHoldings: vi.fn(),
  listWatchlist: vi.fn(),
  getWatchBySymbol: vi.fn(),
  insertWatchItem: vi.fn(),
  searchSecurityCandidates: vi.fn(),
  resolveSecurityCode: vi.fn(),
  fetchQuote: vi.fn(),
  fetchCompanyProfile: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listHoldings: mocks.listHoldings,
    listWatchlist: mocks.listWatchlist,
    getWatchBySymbol: mocks.getWatchBySymbol,
    insertWatchItem: mocks.insertWatchItem,
  };
});

vi.mock("./services/securitySearchService", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/securitySearchService")>();
  return {
    ...actual,
    searchSecurityCandidates: mocks.searchSecurityCandidates,
    resolveSecurityCode: mocks.resolveSecurityCode,
  };
});

vi.mock("./services/marketData", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/marketData")>();
  return {
    ...actual,
    fetchQuote: mocks.fetchQuote,
    fetchCompanyProfile: mocks.fetchCompanyProfile,
  };
});

import { appRouter } from "./routers";

function createCaller(userId = 37) {
  const now = new Date();
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: `search-user-${userId}`,
      email: "search@example.com",
      name: "Search Test",
      loginMethod: "passcode",
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

const ventureCandidate = {
  symbol: "V03.SI",
  tickerCode: "V03",
  name: "Venture Corporation Limited",
  market: "SG" as const,
  marketLabel: "シンガポール株",
  exchangeName: "Singapore",
  currency: "SGD",
  price: 16.45,
  previousClose: 16.4,
  priceAsOf: new Date("2026-09-11T08:00:00Z"),
  quoteType: "EQUITY",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listHoldings.mockResolvedValue([]);
  mocks.listWatchlist.mockResolvedValue([]);
  mocks.getWatchBySymbol.mockResolvedValue(null);
  mocks.insertWatchItem.mockResolvedValue(91);
  mocks.searchSecurityCandidates.mockResolvedValue([ventureCandidate]);
  mocks.resolveSecurityCode.mockResolvedValue(ventureCandidate);
  mocks.fetchQuote.mockResolvedValue({
    symbol: "V03.SI",
    longName: "Venture Corporation Limited",
    shortName: "Venture",
    currency: "SGD",
    exchangeName: "SES",
    price: 16.45,
    previousClose: 16.4,
    dayHigh: null,
    dayLow: null,
    volume: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    marketTime: new Date("2026-09-11T08:00:00Z"),
  });
  mocks.fetchCompanyProfile.mockResolvedValue({
    sector: "Technology",
    industry: "Electronic Components",
    country: "Singapore",
    website: null,
    businessSummary: null,
  });
});

describe("portfolio.searchSecurities", () => {
  it("uses only the authenticated user's holdings and watchlist", async () => {
    await createCaller(37).portfolio.searchSecurities({ query: "V03", limit: 8 });
    await createCaller(88).portfolio.searchSecurities({ query: "5DD", limit: 5 });

    expect(mocks.listHoldings.mock.calls).toEqual([[37], [88]]);
    expect(mocks.listWatchlist.mock.calls).toEqual([[37], [88]]);
    expect(mocks.searchSecurityCandidates.mock.calls).toEqual([
      ["V03", [], 8],
      ["5DD", [], 5],
    ]);
  });

  it("marks a held symbol ahead of a watchlist duplicate", async () => {
    mocks.listHoldings.mockResolvedValue([
      { id: 42, symbol: "V03.SI", name: "Venture", broker: "ibkr" },
    ]);
    mocks.listWatchlist.mockResolvedValue([
      { id: 9, symbol: "V03.SI", name: "Venture" },
    ]);

    const result = await createCaller().portfolio.searchSecurities({
      query: "V03",
      limit: 8,
    });

    expect(result[0]).toMatchObject({
      symbol: "V03.SI",
      registrationStatus: "HELD",
      existingWatch: { id: 9 },
      existingHoldings: [{ id: 42, broker: "ibkr" }],
    });
  });
});

describe("watchlist.add cross-market resolution", () => {
  it("saves the validated V03.SI symbol rather than the invalid bare US code", async () => {
    const result = await createCaller(37).watchlist.add({ code: "V03" });

    expect(mocks.resolveSecurityCode).toHaveBeenCalledWith("V03");
    expect(mocks.getWatchBySymbol).toHaveBeenCalledWith(37, "V03.SI");
    expect(mocks.insertWatchItem).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 37,
        symbol: "V03.SI",
        tickerCode: "V03",
        market: "SG",
        currency: "SGD",
      })
    );
    expect(result).toEqual({ id: 91, symbol: "V03.SI" });
  });
});
