export type CashIncomeStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export type ActualIncomeMetric = {
  amountJpy: number | null;
  status: CashIncomeStatus;
  recordCount: number;
  recordedDays: number;
  lastDate: string | null;
  sourceLabel: string;
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
    dividendBasis: string;
    interestBasis: string;
    borrowingBasis: string;
  };
};
