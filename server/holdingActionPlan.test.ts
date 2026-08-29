import { describe, expect, it } from "vitest";
import { buildHoldingActionPlan } from "../shared/holdingActionPlan";

const base = {
  quantity: 2000,
  currentPrice: 2738,
  marketValueBase: 5476000,
  currentWeightPct: 0.630824,
  market: "JP" as const,
  accountCount: 1,
};

describe("buildHoldingActionPlan", () => {
  it("REDUCE は日本株の25%を100株単位で出す", () => {
    const result = buildHoldingActionPlan({ ...base, action: "REDUCE" });
    expect(result.shares).toBe(500);
    expect(result.amountLocal).toBe(1369000);
    expect(result.afterQuantity).toBe(1500);
    expect(result.afterWeightPct).toBeCloseTo(0.473118);
  });

  it("5%超の集中では25%より多くても5%以下まで落とす", () => {
    const result = buildHoldingActionPlan({
      ...base,
      action: "REDUCE",
      currentWeightPct: 10,
    });
    expect(result.shares).toBe(1000);
    expect(result.afterWeightPct).toBe(5);
  });

  it("HMY のような米国株は1株単位、EXIT は全量", () => {
    const reduce = buildHoldingActionPlan({
      action: "REDUCE",
      quantity: 54,
      currentPrice: 20.23,
      marketValueBase: 174829,
      currentWeightPct: 0.02014,
      market: "US",
      accountCount: 1,
    });
    expect(reduce.shares).toBe(13);
    expect(reduce.afterQuantity).toBe(41);

    const exit = buildHoldingActionPlan({ ...base, action: "EXIT" });
    expect(exit.shares).toBe(2000);
    expect(exit.afterQuantity).toBe(0);
    expect(exit.afterWeightPct).toBe(0);
  });

  it("HOLD/WATCH は売買なし、ADD は価格帯 sizing に委ねる", () => {
    expect(buildHoldingActionPlan({ ...base, action: "HOLD" }).shares).toBe(0);
    expect(buildHoldingActionPlan({ ...base, action: "WATCH" }).direction).toBe(
      "REVIEW"
    );
    expect(
      buildHoldingActionPlan({ ...base, action: "ADD" }).shares
    ).toBeNull();
  });
});
