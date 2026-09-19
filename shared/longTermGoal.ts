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
  /** 現在の株式時価。情景年率はこの部分だけに適用する */
  stockAssetsJpy?: number | null;
  /** 利息の付かない通常現金。試算では横ばい */
  cashJpy?: number | null;
  /** 現金宝・貨幣基金の現在元本。日次複利で別計算する */
  interestAssetsJpy?: number | null;
  /** 借入元本。返済せず一定とし、利息だけを費用計上する */
  borrowedPrincipalJpy?: number | null;
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
  stockPriceChangeJpy: number | null;
  reinvestedDividendJpy: number | null;
  compoundedInterestJpy: number | null;
  borrowingInterestCostJpy: number | null;
  targetProgressPct: number | null;
  gapJpy: number | null;
  achievesTarget: boolean | null;
  estimatedMonthsToTarget: number | null;
  estimatedTargetMonth: string | null;
  attainmentStatus:
    | "ALREADY_ACHIEVED"
    | "ESTIMATED"
    | "BEYOND_HORIZON"
    | "UNAVAILABLE";
  requiredMonthlyContributionJpy: number | null;
  additionalMonthlyContributionJpy: number | null;
};

export type LongTermProjectionBasis = {
  stockAssetsJpy: number | null;
  cashJpy: number | null;
  interestAssetsJpy: number | null;
  borrowedPrincipalJpy: number | null;
  reconciliationJpy: number | null;
  annualDividendJpy: number | null;
  dividendYieldPct: number | null;
  annualInterestJpy: number | null;
  interestEffectiveRatePct: number | null;
  annualBorrowingInterestJpy: number | null;
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
  projectionBasis: LongTermProjectionBasis;
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

const MAX_ATTAINMENT_MONTHS = 1_200;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function monthlyRateFromAnnualPct(annualReturnPct: number) {
  return Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
}

function formatJstMonthAfter(now: Date, monthsAfter: number) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const monthIndex =
    jst.getUTCFullYear() * 12 + jst.getUTCMonth() + monthsAfter;
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

type ComponentProjectionBasis = {
  stockAssetsJpy: number;
  cashJpy: number;
  interestAssetsJpy: number;
  borrowedPrincipalJpy: number;
  reconciliationJpy: number;
  annualDividendJpy: number;
  annualInterestJpy: number;
  annualBorrowingInterestJpy: number;
};

type ComponentProjectionResult = {
  projectedNetAssetsJpy: number;
  totalContributionJpy: number;
  stockPriceChangeJpy: number;
  reinvestedDividendJpy: number;
  compoundedInterestJpy: number;
  borrowingInterestCostJpy: number;
};

/**
 * 株式価格、配当再投資、現金宝、借入コストを別々に月次ロールする。
 * - 情景年率は株価変動だけ
 * - 配当は現在の税引前利回りを一定と置き、毎月末に全額再投資
 * - 現金宝は現在の実効年利を月次等価率へ変換（元の計算は日次複利）
 * - 借入元本は返済せず一定、現在の年間利息を12等分して支払う
 * - 追加入金は従来どおり毎月末に株式へ投入
 */
function projectComponents(params: {
  basis: ComponentProjectionBasis;
  annualReturnPct: number;
  months: number;
  monthlyContributionJpy: number;
}): ComponentProjectionResult {
  const { basis, annualReturnPct, months, monthlyContributionJpy } = params;
  const stockMonthlyRate = monthlyRateFromAnnualPct(annualReturnPct);
  const monthlyDividendYield =
    basis.stockAssetsJpy > 0
      ? basis.annualDividendJpy / basis.stockAssetsJpy / 12
      : 0;
  const interestEffectiveAnnualRate =
    basis.interestAssetsJpy > 0
      ? Math.max(0, basis.annualInterestJpy / basis.interestAssetsJpy)
      : 0;
  const interestMonthlyRate =
    Math.pow(1 + interestEffectiveAnnualRate, 1 / 12) - 1;
  const monthlyBorrowingCost = basis.annualBorrowingInterestJpy / 12;

  let stock = basis.stockAssetsJpy;
  let interestAssets = basis.interestAssetsJpy;
  let stockPriceChangeJpy = 0;
  let reinvestedDividendJpy = 0;
  let compoundedInterestJpy = 0;
  let borrowingInterestCostJpy = 0;

  for (let month = 0; month < months; month += 1) {
    const stockPriceChange = stock * stockMonthlyRate;
    stock += stockPriceChange;
    stockPriceChangeJpy += stockPriceChange;

    const dividend = stock * monthlyDividendYield;
    stock += dividend;
    reinvestedDividendJpy += dividend;

    const interest = interestAssets * interestMonthlyRate;
    interestAssets += interest;
    compoundedInterestJpy += interest;

    stock += monthlyContributionJpy - monthlyBorrowingCost;
    borrowingInterestCostJpy += monthlyBorrowingCost;
  }

  return {
    projectedNetAssetsJpy:
      stock +
      basis.cashJpy +
      interestAssets +
      basis.reconciliationJpy -
      basis.borrowedPrincipalJpy,
    totalContributionJpy: monthlyContributionJpy * months,
    stockPriceChangeJpy,
    reinvestedDividendJpy,
    compoundedInterestJpy,
    borrowingInterestCostJpy,
  };
}

function estimateComponentAttainment(params: {
  basis: ComponentProjectionBasis;
  targetNetAssetsJpy: number;
  annualReturnPct: number;
  annualContributionJpy: number;
  now: Date;
}) {
  const currentNetAssetsJpy =
    params.basis.stockAssetsJpy +
    params.basis.cashJpy +
    params.basis.interestAssetsJpy +
    params.basis.reconciliationJpy -
    params.basis.borrowedPrincipalJpy;
  if (currentNetAssetsJpy >= params.targetNetAssetsJpy) {
    return {
      estimatedMonthsToTarget: 0,
      estimatedTargetMonth: formatJstMonthAfter(params.now, 0),
      attainmentStatus: "ALREADY_ACHIEVED" as const,
    };
  }
  for (let month = 1; month <= MAX_ATTAINMENT_MONTHS; month += 1) {
    const projected = projectComponents({
      basis: params.basis,
      annualReturnPct: params.annualReturnPct,
      months: month,
      monthlyContributionJpy: params.annualContributionJpy / 12,
    });
    if (projected.projectedNetAssetsJpy >= params.targetNetAssetsJpy) {
      return {
        estimatedMonthsToTarget: month,
        estimatedTargetMonth: formatJstMonthAfter(params.now, month),
        attainmentStatus: "ESTIMATED" as const,
      };
    }
  }
  return {
    estimatedMonthsToTarget: null,
    estimatedTargetMonth: null,
    attainmentStatus: "BEYOND_HORIZON" as const,
  };
}

function requiredComponentMonthlyContribution(params: {
  basis: ComponentProjectionBasis;
  targetNetAssetsJpy: number;
  annualReturnPct: number;
  monthsRemaining: number;
  currentMonthlyContributionJpy: number;
}) {
  if (params.monthsRemaining <= 0) {
    return {
      requiredMonthlyContributionJpy: null,
      additionalMonthlyContributionJpy: null,
    };
  }
  const projectedAt = (monthlyContributionJpy: number) =>
    projectComponents({
      basis: params.basis,
      annualReturnPct: params.annualReturnPct,
      months: params.monthsRemaining,
      monthlyContributionJpy,
    }).projectedNetAssetsJpy;
  if (projectedAt(0) >= params.targetNetAssetsJpy) {
    return {
      requiredMonthlyContributionJpy: 0,
      additionalMonthlyContributionJpy: 0,
    };
  }

  let low = 0;
  let high = Math.max(1, params.targetNetAssetsJpy / params.monthsRemaining);
  for (let attempt = 0; attempt < 80 && projectedAt(high) < params.targetNetAssetsJpy; attempt += 1) {
    high *= 2;
  }
  if (!Number.isFinite(high) || projectedAt(high) < params.targetNetAssetsJpy) {
    return {
      requiredMonthlyContributionJpy: null,
      additionalMonthlyContributionJpy: null,
    };
  }
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const mid = (low + high) / 2;
    if (projectedAt(mid) >= params.targetNetAssetsJpy) high = mid;
    else low = mid;
  }
  return {
    requiredMonthlyContributionJpy: high,
    additionalMonthlyContributionJpy: Math.max(
      0,
      high - params.currentMonthlyContributionJpy
    ),
  };
}

function estimateAttainment(params: {
  currentNetAssetsJpy: number | null;
  targetNetAssetsJpy: number | null;
  annualReturnPct: number;
  annualContributionJpy: number;
  now: Date;
}) {
  const {
    currentNetAssetsJpy,
    targetNetAssetsJpy,
    annualReturnPct,
    annualContributionJpy,
    now,
  } = params;
  if (
    currentNetAssetsJpy === null ||
    targetNetAssetsJpy === null ||
    targetNetAssetsJpy <= 0
  ) {
    return {
      estimatedMonthsToTarget: null,
      estimatedTargetMonth: null,
      attainmentStatus: "UNAVAILABLE" as const,
    };
  }
  if (currentNetAssetsJpy >= targetNetAssetsJpy) {
    return {
      estimatedMonthsToTarget: 0,
      estimatedTargetMonth: formatJstMonthAfter(now, 0),
      attainmentStatus: "ALREADY_ACHIEVED" as const,
    };
  }

  const monthlyRate = monthlyRateFromAnnualPct(annualReturnPct);
  const monthlyContribution = annualContributionJpy / 12;
  let balance = currentNetAssetsJpy;
  for (let month = 1; month <= MAX_ATTAINMENT_MONTHS; month += 1) {
    balance = balance * (1 + monthlyRate) + monthlyContribution;
    if (balance >= targetNetAssetsJpy) {
      return {
        estimatedMonthsToTarget: month,
        estimatedTargetMonth: formatJstMonthAfter(now, month),
        attainmentStatus: "ESTIMATED" as const,
      };
    }
  }
  return {
    estimatedMonthsToTarget: null,
    estimatedTargetMonth: null,
    attainmentStatus: "BEYOND_HORIZON" as const,
  };
}

function requiredMonthlyContribution(params: {
  currentNetAssetsJpy: number | null;
  targetNetAssetsJpy: number | null;
  annualReturnPct: number;
  monthsRemaining: number | null;
  currentMonthlyContributionJpy: number;
}) {
  const {
    currentNetAssetsJpy,
    targetNetAssetsJpy,
    annualReturnPct,
    monthsRemaining,
    currentMonthlyContributionJpy,
  } = params;
  if (
    currentNetAssetsJpy === null ||
    targetNetAssetsJpy === null ||
    targetNetAssetsJpy <= 0 ||
    monthsRemaining === null ||
    monthsRemaining <= 0
  ) {
    return {
      requiredMonthlyContributionJpy: null,
      additionalMonthlyContributionJpy: null,
    };
  }

  const monthlyRate = monthlyRateFromAnnualPct(annualReturnPct);
  const growthFactor = Math.pow(1 + monthlyRate, monthsRemaining);
  const annuityFactor =
    Math.abs(monthlyRate) < 1e-12
      ? monthsRemaining
      : (growthFactor - 1) / monthlyRate;
  if (!Number.isFinite(annuityFactor) || annuityFactor <= 0) {
    return {
      requiredMonthlyContributionJpy: null,
      additionalMonthlyContributionJpy: null,
    };
  }
  const required = Math.max(
    0,
    (targetNetAssetsJpy - currentNetAssetsJpy * growthFactor) / annuityFactor
  );
  return {
    requiredMonthlyContributionJpy: required,
    additionalMonthlyContributionJpy: Math.max(
      0,
      required - currentMonthlyContributionJpy
    ),
  };
}

function buildScenario(params: {
  key: LongTermGoalScenarioKey;
  label: string;
  annualReturnPct: number;
  currentNetAssetsJpy: number | null;
  targetNetAssetsJpy: number | null;
  monthsRemaining: number | null;
  annualContributionJpy: number;
  projectionBasis: ComponentProjectionBasis | null;
  now: Date;
}): LongTermGoalScenario {
  const {
    key,
    label,
    annualReturnPct,
    currentNetAssetsJpy,
    targetNetAssetsJpy,
    monthsRemaining,
    annualContributionJpy,
    projectionBasis,
    now,
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
      stockPriceChangeJpy: null,
      reinvestedDividendJpy: null,
      compoundedInterestJpy: null,
      borrowingInterestCostJpy: null,
      targetProgressPct: null,
      gapJpy: null,
      achievesTarget: null,
      estimatedMonthsToTarget: null,
      estimatedTargetMonth: null,
      attainmentStatus: "UNAVAILABLE",
      requiredMonthlyContributionJpy: null,
      additionalMonthlyContributionJpy: null,
    };
  }

  if (projectionBasis) {
    const projected = projectComponents({
      basis: projectionBasis,
      annualReturnPct,
      months: monthsRemaining,
      monthlyContributionJpy: annualContributionJpy / 12,
    });
    const attainment = estimateComponentAttainment({
      basis: projectionBasis,
      targetNetAssetsJpy,
      annualReturnPct,
      annualContributionJpy,
      now,
    });
    const requiredContribution = requiredComponentMonthlyContribution({
      basis: projectionBasis,
      targetNetAssetsJpy,
      annualReturnPct,
      monthsRemaining,
      currentMonthlyContributionJpy: annualContributionJpy / 12,
    });
    const investmentGrowthJpy =
      projected.stockPriceChangeJpy +
      projected.reinvestedDividendJpy +
      projected.compoundedInterestJpy -
      projected.borrowingInterestCostJpy;
    return {
      key,
      label,
      annualReturnPct,
      ...projected,
      investmentGrowthJpy,
      targetProgressPct:
        (projected.projectedNetAssetsJpy / targetNetAssetsJpy) * 100,
      gapJpy: Math.max(
        0,
        targetNetAssetsJpy - projected.projectedNetAssetsJpy
      ),
      achievesTarget: projected.projectedNetAssetsJpy >= targetNetAssetsJpy,
      ...attainment,
      ...requiredContribution,
    };
  }

  const attainment = estimateAttainment({
    currentNetAssetsJpy,
    targetNetAssetsJpy,
    annualReturnPct,
    annualContributionJpy,
    now,
  });
  const requiredContribution = requiredMonthlyContribution({
    currentNetAssetsJpy,
    targetNetAssetsJpy,
    annualReturnPct,
    monthsRemaining,
    currentMonthlyContributionJpy: annualContributionJpy / 12,
  });

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
    stockPriceChangeJpy: investmentGrowthJpy,
    reinvestedDividendJpy: 0,
    compoundedInterestJpy: 0,
    borrowingInterestCostJpy: 0,
    targetProgressPct: (projectedNetAssetsJpy / targetNetAssetsJpy) * 100,
    gapJpy: Math.max(0, targetNetAssetsJpy - projectedNetAssetsJpy),
    achievesTarget: projectedNetAssetsJpy >= targetNetAssetsJpy,
    ...attainment,
    ...requiredContribution,
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
  const stockAssets = finiteNonNegative(input.stockAssetsJpy);
  const cash = finiteNonNegative(input.cashJpy);
  const interestAssets = finiteNonNegative(input.interestAssetsJpy);
  const borrowedPrincipal = finiteNonNegative(input.borrowedPrincipalJpy);
  const reconciliation =
    current !== null &&
    stockAssets !== null &&
    cash !== null &&
    interestAssets !== null &&
    borrowedPrincipal !== null
      ? current - (stockAssets + cash + interestAssets - borrowedPrincipal)
      : null;
  const componentBasis: ComponentProjectionBasis | null =
    stockAssets !== null &&
    cash !== null &&
    interestAssets !== null &&
    borrowedPrincipal !== null &&
    reconciliation !== null &&
    annualDividend !== null &&
    annualInterest !== null &&
    annualBorrowingInterest !== null
      ? {
          stockAssetsJpy: stockAssets,
          cashJpy: cash,
          interestAssetsJpy: interestAssets,
          borrowedPrincipalJpy: borrowedPrincipal,
          reconciliationJpy: reconciliation,
          annualDividendJpy: annualDividend,
          annualInterestJpy: annualInterest,
          annualBorrowingInterestJpy: annualBorrowingInterest,
        }
      : null;
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
      projectionBasis: componentBasis,
      now,
    }),
    buildScenario({
      key: "BASE",
      label: "基準",
      annualReturnPct: baseRate,
      currentNetAssetsJpy: current,
      targetNetAssetsJpy: target,
      monthsRemaining,
      annualContributionJpy: annualContribution,
      projectionBasis: componentBasis,
      now,
    }),
    buildScenario({
      key: "OPTIMISTIC",
      label: "楽観",
      annualReturnPct: optimisticRate,
      currentNetAssetsJpy: current,
      targetNetAssetsJpy: target,
      monthsRemaining,
      annualContributionJpy: annualContribution,
      projectionBasis: componentBasis,
      now,
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
    projectionBasis: {
      stockAssetsJpy: stockAssets,
      cashJpy: cash,
      interestAssetsJpy: interestAssets,
      borrowedPrincipalJpy: borrowedPrincipal,
      reconciliationJpy: reconciliation,
      annualDividendJpy: annualDividend,
      dividendYieldPct:
        stockAssets !== null && stockAssets > 0 && annualDividend !== null
          ? (annualDividend / stockAssets) * 100
          : null,
      annualInterestJpy: annualInterest,
      interestEffectiveRatePct:
        interestAssets !== null && interestAssets > 0 && annualInterest !== null
          ? (annualInterest / interestAssets) * 100
          : null,
      annualBorrowingInterestJpy: annualBorrowingInterest,
    },
    scenarioRatesDefaulted,
    scenarios,
  };
}
