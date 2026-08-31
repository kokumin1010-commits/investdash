import { describe, expect, it } from "vitest";
import {
  buyPlanMaterialKey,
  rankBuyPlans,
  rankingMonthJst,
  scoreBuyPlan,
  type BuyPlanRankingInput,
} from "../shared/buyPlanRanking";

function candidate(overrides: Partial<BuyPlanRankingInput> = {}): BuyPlanRankingInput {
  return {
    symbol: "AAA",
    action: "ADD_MAIN",
    currentPrice: 90,
    lowerPrice: 80,
    upperPrice: 100,
    needsCheck: false,
    pendingCheckCount: 0,
    concernCount: 0,
    signalAction: "ADD",
    signalConfidence: 100,
    signalDataQuality: "STRONG",
    hasCard: true,
    cardConviction: 5,
    cardUpdatedAt: new Date("2026-08-01T00:00:00.000Z"),
    planGeneratedAt: new Date("2026-08-01T00:00:00.000Z"),
    sizing: {
      status: "BUY",
      amountBase: 1_000_000,
      shares: 100,
      afterWeightPct: 1.5,
      liquidAssetsBase: 30_000_000,
      sectorCurrentPct: 10,
      sectorAfterPct: 11,
      sectorLimitPct: 30,
      ibkrRiskLevel: "SAFE",
    },
    ...overrides,
  };
}

describe("buy plan ranking", () => {
  it("scores an executable high-quality ADD_MAIN candidate on five dimensions", () => {
    const result = scoreBuyPlan(candidate());
    expect(result.eligible).toBe(true);
    expect(result.breakdown).toEqual({
      quality: 30,
      valuation: 23,
      fundamentals: 18,
      portfolioFit: 15,
      liquidityLeverage: 10,
    });
    expect(result.score).toBe(96);
  });

  it.each([
    [{ needsCheck: true, pendingCheckCount: 1 }, "未照合"],
    [{ signalAction: "REDUCE" as const }, "競合"],
    [{ sizing: { ...candidate().sizing, status: "BLOCKED_MARGIN" as const } }, "BLOCKED_MARGIN"],
    [{ sizing: { ...candidate().sizing, ibkrRiskLevel: "DANGER" as const } }, "DANGER"],
  ])("blocks ineligible candidates with an explanation", (overrides, reason) => {
    const result = scoreBuyPlan(candidate(overrides));
    expect(result.eligible).toBe(false);
    expect(result.gateReasons.join(" ")).toContain(reason);
  });

  it("penalizes concerns and near-cap positions without inventing a moat score", () => {
    const result = scoreBuyPlan(
      candidate({
        concernCount: 2,
        hasCard: false,
        cardConviction: null,
        sizing: {
          ...candidate().sizing,
          afterWeightPct: 4.8,
          sectorAfterPct: 28,
        },
      })
    );
    expect(result.breakdown.quality).toBe(8);
    expect(result.breakdown.fundamentals).toBe(10);
    expect(result.breakdown.portfolioFit).toBe(0);
  });

  it("ranks eligible candidates first with deterministic tie-breaks", () => {
    const ranked = rankBuyPlans([
      candidate({ symbol: "BBB", action: "ADD_SMALL" }),
      candidate({ symbol: "CCC", needsCheck: true, pendingCheckCount: 1 }),
      candidate({ symbol: "AAA" }),
    ]);
    expect(ranked.map(item => [item.symbol, item.rank])).toEqual([
      ["AAA", 1],
      ["BBB", 2],
      ["CCC", null],
    ]);
  });

  it("uses JST month boundaries", () => {
    expect(rankingMonthJst(new Date("2026-08-31T15:30:00.000Z"))).toBe("2026-09");
  });

  it("excludes daily price and amount noise from the material key", () => {
    const first = buyPlanMaterialKey(candidate());
    const second = buyPlanMaterialKey(
      candidate({
        currentPrice: 92,
        sizing: { ...candidate().sizing, amountBase: 900_000, shares: 90 },
      })
    );
    expect(second).toEqual(first);
    expect(
      buyPlanMaterialKey(candidate({ signalAction: "HOLD" }))
    ).not.toEqual(first);
  });
});
