const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.2425;

export type LongTermGoalStatus =
  | "NOT_SET"
  | "ACTIVE"
  | "HIGH_CHALLENGE"
  | "ACHIEVED"
  | "OVERDUE";

export const DEFAULT_LONG_TERM_SCENARIO_RATES = {
  conservative: 4,
  base: 8,
  optimistic: 12,
} as const;

export type LongTermGoalScenarioKey = "CONSERVATIVE" | "BASE" | "OPTIMISTIC";

export type LongTermGoalInput = {
  currentNetAssetsJpy: number | null | undefined;
  targetNetAssetsJpy: number | null | undefined;
  targetDate: string | null | undefined;
  annualDividendJpy: number | null | undefined;
  annualInterestIncomeJpy: number | null | undefined;
  annualBorrowingInterestJpy: number | null | undefined;
  targetAnnualDividendJpy?: number | null;
  targetAnnualInterestJpy?: number | null;
  targetAnnualNetCashJpy?: number | null;
  annualContributionJpy?: number | null;
  conservativeReturnPct?: number | null;
  baseReturnPct?: number | null;
  optimisticReturnPct?: number | null;
  now?: Date;
};

export type IncomeProgress = {
  currentJpy: number | null;
  targetJpy: number | null;
  progressPct: number | null;
  gapJpy: number | null;
};

export type LongTermGoalScenario = {
  key: LongTermGoalScenarioKey;
  label: string;
  annualReturnPct: number;
  projectedNetAssetsJpy: number | null;
  totalContributionJpy: number | null;
  investmentGrowthJpy: number | null;
  targetProgressPct: number | null;
  gapJpy: number | null;
  achievesTarget: boolean | null;
};

export type LongTermGoalProgress = {
  configured: boolean;
  status: LongTermGoalStatus;
  currentNetAssetsJpy: number | null;
  targetNetAssetsJpy: number | null;
  targetDate: string | null;
  progressPct: number | null;
  remainingJpy: number | null;
  daysRemaining: number | null;
  yearsRemaining: number | null;
  requiredAnnualGrowthPct: number | null;
  assetMultiple: number | null;
  annualDividend: IncomeProgress;
  annualInterest: IncomeProgress;
  annualBorrowingInterestJpy: number | null;
  annualNetCash: IncomeProgress;
  annualContributionJpy: number;
  scenarioRatesDefaulted: boolean;
  scenarios: LongTermGoalScenario[];
};

function finiteNonNegative(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function progress(current: number | null, target: number | null): IncomeProgress {
  return {
    currentJpy: current,
    targetJpy: target,
    progressPct:
      current !== null && target !== null && target > 0
        ? (current / target) * 100
        : null,
    gapJpy:
      current !== null && target !== null ? Math.max(0, target - current) : null,
  };
}

function finiteScenarioRate(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= -50 && value <= 100
    ? value
    : fallback;
}

function buildScenario(params: {
  key: LongTermGoalScenarioKey;
  label: string;
  annualReturnPct: number;
  currentNetAssetsJpy: number | null;
  targetNetAssetsJpy: number | null;
  monthsRemaining: number | null;
  annualContributionJpy: number;
}): LongTermGoalScenario {
  const {
    key,
    label,
    annualReturnPct,
    currentNetAssetsJpy,
    targetNetAssetsJpy,
    monthsRemaining,
    annualContributionJpy,
  } = params;
  if (
    currentNetAssetsJpy === null ||
    targetNetAssetsJpy === null ||
    targetNetAssetsJpy <= 0 ||
    monthsRemaining === null
  ) {
    return {
      key,
      label,
      annualReturnPct,
      projectedNetAssetsJpy: null,
      totalContributionJpy: null,
      investmentGrowthJpy: null,
      targetProgressPct: null,
      gapJpy: null,
      achievesTarget: null,
    };
  }

  const monthlyRate = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
  const growthFactor = Math.pow(1 + monthlyRate, monthsRemaining);
  const monthlyContribution = annualContributionJpy / 12;
  const contributionFutureValue =
    Math.abs(monthlyRate) < 1e-12
      ? monthlyContribution * monthsRemaining
      : monthlyContribution * ((growthFactor - 1) / monthlyRate);
  const totalContributionJpy = monthlyContribution * monthsRemaining;
  const projectedNetAssetsJpy =
    currentNetAssetsJpy * growthFactor + contributionFutureValue;
  const investmentGrowthJpy =
    projectedNetAssetsJpy - currentNetAssetsJpy - totalContributionJpy;

  return {
    key,
    label,
    annualReturnPct,
    projectedNetAssetsJpy,
    totalContributionJpy,
    investmentGrowthJpy,
    targetProgressPct: (projectedNetAssetsJpy / targetNetAssetsJpy) * 100,
    gapJpy: Math.max(0, targetNetAssetsJpy - projectedNetAssetsJpy),
    achievesTarget: projectedNetAssetsJpy >= targetNetAssetsJpy,
  };
}

/**
 * 长期目标只做进度与安全检查，不返回买卖行动，也不进入任何 ranking 输入。
 * 目标日期按 JST 日历日终了扱い。情景按名义年率月复利、年度入金12等分月末投入。
 */
export function buildLongTermGoalProgress(
  input: LongTermGoalInput
): LongTermGoalProgress {
  const current = finiteNonNegative(input.currentNetAssetsJpy);
  const target = finiteNonNegative(input.targetNetAssetsJpy);
  const targetDate = input.targetDate?.trim() || null;
  const configured = target !== null && target > 0 && targetDate !== null;
  const now = input.now ?? new Date();
  const targetAt = targetDate
    ? new Date(`${targetDate}T23:59:59.999+09:00`)
    : null;
  const validTargetDate = targetAt && Number.isFinite(targetAt.getTime()) ? targetAt : null;
  const daysRemaining = validTargetDate
    ? Math.ceil((validTargetDate.getTime() - now.getTime()) / MS_PER_DAY)
    : null;
  const yearsRemaining =
    daysRemaining !== null && daysRemaining > 0
      ? daysRemaining / DAYS_PER_YEAR
      : null;
  const progressPct =
    configured && current !== null ? (current / target) * 100 : null;
  const remainingJpy =
    configured && current !== null ? Math.max(0, target - current) : null;
  const assetMultiple =
    configured && current !== null && current > 0 ? target / current : null;
  const requiredAnnualGrowthPct =
    configured &&
    current !== null &&
    current > 0 &&
    target > current &&
    yearsRemaining !== null
      ? (Math.pow(target / current, 1 / yearsRemaining) - 1) * 100
      : configured && current !== null && current >= target
        ? 0
        : null;

  let status: LongTermGoalStatus = "NOT_SET";
  if (configured && current !== null) {
    if (current >= target) status = "ACHIEVED";
    else if (daysRemaining !== null && daysRemaining <= 0) status = "OVERDUE";
    else if (
      (assetMultiple !== null && assetMultiple >= 10) ||
      (requiredAnnualGrowthPct !== null && requiredAnnualGrowthPct > 50)
    )
      status = "HIGH_CHALLENGE";
    else status = "ACTIVE";
  }

  const annualDividend = finiteNonNegative(input.annualDividendJpy);
  const annualInterest = finiteNonNegative(input.annualInterestIncomeJpy);
  const annualBorrowingInterest = finiteNonNegative(
    input.annualBorrowingInterestJpy
  );
  const annualNetCash =
    annualDividend !== null &&
    annualInterest !== null &&
    annualBorrowingInterest !== null
      ? annualDividend + annualInterest - annualBorrowingInterest
      : null;
  const annualContribution = finiteNonNegative(input.annualContributionJpy) ?? 0;
  const scenarioRatesDefaulted =
    input.conservativeReturnPct === null ||
    input.conservativeReturnPct === undefined ||
    input.baseReturnPct === null ||
    input.baseReturnPct === undefined ||
    input.optimisticReturnPct === null ||
    input.optimisticReturnPct === undefined;
  const conservativeRate = finiteScenarioRate(
    input.conservativeReturnPct,
    DEFAULT_LONG_TERM_SCENARIO_RATES.conservative
  );
  const baseRate = finiteScenarioRate(
    input.baseReturnPct,
    DEFAULT_LONG_TERM_SCENARIO_RATES.base
  );
  const optimisticRate = finiteScenarioRate(
    input.optimisticReturnPct,
    DEFAULT_LONG_TERM_SCENARIO_RATES.optimistic
  );
  const monthsRemaining =
    daysRemaining !== null && daysRemaining > 0
      ? Math.ceil(daysRemaining / (DAYS_PER_YEAR / 12))
      : configured && current !== null && current >= target
        ? 0
        : null;
  const scenarios = [
    buildScenario({
      key: "CONSERVATIVE",
      label: "保守",
      annualReturnPct: conservativeRate,
      currentNetAssetsJpy: current,
      targetNetAssetsJpy: target,
      monthsRemaining,
      annualContributionJpy: annualContribution,
    }),
    buildScenario({
      key: "BASE",
      label: "基準",
      annualReturnPct: baseRate,
      currentNetAssetsJpy: current,
      targetNetAssetsJpy: target,
      monthsRemaining,
      annualContributionJpy: annualContribution,
    }),
    buildScenario({
      key: "OPTIMISTIC",
      label: "楽観",
      annualReturnPct: optimisticRate,
      currentNetAssetsJpy: current,
      targetNetAssetsJpy: target,
      monthsRemaining,
      annualContributionJpy: annualContribution,
    }),
  ];

  return {
    configured,
    status,
    currentNetAssetsJpy: current,
    targetNetAssetsJpy: target,
    targetDate,
    progressPct,
    remainingJpy,
    daysRemaining,
    yearsRemaining,
    requiredAnnualGrowthPct,
    assetMultiple,
    annualDividend: progress(
      annualDividend,
      finiteNonNegative(input.targetAnnualDividendJpy)
    ),
    annualInterest: progress(
      annualInterest,
      finiteNonNegative(input.targetAnnualInterestJpy)
    ),
    annualBorrowingInterestJpy: annualBorrowingInterest,
    annualNetCash: progress(
      annualNetCash,
      finiteNonNegative(input.targetAnnualNetCashJpy)
    ),
    annualContributionJpy: annualContribution,
    scenarioRatesDefaulted,
    scenarios,
  };
}
