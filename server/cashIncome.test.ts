import { describe, expect, it } from "vitest";
import { buildCashIncomeOverview } from "./services/cashIncome";

const now = new Date("2026-09-13T03:00:00.000Z");

function interest(overrides: Partial<{
  interestAssetId: number;
  incomeDate: string;
  currency: string;
  dailyIncome: string;
  cumulativeIncome: string;
  fxRateJpy: string;
  source: string;
  capturedAt: Date;
}> = {}) {
  return {
    interestAssetId: 1,
    incomeDate: "2026-09-12",
    currency: "USD",
    dailyIncome: "10",
    cumulativeIncome: "100",
    fxRateJpy: "150",
    source: "MANUAL_CAPTURE",
    capturedAt: new Date("2026-09-13T01:00:00.000Z"),
    ...overrides,
  };
}

function dividend(overrides: Partial<{
  kind: "DIVIDEND" | "INTEREST";
  status: "ACCRUED" | "SETTLED";
  occurredOn: string;
  currency: string;
  netAmount: string;
  fxRateJpy: string;
  source: string;
}> = {}) {
  return {
    kind: "DIVIDEND" as const,
    status: "SETTLED" as const,
    occurredOn: "2026-09-10",
    currency: "USD",
    netAmount: "200",
    fxRateJpy: "150",
    source: "MANUAL",
    ...overrides,
  };
}

describe("buildCashIncomeOverview", () => {
  it("实际日息和已到账股息按记录FX汇总，不与未来预测混合", () => {
    const result = buildCashIncomeOverview({
      interestSnapshots: [
        interest(),
        interest({
          interestAssetId: 2,
          currency: "HKD",
          dailyIncome: "5",
          cumulativeIncome: "50",
          fxRateJpy: "20",
        }),
      ],
      cashIncomeRecords: [dividend()],
      currentInterestAssetCount: 2,
      annualDividendJpy: 2_000_000,
      annualInterestJpy: 3_000_000,
      annualBorrowingInterestJpy: 1_000_000,
      borrowingInterestMtdJpy: 50_000,
      borrowingInterestMtdAsOfDate: "2026-09-13",
      now,
    });

    expect(result.actual.latestDailyInterest.amountJpy).toBe(1_600);
    expect(result.actual.latestDailyInterest.status).toBe("AVAILABLE");
    expect(result.actual.interestMtd.amountJpy).toBe(1_600);
    expect(result.actual.dividendMtd.amountJpy).toBe(30_000);
    expect(result.actual.recordedGrossIncomeMtdJpy).toBe(31_600);
    expect(result.actual.netCashMtdJpy).toBe(-18_400);
    expect(result.forecast.annualNetCashJpy).toBe(4_000_000);
  });

  it("累计收益只取各商品最新快照，不把多个日期的累计值重复相加", () => {
    const result = buildCashIncomeOverview({
      interestSnapshots: [
        interest({
          incomeDate: "2026-08-31",
          cumulativeIncome: "90",
          capturedAt: new Date("2026-09-01T01:00:00.000Z"),
        }),
        interest({ cumulativeIncome: "100" }),
      ],
      cashIncomeRecords: [],
      currentInterestAssetCount: 1,
      annualDividendJpy: 0,
      annualInterestJpy: 1_000,
      annualBorrowingInterestJpy: 0,
      borrowingInterestMtdJpy: 0,
      borrowingInterestMtdAsOfDate: "2026-09-13",
      now,
    });

    expect(result.actual.lifetimeInterest.amountJpy).toBe(15_000);
    expect(result.actual.interestYtd.recordCount).toBe(2);
    expect(result.actual.interestYtd.recordedDays).toBe(2);
  });

  it("已确认的截图累计差额优先于单日日息，不重复加算同一收益", () => {
    const result = buildCashIncomeOverview({
      interestSnapshots: [interest({ dailyIncome: "10", fxRateJpy: "150" })],
      cashIncomeRecords: [
        dividend({
          kind: "INTEREST",
          occurredOn: "2026-09-13",
          netAmount: "202.38",
          fxRateJpy: "150",
          source: "SCREENSHOT_CUMULATIVE_DELTA",
        }),
      ],
      currentInterestAssetCount: 1,
      annualDividendJpy: null,
      annualInterestJpy: 1_000,
      annualBorrowingInterestJpy: 0,
      borrowingInterestMtdJpy: null,
      borrowingInterestMtdAsOfDate: null,
      now,
    });

    expect(result.actual.latestDailyInterest.amountJpy).toBe(1_500);
    expect(result.actual.interestMtd.amountJpy).toBe(30_357);
    expect(result.actual.interestMtd.sourceLabel).toBe(
      "月次スクショの累計収益差額"
    );
    expect(result.actual.recordedGrossIncomeMtdJpy).toBe(30_357);
  });

  it("无股息现金流水时返回未取得，不用持仓预测冒充已到账", () => {
    const result = buildCashIncomeOverview({
      interestSnapshots: [],
      cashIncomeRecords: [],
      currentInterestAssetCount: 0,
      annualDividendJpy: 22_000_000,
      annualInterestJpy: 3_000_000,
      annualBorrowingInterestJpy: 4_000_000,
      borrowingInterestMtdJpy: null,
      borrowingInterestMtdAsOfDate: null,
      now,
    });

    expect(result.actual.dividendYtd.amountJpy).toBeNull();
    expect(result.actual.dividendYtd.status).toBe("UNAVAILABLE");
    expect(result.actual.recordedGrossIncomeYtdJpy).toBeNull();
    expect(result.forecast.annualDividendJpy).toBe(22_000_000);
    expect(result.forecast.annualNetCashJpy).toBe(21_000_000);
  });

  it("旧月的月初来借入利息保留日期但不进入当前月净额", () => {
    const result = buildCashIncomeOverview({
      interestSnapshots: [interest()],
      cashIncomeRecords: [dividend()],
      currentInterestAssetCount: 1,
      annualDividendJpy: 1,
      annualInterestJpy: 1,
      annualBorrowingInterestJpy: 1,
      borrowingInterestMtdJpy: 50_000,
      borrowingInterestMtdAsOfDate: "2026-08-25",
      now,
    });

    expect(result.actual.borrowingInterestMtd.status).toBe("PARTIAL");
    expect(result.actual.borrowingInterestMtd.lastDate).toBe("2026-08-25");
    expect(result.actual.netCashMtdJpy).toBeNull();
    expect(result.actual.netCashMtdStatus).toBe("UNAVAILABLE");
  });

  it("缺少FX的记录不按1日元换算，并明确为部分覆盖", () => {
    const result = buildCashIncomeOverview({
      interestSnapshots: [interest({ fxRateJpy: "150" }), interest({ interestAssetId: 2, fxRateJpy: "" })],
      cashIncomeRecords: [],
      currentInterestAssetCount: 2,
      annualDividendJpy: null,
      annualInterestJpy: null,
      annualBorrowingInterestJpy: null,
      borrowingInterestMtdJpy: null,
      borrowingInterestMtdAsOfDate: null,
      now,
    });

    expect(result.actual.latestDailyInterest.amountJpy).toBe(1_500);
    expect(result.actual.latestDailyInterest.status).toBe("PARTIAL");
    expect(result.actual.recordedGrossIncomeYtdJpy).toBe(1_500);
    expect(result.actual.recordedGrossIncomeYtdStatus).toBe("PARTIAL");
    expect(result.forecast.annualNetCashJpy).toBeNull();
  });
});
