import { describe, expect, it } from "vitest";
import {
  normalizeDividendIncomeForTest,
  normalizeInterestAssetForTest,
} from "./services/ocr";
import {
  buildScreenshotCashIncomeDraft,
  calculateCumulativeIncomeDelta,
} from "./services/screenshotCashIncome";

const evidence = [
  {
    fileName: "futu.webp",
    fileKey: "imports/futu.webp",
    imageUrl: "https://example.invalid/futu.webp",
    digest: "abc",
  },
];

describe("月次スクショのキャッシュ収入草稿", () => {
  it("現金宝の通貨・日付・確信度を正規化し、存在しない日付を補わない", () => {
    const normalized = normalizeInterestAssetForTest({
      broker: "富途證券 香港",
      name: " 易方達美元貨幣市場基金 ",
      currency: "usd",
      amount: 145_500.12345,
      annualRatePct: 3.45678,
      dailyIncome: 8.66129,
      cumulativeIncome: 900.12349,
      asOfDate: "2026-02-30",
      confidence: 108,
      evidence: "累計収益 900.12349",
    });

    expect(normalized).toMatchObject({
      name: "易方達美元貨幣市場基金",
      currency: "USD",
      amount: 145_500.1235,
      annualRatePct: 3.4568,
      dailyIncome: 8.6613,
      cumulativeIncome: 900.1235,
      asOfDate: null,
      confidence: 100,
    });
  });

  it("画面がネット入金だけを示す配当は税前額を null のまま保持する", () => {
    const normalized = normalizeDividendIncomeForTest({
      broker: "IBKR",
      symbol: "TXN",
      name: "Texas Instruments Dividend",
      currency: "usd",
      grossAmount: null,
      taxAmount: null,
      feeAmount: null,
      netAmount: 123.45678,
      occurredOn: "2026-09-10",
      confidence: 96,
      evidence: "Dividend USD 123.45678 Settled",
    });

    expect(normalized.grossAmount).toBeNull();
    expect(normalized.taxAmount).toBeNull();
    expect(normalized.netAmount).toBe(123.4568);
    expect(normalized.currency).toBe("USD");
  });

  it("同一口座・同一商品・同一通貨の前回累計との差額だけを実績草稿にする", () => {
    const result = buildScreenshotCashIncomeDraft({
      batchKey: "batch-20260913-futu",
      uploadDate: "2026-09-13",
      model: "gemini-3.1-pro-preview",
      selectedFormatId: "futu_hk",
      interestAssets: [
        {
          broker: "富途證券 香港",
          name: "易方達(香港)美元貨幣市場基金",
          currency: "USD",
          amount: 145_500,
          annualRatePct: 3.4,
          dailyIncome: 8.7,
          cumulativeIncome: 900,
          asOfDate: "2026-09-13",
          confidence: 98,
          evidence: "累計収益 900",
        },
      ],
      dividendIncomes: [],
      existingAssets: [
        {
          id: 7,
          broker: "futu_hk",
          name: "易方達(香港)美元貨幣市場基金",
          currency: "USD",
          cumulativeIncome: "697.62",
          capturedAt: new Date("2026-08-25T04:41:08Z"),
        },
      ],
      snapshots: [
        {
          interestAssetId: 7,
          broker: "futu_hk",
          name: "易方達(香港)美元貨幣市場基金",
          currency: "USD",
          incomeDate: "2026-08-24",
          cumulativeIncome: "697.62",
          capturedAt: new Date("2026-08-25T04:41:08Z"),
        },
      ],
      evidence,
    });

    expect(result.interestAssets[0]).toMatchObject({
      mode: "APPLY",
      broker: "futu_hk",
      existingInterestAssetId: 7,
      previousCumulativeIncome: 697.62,
      previousAsOfDate: "2026-08-24",
      periodIncome: 202.38,
      deltaStatus: "READY",
    });
  });

  it("前回値がない商品は基準値として保存し、実績差額を作らない", () => {
    const result = buildScreenshotCashIncomeDraft({
      batchKey: "batch-new-asset",
      uploadDate: "2026-09-13",
      model: "gemini-3.1-pro-preview",
      selectedFormatId: "futu_hk",
      interestAssets: [
        {
          broker: null,
          name: "新しい貨幣基金",
          currency: "HKD",
          amount: 10_000,
          annualRatePct: 3,
          dailyIncome: 1,
          cumulativeIncome: 100,
          asOfDate: null,
          confidence: 90,
          evidence: "累計収益 100",
        },
      ],
      dividendIncomes: [],
      existingAssets: [],
      snapshots: [],
      evidence,
    });

    expect(result.interestAssets[0]).toMatchObject({
      mode: "APPLY",
      asOfDate: "2026-09-13",
      dateSource: "UPLOAD_DATE",
      periodIncome: null,
      deltaStatus: "BASELINE_ONLY",
    });
  });

  it("別口座または別通貨の累計値を比較基準にしない", () => {
    const result = buildScreenshotCashIncomeDraft({
      batchKey: "batch-isolated",
      uploadDate: "2026-09-13",
      model: "gemini-3.1-pro-preview",
      selectedFormatId: "ibkr",
      interestAssets: [
        {
          broker: "IBKR",
          name: "USD Cash Fund",
          currency: "USD",
          amount: 1_000,
          annualRatePct: 4,
          dailyIncome: 0.1,
          cumulativeIncome: 20,
          asOfDate: "2026-09-13",
          confidence: 95,
          evidence: "Cumulative USD 20",
        },
      ],
      dividendIncomes: [],
      existingAssets: [],
      snapshots: [
        {
          interestAssetId: 1,
          broker: "futu_hk",
          name: "USD Cash Fund",
          currency: "USD",
          incomeDate: "2026-08-31",
          cumulativeIncome: 10,
          capturedAt: new Date("2026-08-31T12:00:00Z"),
        },
        {
          interestAssetId: 2,
          broker: "ibkr",
          name: "USD Cash Fund",
          currency: "HKD",
          incomeDate: "2026-08-31",
          cumulativeIncome: 15,
          capturedAt: new Date("2026-08-31T12:00:00Z"),
        },
      ],
      evidence,
    });

    expect(result.interestAssets[0].deltaStatus).toBe("BASELINE_ONLY");
  });

  it("累計収益の減少と日付逆行は自動差額を停止する", () => {
    expect(
      calculateCumulativeIncomeDelta({
        currentCumulativeIncome: 90,
        currentAsOfDate: "2026-09-13",
        previousCumulativeIncome: 100,
        previousAsOfDate: "2026-08-31",
      })
    ).toEqual({ status: "BLOCKED", amount: null });
    expect(
      calculateCumulativeIncomeDelta({
        currentCumulativeIncome: 120,
        currentAsOfDate: "2026-08-31",
        previousCumulativeIncome: 100,
        previousAsOfDate: "2026-08-31",
      })
    ).toEqual({ status: "BLOCKED", amount: null });
  });

  it("税前内訳とネット入金が不一致なら配当草稿を自動適用しない", () => {
    const result = buildScreenshotCashIncomeDraft({
      batchKey: "batch-dividend",
      uploadDate: "2026-09-13",
      model: "gemini-3.1-pro-preview",
      selectedFormatId: "ibkr",
      interestAssets: [],
      dividendIncomes: [
        {
          broker: "IBKR",
          symbol: "TXN",
          name: "Texas Instruments Dividend",
          currency: "USD",
          grossAmount: 100,
          taxAmount: 10,
          feeAmount: 0,
          netAmount: 95,
          occurredOn: "2026-09-10",
          confidence: 98,
          evidence: "Gross 100 / Tax 10 / Net 95",
        },
      ],
      existingAssets: [],
      snapshots: [],
      evidence,
    });

    expect(result.dividendIncomes[0].mode).toBe("SKIP");
    expect(result.dividendIncomes[0].issues.join(" ")).toContain("一致しません");
  });
});

