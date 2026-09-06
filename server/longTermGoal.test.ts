import { describe, expect, it } from "vitest";
import { buildLongTermGoalProgress } from "../shared/longTermGoal";

describe("buildLongTermGoalProgress", () => {
  it("computes a high-challenge 2030 asset target without turning it into an action", () => {
    const result = buildLongTermGoalProgress({
      currentNetAssetsJpy: 730_822_351,
      targetNetAssetsJpy: 100_000_000_000,
      targetDate: "2030-12-31",
      annualDividendJpy: 22_254_225,
      annualInterestIncomeJpy: 1_200_000,
      annualBorrowingInterestJpy: 3_899_093,
      now: new Date("2026-09-07T00:00:00.000Z"),
    });

    expect(result.configured).toBe(true);
    expect(result.status).toBe("HIGH_CHALLENGE");
    expect(result.progressPct).toBeCloseTo(0.730822351, 8);
    expect(result.remainingJpy).toBe(99_269_177_649);
    expect(result.assetMultiple).toBeGreaterThan(136);
    expect(result.requiredAnnualGrowthPct).toBeGreaterThan(200);
    expect(result.annualNetCash.currentJpy).toBe(19_555_132);
  });

  it("keeps unset income targets explicit while still showing actual income", () => {
    const result = buildLongTermGoalProgress({
      currentNetAssetsJpy: 10_000_000,
      targetNetAssetsJpy: 20_000_000,
      targetDate: "2035-12-31",
      annualDividendJpy: 300_000,
      annualInterestIncomeJpy: 50_000,
      annualBorrowingInterestJpy: 0,
      now: new Date("2026-09-07T00:00:00.000Z"),
    });

    expect(result.status).toBe("ACTIVE");
    expect(result.annualDividend.targetJpy).toBeNull();
    expect(result.annualDividend.progressPct).toBeNull();
    expect(result.annualNetCash.currentJpy).toBe(350_000);
  });

  it("does not fabricate progress when the target or a cash-flow input is missing", () => {
    const result = buildLongTermGoalProgress({
      currentNetAssetsJpy: 10_000_000,
      targetNetAssetsJpy: null,
      targetDate: null,
      annualDividendJpy: 300_000,
      annualInterestIncomeJpy: null,
      annualBorrowingInterestJpy: 0,
    });

    expect(result.configured).toBe(false);
    expect(result.status).toBe("NOT_SET");
    expect(result.progressPct).toBeNull();
    expect(result.annualNetCash.currentJpy).toBeNull();
  });

  it("marks an achieved target and an overdue target separately", () => {
    const achieved = buildLongTermGoalProgress({
      currentNetAssetsJpy: 30_000_000,
      targetNetAssetsJpy: 20_000_000,
      targetDate: "2030-12-31",
      annualDividendJpy: 0,
      annualInterestIncomeJpy: 0,
      annualBorrowingInterestJpy: 0,
      now: new Date("2026-09-07T00:00:00.000Z"),
    });
    const overdue = buildLongTermGoalProgress({
      currentNetAssetsJpy: 10_000_000,
      targetNetAssetsJpy: 20_000_000,
      targetDate: "2025-12-31",
      annualDividendJpy: 0,
      annualInterestIncomeJpy: 0,
      annualBorrowingInterestJpy: 0,
      now: new Date("2026-09-07T00:00:00.000Z"),
    });

    expect(achieved.status).toBe("ACHIEVED");
    expect(achieved.requiredAnnualGrowthPct).toBe(0);
    expect(overdue.status).toBe("OVERDUE");
    expect(overdue.requiredAnnualGrowthPct).toBeNull();
  });
});
