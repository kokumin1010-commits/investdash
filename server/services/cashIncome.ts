import type {
  ActualIncomeMetric,
  CashIncomeOverview,
  CashIncomeStatus,
} from "../../shared/cashIncome";
export type { CashIncomeOverview } from "../../shared/cashIncome";

export type InterestIncomeSnapshotLike = {
  interestAssetId: number;
  incomeDate: string;
  currency: string;
  dailyIncome: string | number | null;
  cumulativeIncome: string | number | null;
  fxRateJpy: string | number | null;
  source: string;
  capturedAt: Date;
};

export type CashIncomeRecordLike = {
  kind: "DIVIDEND" | "INTEREST";
  status: "ACCRUED" | "SETTLED";
  occurredOn: string;
  currency: string;
  netAmount: string | number;
  fxRateJpy: string | number | null;
  source: string;
};

function finite(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jstDate(value: Date): string {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function periodStart(asOfDate: string, kind: "MONTH" | "YEAR") {
  const [year, month] = asOfDate.split("-");
  return kind === "MONTH" ? `${year}-${month}-01` : `${year}-01-01`;
}

function sumConverted<T>(
  rows: T[],
  dateOf: (row: T) => string,
  amountOf: (row: T) => string | number | null,
  fxOf: (row: T) => string | number | null,
  sourceLabel: string,
  forcePartial = true
): ActualIncomeMetric {
  let amountJpy = 0;
  let validCount = 0;
  const days = new Set<string>();
  let lastDate: string | null = null;
  for (const row of rows) {
    const amount = finite(amountOf(row));
    const fx = finite(fxOf(row));
    const date = dateOf(row);
    if (amount === null || fx === null) continue;
    amountJpy += amount * fx;
    validCount += 1;
    days.add(date);
    if (lastDate === null || date > lastDate) lastDate = date;
  }
  if (validCount === 0) {
    return {
      amountJpy: null,
      status: "UNAVAILABLE",
      recordCount: 0,
      recordedDays: 0,
      lastDate: null,
      sourceLabel,
    };
  }
  return {
    amountJpy,
    status:
      forcePartial || validCount < rows.length ? "PARTIAL" : "AVAILABLE",
    recordCount: validCount,
    recordedDays: days.size,
    lastDate,
    sourceLabel,
  };
}

function latestCumulative(
  rows: InterestIncomeSnapshotLike[]
): ActualIncomeMetric {
  const latestByAsset = new Map<number, InterestIncomeSnapshotLike>();
  for (const row of rows) {
    const previous = latestByAsset.get(row.interestAssetId);
    if (!previous || row.capturedAt > previous.capturedAt) {
      latestByAsset.set(row.interestAssetId, row);
    }
  }
  return sumConverted(
    Array.from(latestByAsset.values()),
    row => row.incomeDate,
    row => row.cumulativeIncome,
    row => row.fxRateJpy,
    "現金宝・貨幣基金の最新累計収益",
    true
  );
}

function filterDate<T>(rows: T[], dateOf: (row: T) => string, from: string, to: string) {
  return rows.filter(row => {
    const date = dateOf(row);
    return date >= from && date <= to;
  });
}

function knownIncomeTotal(
  metrics: ActualIncomeMetric[]
): { amountJpy: number | null; status: CashIncomeStatus } {
  const known = metrics.filter(metric => metric.amountJpy !== null);
  if (known.length === 0) return { amountJpy: null, status: "UNAVAILABLE" };
  return {
    amountJpy: known.reduce((total, metric) => total + (metric.amountJpy ?? 0), 0),
    status:
      known.length < metrics.length ||
      metrics.some(metric => metric.status !== "AVAILABLE")
        ? "PARTIAL"
        : "AVAILABLE",
  };
}

export function buildCashIncomeOverview(input: {
  interestSnapshots: InterestIncomeSnapshotLike[];
  cashIncomeRecords: CashIncomeRecordLike[];
  currentInterestAssetCount: number;
  annualDividendJpy: number | null;
  annualDividendStatus?: CashIncomeStatus;
  annualInterestJpy: number | null;
  annualInterestStatus?: CashIncomeStatus;
  annualBorrowingInterestJpy: number | null;
  annualBorrowingInterestStatus?: CashIncomeStatus;
  borrowingInterestMtdJpy: number | null;
  borrowingInterestMtdAsOfDate: string | null;
  now?: Date;
}): CashIncomeOverview {
  const now = input.now ?? new Date();
  const asOfDate = jstDate(now);
  const monthStart = periodStart(asOfDate, "MONTH");
  const yearStart = periodStart(asOfDate, "YEAR");
  const validInterest = input.interestSnapshots.filter(
    row => finite(row.dailyIncome) !== null
  );
  const latestInterestDate = validInterest.reduce<string | null>(
    (latest, row) => (!latest || row.incomeDate > latest ? row.incomeDate : latest),
    null
  );
  const latestInterestRows = latestInterestDate
    ? validInterest.filter(row => row.incomeDate === latestInterestDate)
    : [];
  const monthInterestRows = filterDate(
    validInterest,
    row => row.incomeDate,
    monthStart,
    asOfDate
  );
  const yearInterestRows = filterDate(
    validInterest,
    row => row.incomeDate,
    yearStart,
    asOfDate
  );

  const settledDividends = input.cashIncomeRecords.filter(
    row => row.kind === "DIVIDEND" && row.status === "SETTLED"
  );
  const monthDividends = filterDate(
    settledDividends,
    row => row.occurredOn,
    monthStart,
    asOfDate
  );
  const yearDividends = filterDate(
    settledDividends,
    row => row.occurredOn,
    yearStart,
    asOfDate
  );

  const latestDailyInterest = sumConverted(
    latestInterestRows,
    row => row.incomeDate,
    row => row.dailyIncome,
    row => row.fxRateJpy,
    "現金宝・貨幣基金の日次利息付与",
    latestInterestRows.length !== input.currentInterestAssetCount
  );
  const interestMtd = sumConverted(
    monthInterestRows,
    row => row.incomeDate,
    row => row.dailyIncome,
    row => row.fxRateJpy,
    "現金宝・貨幣基金の月次記録分",
    true
  );
  const interestYtd = sumConverted(
    yearInterestRows,
    row => row.incomeDate,
    row => row.dailyIncome,
    row => row.fxRateJpy,
    "現金宝・貨幣基金の年次記録分",
    true
  );
  const dividendMtd = sumConverted(
    monthDividends,
    row => row.occurredOn,
    row => row.netAmount,
    row => row.fxRateJpy,
    "証券口座の実際入金記録",
    true
  );
  const dividendYtd = sumConverted(
    yearDividends,
    row => row.occurredOn,
    row => row.netAmount,
    row => row.fxRateJpy,
    "証券口座の実際入金記録",
    true
  );
  const borrowingRecordIsCurrentMonth =
    input.borrowingInterestMtdAsOfDate?.slice(0, 7) === asOfDate.slice(0, 7);
  const borrowingInterestMtd: ActualIncomeMetric =
    input.borrowingInterestMtdJpy === null
      ? {
          amountJpy: null,
          status: "UNAVAILABLE",
          recordCount: 0,
          recordedDays: 0,
          lastDate: null,
          sourceLabel: "証券口座の月初来支払利息",
        }
      : {
          amountJpy: Math.abs(input.borrowingInterestMtdJpy),
          status: borrowingRecordIsCurrentMonth ? "AVAILABLE" : "PARTIAL",
          recordCount: 1,
          recordedDays: 0,
          lastDate: input.borrowingInterestMtdAsOfDate,
          sourceLabel: "証券口座の月初来支払利息",
        };
  const netCashMtdJpy =
    interestMtd.amountJpy !== null &&
    dividendMtd.amountJpy !== null &&
    borrowingInterestMtd.amountJpy !== null &&
    borrowingRecordIsCurrentMonth
      ? interestMtd.amountJpy +
        dividendMtd.amountJpy -
        borrowingInterestMtd.amountJpy
      : null;
  const annualNetCashJpy =
    input.annualDividendJpy !== null &&
    input.annualInterestJpy !== null &&
    input.annualBorrowingInterestJpy !== null &&
    (input.annualDividendStatus ?? "AVAILABLE") === "AVAILABLE" &&
    (input.annualInterestStatus ?? "AVAILABLE") === "AVAILABLE" &&
    (input.annualBorrowingInterestStatus ?? "AVAILABLE") === "AVAILABLE"
      ? input.annualDividendJpy +
        input.annualInterestJpy -
        input.annualBorrowingInterestJpy
      : null;
  const recordedGrossIncomeMtd = knownIncomeTotal([interestMtd, dividendMtd]);
  const recordedGrossIncomeYtd = knownIncomeTotal([interestYtd, dividendYtd]);

  return {
    actual: {
      asOfDate,
      latestDailyInterest,
      interestMtd,
      interestYtd,
      lifetimeInterest: latestCumulative(input.interestSnapshots),
      dividendMtd,
      dividendYtd,
      recordedGrossIncomeMtdJpy: recordedGrossIncomeMtd.amountJpy,
      recordedGrossIncomeMtdStatus: recordedGrossIncomeMtd.status,
      recordedGrossIncomeYtdJpy: recordedGrossIncomeYtd.amountJpy,
      recordedGrossIncomeYtdStatus: recordedGrossIncomeYtd.status,
      borrowingInterestMtd,
      netCashMtdJpy,
      netCashMtdStatus:
        netCashMtdJpy === null
          ? "UNAVAILABLE"
          : [interestMtd, dividendMtd].some(metric => metric.status === "PARTIAL")
            ? "PARTIAL"
            : "AVAILABLE",
      note:
        "実績は記録済みの利息付与・入金だけを集計し、記録のない日や未連携の配当を推測で補いません。",
    },
    forecast: {
      asOfDate,
      annualDividendJpy: finite(input.annualDividendJpy),
      annualDividendStatus:
        input.annualDividendStatus ??
        (finite(input.annualDividendJpy) === null ? "UNAVAILABLE" : "AVAILABLE"),
      annualInterestJpy: finite(input.annualInterestJpy),
      annualInterestStatus:
        input.annualInterestStatus ??
        (finite(input.annualInterestJpy) === null ? "UNAVAILABLE" : "AVAILABLE"),
      annualBorrowingInterestJpy: finite(input.annualBorrowingInterestJpy),
      annualBorrowingInterestStatus:
        input.annualBorrowingInterestStatus ??
        (finite(input.annualBorrowingInterestJpy) === null
          ? "UNAVAILABLE"
          : "AVAILABLE"),
      annualNetCashJpy,
      annualNetCashStatus:
        annualNetCashJpy !== null
          ? "AVAILABLE"
          : [
                input.annualDividendStatus,
                input.annualInterestStatus,
                input.annualBorrowingInterestStatus,
              ].includes("PARTIAL")
            ? "PARTIAL"
            : "UNAVAILABLE",
      dividendBasis: "現在保有株数 × 直近12か月の1株配当実績（税引前）",
      interestBasis: "現在の現金宝・貨幣基金残高 × 記録年率の日次複利試算",
      borrowingBasis: "現在の借入残高 × 通貨別金利の年換算試算",
    },
  };
}
