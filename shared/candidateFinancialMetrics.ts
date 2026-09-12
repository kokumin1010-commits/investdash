export const CANDIDATE_FINANCIAL_VERSION = "candidate-financial-v1";
export const CANDIDATE_FINANCIAL_SOURCE = "Yahoo Finance fundamentals-timeseries";

export type CandidateMetricStatus =
  | "AVAILABLE"
  | "NOT_MEANINGFUL"
  | "UNAVAILABLE";

export type CandidateMetricUnit = "PERCENT" | "RATIO" | "CURRENCY";

export type CandidateFinancialMetric = {
  status: CandidateMetricStatus;
  value: number | null;
  unit: CandidateMetricUnit;
  currency: string | null;
  asOfDate: string | null;
  period: string | null;
  basis: string;
  source: string;
};

export type CandidateIndustryClass = "ORDINARY" | "FINANCIAL" | "REIT";

export type CandidateFinancialMetrics = {
  version: string;
  symbol: string;
  source: string;
  fetchedAt: string;
  currency: string | null;
  currentPrice: number | null;
  priceAsOfDate: string | null;
  marketAsOfDate: string | null;
  fiscalPeriodEnd: string | null;
  industryClass: CandidateIndustryClass;
  dataQuality: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  notes: string[];
  metrics: {
    forecastDividendYieldPct: CandidateFinancialMetric;
    trailingPe: CandidateFinancialMetric;
    priceToBook: CandidateFinancialMetric;
    marketCap: CandidateFinancialMetric;
    roePct: CandidateFinancialMetric;
    roicPct: CandidateFinancialMetric;
    operatingMarginPct: CandidateFinancialMetric;
    freeCashFlow: CandidateFinancialMetric;
    fcfYieldPct: CandidateFinancialMetric;
    netCash: CandidateFinancialMetric;
    revenueGrowthPct: CandidateFinancialMetric;
    epsGrowthPct: CandidateFinancialMetric;
    payoutRatioPct: CandidateFinancialMetric;
    dividendGrowthPct: CandidateFinancialMetric;
  };
};

export type CandidateSizingStatus =
  | "RESEARCH_ONLY"
  | "PRICE_WAIT"
  | "HELD"
  | "UNAVAILABLE";

export type CandidateSizingView = {
  status: CandidateSizingStatus;
  engineStatus:
    | "BUY"
    | "WAIT"
    | "BLOCKED_MARGIN"
    | "BLOCKED_POSITION"
    | "BLOCKED_SECTOR"
    | "TOO_SMALL"
    | "UNAVAILABLE";
  currentQuantity: number;
  currentWeightPct: number;
  recommendedShares: number | null;
  recommendedAmountLocal: number | null;
  recommendedAmountBase: number | null;
  afterQuantity: number | null;
  afterWeightPct: number | null;
  currency: string | null;
  tranchePct: number;
  trancheCount: number | null;
  trancheLabel: string;
  nextTrancheCondition: string;
  constraints: string[];
  fundingMode: "CASH_ONLY";
  basis: string;
};

export type CandidateCardInsight = {
  symbol: string;
  financials: CandidateFinancialMetrics;
  sizing: CandidateSizingView;
};

export type CandidateFinancialSeriesPoint = {
  asOfDate: string;
  periodType: string | null;
  currencyCode: string | null;
  value: number;
};

export type CandidateFinancialSeries = Record<
  string,
  CandidateFinancialSeriesPoint[]
>;

export type CandidateDividendBasis = {
  available: boolean;
  recurringAnnualDividend: number | null;
  count: number;
  lastDate: string | null;
  hasSpecialDividend: boolean;
};

export type NormalizeCandidateFinancialInput = {
  symbol: string;
  sector: string | null;
  industry: string | null;
  currentPrice: number | null;
  priceCurrency: string | null;
  priceAsOfDate: string | null;
  fetchedAt: string;
  series: CandidateFinancialSeries;
  dividend: CandidateDividendBasis;
};

const FINANCIAL_PATTERN =
  /bank|banks|insurance|financial services|credit services|capital markets|asset management|銀行|保険|証券|金融/i;
const REIT_PATTERN = /\breit\b|real estate investment trust|投資法人|不動産投資信託/i;

export function classifyCandidateIndustry(
  sector: string | null,
  industry: string | null
): CandidateIndustryClass {
  const text = `${sector ?? ""} ${industry ?? ""}`;
  if (REIT_PATTERN.test(text)) return "REIT";
  if (FINANCIAL_PATTERN.test(text)) return "FINANCIAL";
  return "ORDINARY";
}

function unavailable(
  unit: CandidateMetricUnit,
  basis: string,
  source = CANDIDATE_FINANCIAL_SOURCE,
  currency: string | null = null
): CandidateFinancialMetric {
  return {
    status: "UNAVAILABLE",
    value: null,
    unit,
    currency,
    asOfDate: null,
    period: null,
    basis,
    source,
  };
}

function notMeaningful(
  unit: CandidateMetricUnit,
  basis: string,
  point?: CandidateFinancialSeriesPoint | null,
  source = CANDIDATE_FINANCIAL_SOURCE
): CandidateFinancialMetric {
  return {
    status: "NOT_MEANINGFUL",
    value: null,
    unit,
    currency: point?.currencyCode ?? null,
    asOfDate: point?.asOfDate ?? null,
    period: point?.periodType ?? null,
    basis,
    source,
  };
}

function available(
  value: number,
  unit: CandidateMetricUnit,
  basis: string,
  point: CandidateFinancialSeriesPoint | null,
  source = CANDIDATE_FINANCIAL_SOURCE,
  currency?: string | null
): CandidateFinancialMetric {
  return {
    status: "AVAILABLE",
    value,
    unit,
    currency: currency === undefined ? point?.currencyCode ?? null : currency,
    asOfDate: point?.asOfDate ?? null,
    period: point?.periodType ?? null,
    basis,
    source,
  };
}

function points(
  series: CandidateFinancialSeries,
  key: string
): CandidateFinancialSeriesPoint[] {
  return [...(series[key] ?? [])]
    .filter(point => Number.isFinite(point.value))
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
}

function latest(
  series: CandidateFinancialSeries,
  key: string
): CandidateFinancialSeriesPoint | null {
  const list = points(series, key);
  return list[list.length - 1] ?? null;
}

function previous(
  series: CandidateFinancialSeries,
  key: string
): CandidateFinancialSeriesPoint | null {
  const list = points(series, key);
  return list[list.length - 2] ?? null;
}

function sameCurrency(
  first: CandidateFinancialSeriesPoint | null,
  second: CandidateFinancialSeriesPoint | null
): boolean {
  return Boolean(
    first &&
      second &&
      first.currencyCode &&
      second.currencyCode &&
      first.currencyCode === second.currencyCode
  );
}

function yearOverYearMetric(
  current: CandidateFinancialSeriesPoint | null,
  prior: CandidateFinancialSeriesPoint | null,
  basis: string,
  denominatorMustBePositive = false
): CandidateFinancialMetric {
  if (!current || !prior) {
    return unavailable("PERCENT", `${basis}。比較可能な2期分を取得できません`);
  }
  if (prior.value === 0 || (denominatorMustBePositive && prior.value <= 0)) {
    return notMeaningful(
      "PERCENT",
      `${basis}。前年値が0以下のため算定対象外`,
      current
    );
  }
  return available(
    ((current.value - prior.value) / Math.abs(prior.value)) * 100,
    "PERCENT",
    basis,
    current
  );
}

function derivedRatio(
  numerator: CandidateFinancialSeriesPoint | null,
  denominator: CandidateFinancialSeriesPoint | null,
  multiplier: number,
  unit: CandidateMetricUnit,
  basis: string,
  denominatorLabel: string,
  denominatorMustBePositive = true
): CandidateFinancialMetric {
  if (!numerator || !denominator) {
    return unavailable(unit, `${basis}。必要な財務項目を取得できません`);
  }
  if (!sameCurrency(numerator, denominator)) {
    return unavailable(unit, `${basis}。通貨を一致確認できません`);
  }
  if (
    denominator.value === 0 ||
    (denominatorMustBePositive && denominator.value < 0)
  ) {
    return notMeaningful(
      unit,
      `${basis}。${denominatorLabel}が0以下のため算定対象外`,
      numerator
    );
  }
  return available(
    (numerator.value / denominator.value) * multiplier,
    unit,
    basis,
    numerator,
    CANDIDATE_FINANCIAL_SOURCE,
    unit === "CURRENCY" ? numerator.currencyCode : null
  );
}

function averageValue(
  current: CandidateFinancialSeriesPoint | null,
  prior: CandidateFinancialSeriesPoint | null
): CandidateFinancialSeriesPoint | null {
  if (!current || !prior || !sameCurrency(current, prior)) return null;
  return {
    ...current,
    value: (current.value + prior.value) / 2,
  };
}

export function normalizeCandidateFinancialMetrics(
  input: NormalizeCandidateFinancialInput
): CandidateFinancialMetrics {
  const industryClass = classifyCandidateIndustry(input.sector, input.industry);
  const marketCapPoint = latest(input.series, "trailingMarketCap");
  const pePoint = latest(input.series, "trailingPeRatio");
  const eps = latest(input.series, "annualDilutedEPS");
  const equity = latest(input.series, "annualStockholdersEquity");
  const priorEquity = previous(input.series, "annualStockholdersEquity");
  const netIncome = latest(input.series, "annualNetIncome");
  const revenue = latest(input.series, "annualTotalRevenue");
  const priorRevenue = previous(input.series, "annualTotalRevenue");
  const priorEps = previous(input.series, "annualDilutedEPS");
  const operatingIncome = latest(input.series, "annualOperatingIncome");
  const investedCapital = latest(input.series, "annualInvestedCapital");
  const priorInvestedCapital = previous(input.series, "annualInvestedCapital");
  const taxProvision = latest(input.series, "annualTaxProvision");
  const pretaxIncome = latest(input.series, "annualPretaxIncome");
  const freeCashFlowPoint = latest(input.series, "annualFreeCashFlow");
  const totalDebt = latest(input.series, "annualTotalDebt");
  const cash =
    latest(input.series, "annualCashCashEquivalentsAndShortTermInvestments") ??
    latest(input.series, "annualCashAndCashEquivalents");
  const commonDividends = latest(input.series, "annualCommonStockDividendPaid");

  const forecastDividendYieldPct = (() => {
    if (!input.dividend.available) {
      return unavailable(
        "PERCENT",
        "Yahoo配当履歴を取得できません",
        "Yahoo Finance 配当履歴"
      );
    }
    if (
      input.currentPrice === null ||
      !Number.isFinite(input.currentPrice) ||
      input.currentPrice <= 0
    ) {
      return unavailable(
        "PERCENT",
        "現在値を確認できないため利回りを算定できません",
        "Yahoo Finance 配当履歴"
      );
    }
    const annual = input.dividend.recurringAnnualDividend;
    if (annual === null || !Number.isFinite(annual) || annual < 0) {
      return unavailable(
        "PERCENT",
        "直近12か月の継続配当額を確認できません",
        "Yahoo Finance 配当履歴"
      );
    }
    return {
      status: "AVAILABLE",
      value: (annual / input.currentPrice) * 100,
      unit: "PERCENT",
      currency: input.priceCurrency,
      asOfDate: input.priceAsOfDate,
      period: "直近12か月継続配当",
      basis: input.dividend.hasSpecialDividend
        ? "直近12か月配当から特別配当を平常額へ置換し、継続を仮定"
        : "直近12か月配当実績の継続を仮定（会社予想ではありません）",
      source: "Yahoo Finance 配当履歴",
    } satisfies CandidateFinancialMetric;
  })();

  const trailingPe = pePoint
    ? pePoint.value > 0
      ? available(pePoint.value, "RATIO", "実績TTM PER（直接取得）", pePoint)
      : notMeaningful("RATIO", "利益分母が0以下のため算定対象外", pePoint)
    : eps && eps.value <= 0
      ? notMeaningful("RATIO", "最新年次希薄化EPSが0以下のため算定対象外", eps)
      : unavailable("RATIO", "実績TTM PERを取得できません");

  const marketCap = marketCapPoint
    ? available(
        marketCapPoint.value,
        "CURRENCY",
        "市場時価総額（直接取得）",
        marketCapPoint
      )
    : unavailable("CURRENCY", "市場時価総額を取得できません");

  const priceToBook = derivedRatio(
    marketCapPoint,
    equity,
    1,
    "RATIO",
    "市場時価総額 ÷ 最新年次株主資本",
    "株主資本"
  );

  const roePct = derivedRatio(
    netIncome,
    averageValue(equity, priorEquity),
    100,
    "PERCENT",
    "最新年次純利益 ÷ 期首期末平均株主資本",
    "平均株主資本"
  );

  const operatingMarginPct =
    industryClass === "ORDINARY"
      ? derivedRatio(
          operatingIncome,
          revenue,
          100,
          "PERCENT",
          "最新年次営業利益 ÷ 売上高",
          "売上高"
        )
      : notMeaningful(
          "PERCENT",
          `${industryClass === "FINANCIAL" ? "金融" : "REIT"}は通常企業の営業利益率比較を適用しません`,
          operatingIncome
        );

  const roicPct = (() => {
    if (industryClass !== "ORDINARY") {
      return notMeaningful(
        "PERCENT",
        `${industryClass === "FINANCIAL" ? "金融" : "REIT"}は通常企業のROICを適用しません`,
        operatingIncome
      );
    }
    const averageCapital = averageValue(investedCapital, priorInvestedCapital);
    if (!operatingIncome || !averageCapital || !sameCurrency(operatingIncome, averageCapital)) {
      return unavailable("PERCENT", "ROIC算定に必要な営業利益・2期投下資本を取得できません");
    }
    if (averageCapital.value <= 0) {
      return notMeaningful("PERCENT", "平均投下資本が0以下のため算定対象外", averageCapital);
    }
    let taxRate = 0;
    if (taxProvision && pretaxIncome && pretaxIncome.value > 0) {
      taxRate = Math.min(0.5, Math.max(0, taxProvision.value / pretaxIncome.value));
    }
    return available(
      ((operatingIncome.value * (1 - taxRate)) / averageCapital.value) * 100,
      "PERCENT",
      `税引後営業利益 ÷ 期首期末平均投下資本（実効税率${(taxRate * 100).toFixed(1)}%）`,
      operatingIncome
    );
  })();

  const freeCashFlow =
    industryClass === "ORDINARY"
      ? freeCashFlowPoint
        ? available(
            freeCashFlowPoint.value,
            "CURRENCY",
            "最新年次Free Cash Flow（直接取得）",
            freeCashFlowPoint
          )
        : unavailable("CURRENCY", "最新年次Free Cash Flowを取得できません")
      : notMeaningful(
          "CURRENCY",
          `${industryClass === "FINANCIAL" ? "金融" : "REIT"}は通常企業のFCF比較を適用しません`,
          freeCashFlowPoint
        );

  const fcfYieldPct =
    industryClass === "ORDINARY"
      ? derivedRatio(
          freeCashFlowPoint,
          marketCapPoint,
          100,
          "PERCENT",
          "最新年次FCF ÷ 市場時価総額",
          "時価総額"
        )
      : notMeaningful(
          "PERCENT",
          `${industryClass === "FINANCIAL" ? "金融" : "REIT"}は通常企業のFCF利回りを適用しません`,
          freeCashFlowPoint
        );

  const netCash = (() => {
    if (industryClass === "FINANCIAL") {
      return notMeaningful(
        "CURRENCY",
        "金融は預金・貸出構造が異なるため通常企業のNet cash/debtを適用しません",
        cash
      );
    }
    if (!cash || !totalDebt) {
      return unavailable("CURRENCY", "現金同等物または有利子負債を取得できません");
    }
    if (!sameCurrency(cash, totalDebt)) {
      return unavailable("CURRENCY", "現金と有利子負債の通貨を一致確認できません");
    }
    return available(
      cash.value - totalDebt.value,
      "CURRENCY",
      "現金同等物・短期投資 − 有利子負債（負値はNet debt）",
      cash
    );
  })();

  const payoutRatioPct = (() => {
    if (!commonDividends || !netIncome) {
      return unavailable("PERCENT", "配当支払額または純利益を取得できません");
    }
    if (!sameCurrency(commonDividends, netIncome)) {
      return unavailable("PERCENT", "配当支払額と純利益の通貨を一致確認できません");
    }
    if (netIncome.value <= 0) {
      return notMeaningful("PERCENT", "純利益が0以下のため配当性向は算定対象外", netIncome);
    }
    return available(
      (Math.abs(commonDividends.value) / netIncome.value) * 100,
      "PERCENT",
      "最新年次普通株配当支払額 ÷ 純利益",
      netIncome
    );
  })();

  const metrics: CandidateFinancialMetrics["metrics"] = {
    forecastDividendYieldPct,
    trailingPe,
    priceToBook,
    marketCap,
    roePct,
    roicPct,
    operatingMarginPct,
    freeCashFlow,
    fcfYieldPct,
    netCash,
    revenueGrowthPct: yearOverYearMetric(
      revenue,
      priorRevenue,
      "最新年次売上高の前年比"
    ),
    epsGrowthPct: yearOverYearMetric(
      eps,
      priorEps,
      "最新年次希薄化EPSの前年比",
      true
    ),
    payoutRatioPct,
    dividendGrowthPct: unavailable(
      "PERCENT",
      "比較可能な2期分の1株配当を取得できません"
    ),
  };

  const core = [
    metrics.forecastDividendYieldPct,
    metrics.trailingPe,
    metrics.priceToBook,
    metrics.marketCap,
  ];
  const availableCore = core.filter(metric => metric.status === "AVAILABLE").length;
  const notes: string[] = [];
  if (input.dividend.hasSpecialDividend) {
    notes.push("特別配当を検出したため、予想配当利回りは継続配当へ置換しています");
  }
  if (industryClass === "FINANCIAL") {
    notes.push("金融はPBR・ROEを優先し、通常企業のFCF・Net debt比較を適用しません");
  }
  if (industryClass === "REIT") {
    notes.push("REITは配当・NAV・FFO/AFFOが中心で、P/NAV・FFO/AFFOは未取得です");
  }

  return {
    version: CANDIDATE_FINANCIAL_VERSION,
    symbol: input.symbol,
    source: CANDIDATE_FINANCIAL_SOURCE,
    fetchedAt: input.fetchedAt,
    currency: marketCapPoint?.currencyCode ?? input.priceCurrency,
    currentPrice: input.currentPrice,
    priceAsOfDate: input.priceAsOfDate,
    marketAsOfDate: marketCapPoint?.asOfDate ?? input.priceAsOfDate,
    fiscalPeriodEnd:
      equity?.asOfDate ?? netIncome?.asOfDate ?? revenue?.asOfDate ?? null,
    industryClass,
    dataQuality:
      availableCore === core.length
        ? "COMPLETE"
        : availableCore > 0
          ? "PARTIAL"
          : "UNAVAILABLE",
    notes,
    metrics,
  };
}
