import { describe, expect, it } from "vitest";
import { buildScreenshotCashIncomeDraft } from "./services/screenshotCashIncome";

describe("スクショ口座現金草稿", () => {
  it("前回残高と期間中の確認済み配当から未識別差額を算出する", () => {
    const result = buildScreenshotCashIncomeDraft({
      batchKey: "batch-account-cash",
      uploadDate: "2026-09-30",
      model: "gemini-3.1-pro-preview",
      selectedFormatId: "ibkr",
      account: {
        netAssets: 1_000_000,
        cash: 10_600,
        currency: "USD",
        broker: "IBKR",
        cashAsOfDate: "2026-09-30",
        confidence: 97,
        evidence: "Cash USD 10,600",
      },
      interestAssets: [],
      dividendIncomes: [],
      existingAssets: [],
      snapshots: [],
      cashSnapshots: [
        {
          broker: "ibkr",
          currency: "USD",
          asOfDate: "2026-08-31",
          cashBalance: "10000",
          capturedAt: new Date("2026-08-31T03:00:00Z"),
        },
      ],
      cashIncomeRecords: [
        {
          broker: "ibkr",
          kind: "DIVIDEND",
          status: "SETTLED",
          occurredOn: "2026-09-15",
          currency: "USD",
          netAmount: "400",
        },
      ],
      evidence: [],
    });

    expect(result.accountCash).toMatchObject({
      mode: "APPLY",
      broker: "ibkr",
      currency: "USD",
      cashBalance: 10_600,
      previousBalance: 10_000,
      previousAsOfDate: "2026-08-31",
      settledDividendBetween: 400,
      expectedBalance: 10_400,
      unidentifiedDifference: 200,
      reconciliationStatus: "READY",
    });
  });

  it("初回は推測差額を作らずアップロード日基準を明示する", () => {
    const result = buildScreenshotCashIncomeDraft({
      batchKey: "batch-account-baseline",
      uploadDate: "2026-09-17",
      model: "gemini-3.1-pro-preview",
      selectedFormatId: "futu_hk",
      account: {
        netAssets: null,
        cash: 50_000,
        currency: "HKD",
        broker: "Futu HK",
        cashAsOfDate: null,
        confidence: 95,
        evidence: "Cash HKD 50,000",
      },
      interestAssets: [],
      dividendIncomes: [],
      existingAssets: [],
      snapshots: [],
      cashSnapshots: [],
      cashIncomeRecords: [],
      evidence: [],
    });

    expect(result.accountCash).toMatchObject({
      mode: "APPLY",
      asOfDate: "2026-09-17",
      dateSource: "UPLOAD_DATE",
      previousBalance: null,
      unidentifiedDifference: null,
      reconciliationStatus: "BASELINE_ONLY",
    });
  });

  it("IBKRの通貨別現金を現金宝にせず、基準通貨換算総現金として説明する", () => {
    const result = buildScreenshotCashIncomeDraft({
      batchKey: "batch-ibkr-cash",
      uploadDate: "2026-09-19",
      model: "gemini-3.1-pro-preview",
      selectedFormatId: "ibkr",
      account: {
        netAssets: 2_270_316.92,
        cash: -1_845_956.61,
        currency: "SGD",
        broker: "IBKR",
        cashAsOfDate: null,
        confidence: 95,
        evidence: "合計(SGD) 現金 -1,845,956.61",
      },
      interestAssets: [
        {
          broker: "IBKR",
          name: "SGD 現金",
          currency: "SGD",
          amount: 9_760,
          annualRatePct: null,
          dailyIncome: null,
          cumulativeIncome: null,
          asOfDate: null,
          confidence: 95,
          evidence: "SGD 現金 9.76K",
        },
      ],
      dividendIncomes: [],
      existingAssets: [],
      snapshots: [],
      cashSnapshots: [],
      cashIncomeRecords: [],
      evidence: [],
    });

    expect(result.interestAssets).toEqual([]);
    expect(result.accountCash?.cashBalance).toBe(-1_845_956.61);
    expect(result.accountCash?.issues.join(" ")).toContain("基準通貨換算");
    expect(result.accountCash?.issues.join(" ")).toContain("為替変動");
  });
});
