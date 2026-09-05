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

  it("小さすぎる米国株の一部売却は売買ノイズとして要確認にする", () => {
    const reduce = buildHoldingActionPlan({
      action: "REDUCE",
      quantity: 54,
      currentPrice: 20.23,
      marketValueBase: 174829,
      currentWeightPct: 0.02014,
      market: "US",
      accountCount: 1,
    });
    expect(reduce.direction).toBe("REVIEW");
    expect(reduce.shares).toBe(0);
    expect(reduce.afterQuantity).toBe(54);

    const meaningful = buildHoldingActionPlan({
      action: "REDUCE",
      quantity: 100,
      currentPrice: 300,
      marketValueBase: 4_500_000,
      currentWeightPct: 1,
      market: "US",
      accountCount: 1,
    });
    expect(meaningful.direction).toBe("SELL");
    expect(meaningful.shares).toBe(25);
    expect(meaningful.afterQuantity).toBe(75);

    const exit = buildHoldingActionPlan({ ...base, action: "EXIT" });
    expect(exit.shares).toBe(2000);
    expect(exit.afterQuantity).toBe(0);
    expect(exit.afterWeightPct).toBe(0);
  });

  it("日本株を1単元しか持たない REDUCE は全売却へ変換しない", () => {
    const result = buildHoldingActionPlan({
      ...base,
      action: "REDUCE",
      quantity: 100,
      currentWeightPct: 0.4,
      marketValueBase: 3_464_000,
    });
    expect(result.direction).toBe("REVIEW");
    expect(result.shares).toBe(0);
    expect(result.afterQuantity).toBe(100);
    expect(result.rationale).toContain("EXIT");
  });

  it("売却後が0.10%未満の端数ポジションになる場合は要確認にする", () => {
    const result = buildHoldingActionPlan({
      ...base,
      action: "REDUCE",
      quantity: 200,
      currentWeightPct: 0.12,
      marketValueBase: 1_000_000,
    });
    expect(result.direction).toBe("REVIEW");
    expect(result.shares).toBe(0);
    expect(result.rationale).toContain("0.10%");
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
