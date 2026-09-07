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
    expect(result.scenarioRatesDefaulted).toBe(true);
    expect(result.scenarios.map(item => item.annualReturnPct)).toEqual([4, 8, 12]);
  });

  it("adds annual contributions monthly and separates principal from investment growth", () => {
    const result = buildLongTermGoalProgress({
      currentNetAssetsJpy: 10_000_000,
      targetNetAssetsJpy: 30_000_000,
      targetDate: "2030-12-31",
      annualDividendJpy: 0,
      annualInterestIncomeJpy: 0,
      annualBorrowingInterestJpy: 0,
      annualContributionJpy: 12_000_000,
      conservativeReturnPct: 0,
      baseReturnPct: 0,
      optimisticReturnPct: 0,
      now: new Date("2029-12-31T15:00:00.000Z"),
    });

    expect(result.scenarioRatesDefaulted).toBe(false);
    for (const scenario of result.scenarios) {
      expect(scenario.totalContributionJpy).toBe(12_000_000);
      expect(scenario.projectedNetAssetsJpy).toBe(22_000_000);
      expect(scenario.investmentGrowthJpy).toBeCloseTo(0, 6);
      expect(scenario.achievesTarget).toBe(false);
      expect(scenario.gapJpy).toBe(8_000_000);
    }
  });

  it("supports negative and positive scenario assumptions without presenting them as forecasts", () => {
    const result = buildLongTermGoalProgress({
      currentNetAssetsJpy: 12_000_000,
      targetNetAssetsJpy: 20_000_000,
      targetDate: "2030-12-31",
      annualDividendJpy: 300_000,
      annualInterestIncomeJpy: 50_000,
      annualBorrowingInterestJpy: 0,
      targetAnnualDividendJpy: 600_000,
      targetAnnualInterestJpy: 100_000,
      targetAnnualNetCashJpy: 700_000,
      conservativeReturnPct: -10,
      baseReturnPct: 0,
      optimisticReturnPct: 10,
      now: new Date("2029-12-31T15:00:00.000Z"),
    });

    expect(result.scenarios[0]?.investmentGrowthJpy).toBeLessThan(0);
    expect(result.scenarios[1]?.projectedNetAssetsJpy).toBe(12_000_000);
    expect(result.scenarios[2]?.investmentGrowthJpy).toBeGreaterThan(0);
    expect(result.annualDividend.progressPct).toBe(50);
    expect(result.annualInterest.progressPct).toBe(50);
    expect(result.annualNetCash.progressPct).toBe(50);
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
    expect(result.scenarios.every(item => item.projectedNetAssetsJpy === null)).toBe(true);
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
    expect(achieved.scenarios[0]?.attainmentStatus).toBe("ALREADY_ACHIEVED");
    expect(achieved.scenarios[0]?.estimatedMonthsToTarget).toBe(0);
    expect(achieved.scenarios[0]?.requiredMonthlyContributionJpy).toBe(0);
    expect(overdue.status).toBe("OVERDUE");
    expect(overdue.requiredAnnualGrowthPct).toBeNull();
    expect(overdue.scenarios[0]?.requiredMonthlyContributionJpy).toBeNull();
  });

  it("estimates a separate attainment month and 2030 monthly contribution for each formal scenario", () => {
    const result = buildLongTermGoalProgress({
      currentNetAssetsJpy: 730_822_351,
      targetNetAssetsJpy: 100_000_000_000,
      targetDate: "2030-12-31",
      annualDividendJpy: 22_254_225,
      annualInterestIncomeJpy: 3_195_330,
      annualBorrowingInterestJpy: 3_899_093,
      annualContributionJpy: 120_000_000,
      conservativeReturnPct: 4,
      baseReturnPct: 8,
      optimisticReturnPct: 12,
      now: new Date("2026-09-07T00:00:00.000Z"),
    });

    const [conservative, base, optimistic] = result.scenarios;
    expect(conservative?.attainmentStatus).toBe("ESTIMATED");
    expect(base?.attainmentStatus).toBe("ESTIMATED");
    expect(optimistic?.attainmentStatus).toBe("ESTIMATED");
    expect(conservative!.estimatedMonthsToTarget!).toBeGreaterThan(
      base!.estimatedMonthsToTarget!
    );
    expect(base!.estimatedMonthsToTarget!).toBeGreaterThan(
      optimistic!.estimatedMonthsToTarget!
    );
    expect(conservative?.estimatedTargetMonth).toMatch(/^2\d{3}-\d{2}$/);
    expect(conservative!.requiredMonthlyContributionJpy!).toBeGreaterThan(
      10_000_000
    );
    expect(conservative!.requiredMonthlyContributionJpy!).toBeGreaterThan(
      base!.requiredMonthlyContributionJpy!
    );
    expect(base!.requiredMonthlyContributionJpy!).toBeGreaterThan(
      optimistic!.requiredMonthlyContributionJpy!
    );
    expect(conservative!.additionalMonthlyContributionJpy!).toBeCloseTo(
      conservative!.requiredMonthlyContributionJpy! - 10_000_000,
      6
    );
  });

  it("marks a zero or negative growth plan without contributions as beyond the 100-year horizon", () => {
    const result = buildLongTermGoalProgress({
      currentNetAssetsJpy: 10_000_000,
      targetNetAssetsJpy: 20_000_000,
      targetDate: "2030-12-31",
      annualDividendJpy: 0,
      annualInterestIncomeJpy: 0,
      annualBorrowingInterestJpy: 0,
      annualContributionJpy: 0,
      conservativeReturnPct: -10,
      baseReturnPct: 0,
      optimisticReturnPct: 1,
      now: new Date("2026-09-07T00:00:00.000Z"),
    });

    expect(result.scenarios[0]?.attainmentStatus).toBe("BEYOND_HORIZON");
    expect(result.scenarios[1]?.attainmentStatus).toBe("BEYOND_HORIZON");
    expect(result.scenarios[0]?.estimatedTargetMonth).toBeNull();
    expect(result.scenarios[1]?.estimatedMonthsToTarget).toBeNull();
    expect(result.scenarios[1]!.requiredMonthlyContributionJpy!).toBeGreaterThan(0);
  });
});
