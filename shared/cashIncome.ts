export type CashIncomeStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export type ActualIncomeMetric = {
  amountJpy: number | null;
  status: CashIncomeStatus;
  recordCount: number;
  recordedDays: number;
  lastDate: string | null;
  sourceLabel: string;
};

export type ForecastRunRateMetric = {
  annualJpy: number | null;
  monthlyJpy: number | null;
  dailyJpy: number | null;
  status: CashIncomeStatus;
  previousAnnualJpy: number | null;
  annualDayChangeJpy: number | null;
  previousAsOfDate: string | null;
};

export type CashIncomeOverview = {
  actual: {
    asOfDate: string;
    latestDailyInterest: ActualIncomeMetric;
    interestMtd: ActualIncomeMetric;
    interestYtd: ActualIncomeMetric;
    lifetimeInterest: ActualIncomeMetric;
    dividendMtd: ActualIncomeMetric;
    dividendYtd: ActualIncomeMetric;
    recordedGrossIncomeMtdJpy: number | null;
    recordedGrossIncomeMtdStatus: CashIncomeStatus;
    recordedGrossIncomeYtdJpy: number | null;
    recordedGrossIncomeYtdStatus: CashIncomeStatus;
    borrowingInterestMtd: ActualIncomeMetric;
    netCashMtdJpy: number | null;
    netCashMtdStatus: CashIncomeStatus;
    note: string;
  };
  forecast: {
    asOfDate: string;
    annualDividendJpy: number | null;
    annualDividendStatus: CashIncomeStatus;
    annualInterestJpy: number | null;
    annualInterestStatus: CashIncomeStatus;
    annualBorrowingInterestJpy: number | null;
    annualBorrowingInterestStatus: CashIncomeStatus;
    annualNetCashJpy: number | null;
    annualNetCashStatus: CashIncomeStatus;
    netAssets: {
      currentJpy: number;
      previousJpy: number | null;
      dayChangeJpy: number | null;
      dayChangePct: number | null;
      previousAsOfDate: string | null;
      sevenDayChangeJpy: number | null;
      sevenDayChangePct: number | null;
      sevenDayAsOfDate: string | null;
      thirtyDayChangeJpy: number | null;
      thirtyDayChangePct: number | null;
      thirtyDayAsOfDate: string | null;
    } | null;
    dividendRunRate: ForecastRunRateMetric;
    interestRunRate: ForecastRunRateMetric;
    borrowingRunRate: ForecastRunRateMetric;
    netCashRunRate: ForecastRunRateMetric;
    dividendBasis: string;
    interestBasis: string;
    borrowingBasis: string;
  };
};
