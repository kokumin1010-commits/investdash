const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.2425;

export type LongTermGoalStatus =
  | "NOT_SET"
  | "ACTIVE"
  | "HIGH_CHALLENGE"
  | "ACHIEVED"
  | "OVERDUE";

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
  now?: Date;
};

export type IncomeProgress = {
  currentJpy: number | null;
  targetJpy: number | null;
  progressPct: number | null;
  gapJpy: number | null;
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

/**
 * 长期目标只做进度与安全检查，不返回买卖行动，也不进入任何 ranking 输入。
 * 目标日期按 JST 日历日终了扱い，避免浏览器时区改变剩余日数。
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
  };
}
