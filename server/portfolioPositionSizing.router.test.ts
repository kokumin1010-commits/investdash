import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  buildPortfolio: vi.fn(),
  getPlan: vi.fn(),
  getWatchBySymbol: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("./services/portfolio", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/portfolio")>();
  return { ...actual, buildPortfolio: mocks.buildPortfolio };
});

vi.mock("./services/priceBandService", async importOriginal => {
  const actual =
    await importOriginal<typeof import("./services/priceBandService")>();
  return { ...actual, getPlan: mocks.getPlan };
});

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getWatchBySymbol: mocks.getWatchBySymbol,
    getSettings: mocks.getSettings,
  };
});

import { appRouter } from "./routers";

function createCaller() {
  const now = new Date();
  const ctx: TrpcContext = {
    user: {
      id: 1,
      openId: "position-sizing-user",
      email: "position-sizing@example.com",
      name: "Position Sizing Test",
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
  mocks.getWatchBySymbol.mockResolvedValue({
    id: 11,
    userId: 1,
    symbol: "285A.T",
    priority: "MEDIUM",
    sector: "Technology",
    currentPrice: "47900",
  });
  mocks.getSettings.mockResolvedValue({ sectorConcentrationThreshold: 35 });
  mocks.getPlan.mockResolvedValue({
    id: 15,
    symbol: "285A.T",
    currency: "JPY",
    scope: "WATCHLIST",
    strategy: "段階的に買う",
    rationale: "打診から始める",
    model: "gemini-3-flash-preview",
    editedByUser: false,
    generatedAt: new Date("2026-08-29T00:00:00Z"),
    currentPrice: 47_900,
    bands: [],
    evaluation: {
      currentBand: {
        id: 1,
        lowerPrice: 46_000,
        upperPrice: 47_900.99,
        action: "ADD_SMALL",
        actionLabel: "打診買いを検討する水準",
        reason: "目標帯に入った",
        checkItems: [],
        plannedAmount: null,
        sortOrder: 1,
        checks: [],
      },
      abovePlan: false,
      belowPlan: false,
      nextBand: null,
      gapToNextPct: null,
      nextBandPrice: null,
    },
  });
  mocks.buildPortfolio.mockResolvedValue({
    groups: [],
    summary: {
      netAssetsBase: 734_667_816.4483856,
      cashBalance: 1_255_302,
      interestAssetsBase: 94_653_661.400826,
      usdJpyRate: 160.038,
      sgdJpyRate: 125.565,
      hkdJpyRate: 20.4171,
    },
    sectors: [{ key: "Technology", value: 197_342_403.77271006 }],
    brokers: [
      {
        key: "ibkr",
        leverage: {
          leverage: 1.8250869631936704,
          riskLevel: "CAUTION",
          dropToMarginCallPct: 33.88228697507812,
        },
      },
    ],
  });
});

describe("portfolio.priceBandPlan position sizing", () => {
  it("returns a portfolio-aware 285A first tranche without fabricating a holding", async () => {
    const result = await createCaller().portfolio.priceBandPlan({
      symbol: "285A.T",
    });

    expect(mocks.buildPortfolio).toHaveBeenCalledWith(1);
    expect(result?.sizing).toMatchObject({
      status: "BUY",
      amountBase: 4_790_000,
      shares: 100,
      currentWeightPct: 0,
      targetWeightPct: 1,
      lotAdjusted: true,
      marginFactor: 0.5,
      ibkrRiskLevel: "CAUTION",
    });
    expect(result?.sizing.afterWeightPct).toBeCloseTo(0.652, 3);
  });
});
