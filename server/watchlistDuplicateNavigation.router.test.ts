import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getWatchBySymbol: vi.fn(),
  listHoldingsBySymbol: vi.fn(),
  fetchQuote: vi.fn(),
  fetchCompanyProfile: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getWatchBySymbol: mocks.getWatchBySymbol,
    listHoldingsBySymbol: mocks.listHoldingsBySymbol,
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

function createCaller() {
  const now = new Date();
  const ctx: TrpcContext = {
    user: {
      id: 17,
      openId: "duplicate-nav-user",
      email: "duplicate-nav@example.com",
      name: "Duplicate Navigation Test",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchQuote.mockResolvedValue({
    symbol: "285A.T",
    shortName: "Kioxia Holdings",
    longName: "キオクシアホールディングス株式会社",
    price: 3120,
    previousClose: 3080,
    currency: "JPY",
    exchangeName: "Tokyo",
    fiftyTwoWeekHigh: 3800,
    fiftyTwoWeekLow: 1800,
  });
  mocks.fetchCompanyProfile.mockResolvedValue({
    sector: "Technology",
    industry: "Semiconductors",
    website: "https://www.kioxia-holdings.com/",
    businessSummary: "半導体メモリ事業",
  });
  mocks.getWatchBySymbol.mockResolvedValue(undefined);
  mocks.listHoldingsBySymbol.mockResolvedValue([]);
});

describe("duplicate watch navigation routes", () => {
  it("returns the existing watch and all holdings in stable id order", async () => {
    mocks.getWatchBySymbol.mockResolvedValue({
      id: 91,
      userId: 17,
      symbol: "285A.T",
      tickerCode: "285A",
      name: "キオクシアホールディングス株式会社",
    });
    mocks.listHoldingsBySymbol.mockResolvedValue([
      { id: 203, symbol: "285A.T", name: "キオクシア", broker: "rakuten" },
      { id: 102, symbol: "285A.T", name: "キオクシア", broker: "ibkr" },
    ]);

    const result = await createCaller().portfolio.lookup({ code: "285A" });

    expect(mocks.getWatchBySymbol).toHaveBeenCalledWith(17, "285A.T");
    expect(mocks.listHoldingsBySymbol).toHaveBeenCalledWith(17, "285A.T");
    expect(result.existingWatch).toEqual({
      id: 91,
      symbol: "285A.T",
      name: "キオクシアホールディングス株式会社",
    });
    expect(result.existingHoldings).toEqual([
      { id: 102, symbol: "285A.T", name: "キオクシア", broker: "ibkr" },
      { id: 203, symbol: "285A.T", name: "キオクシア", broker: "rakuten" },
    ]);
  });

  it("keeps watchlist.add conflict protection for a preview-to-save race", async () => {
    mocks.getWatchBySymbol.mockResolvedValue({
      id: 91,
      userId: 17,
      symbol: "285A.T",
      tickerCode: "285A",
      name: "キオクシアホールディングス株式会社",
    });

    await expect(
      createCaller().watchlist.add({ code: "285A" })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "285A.T は既にウォッチリストにあります",
    });
    expect(mocks.fetchQuote).not.toHaveBeenCalled();
  });
});
