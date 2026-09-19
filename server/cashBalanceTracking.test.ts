import { describe, expect, it } from "vitest";
import { buildCashBalanceTracking } from "./services/cashBalanceTracking";

const fxRates = { USD: 150, SGD: 110, HKD: 19 };

describe("buildCashBalanceTracking", () => {
  it("口座別基準がない間は旧全体現金を特定口座へ推測配分しない", () => {
    const result = buildCashBalanceTracking({
      snapshots: [],
      cashIncomeRecords: [],
      legacyCashJpy: 1_255_302,
      knownBrokers: ["futu_hk", "ibkr"],
      fxRates,
      asOfDate: "2026-09-17",
    });

    expect(result.status).toBe("LEGACY_TOTAL_ONLY");
    expect(result.legacyTotalJpy).toBe(1_255_302);
    expect(result.confirmedAccountTotalJpy).toBeNull();
    expect(result.accounts).toEqual([]);
    expect(result.missingBrokers).toEqual(["futu_hk", "ibkr"]);
  });

  it("最新スクショ確定残高に同口座・同通貨の入金済み配当だけを暫定加算する", () => {
    const result = buildCashBalanceTracking({
      snapshots: [
        {
          broker: "ibkr",
          currency: "USD",
          asOfDate: "2026-09-01",
          cashBalance: "1000",
          capturedAt: new Date("2026-09-01T03:00:00Z"),
        },
      ],
      cashIncomeRecords: [
        {
          broker: "ibkr",
          kind: "DIVIDEND",
          status: "SETTLED",
          occurredOn: "2026-09-10",
          currency: "USD",
          netAmount: "84",
        },
        {
          broker: "ibkr",
          kind: "DIVIDEND",
          status: "ACCRUED",
          occurredOn: "2026-09-11",
          currency: "USD",
          netAmount: "200",
        },
        {
          broker: "futu_hk",
          kind: "DIVIDEND",
          status: "SETTLED",
          occurredOn: "2026-09-12",
          currency: "USD",
          netAmount: "300",
        },
        {
          broker: "ibkr",
          kind: "INTEREST",
          status: "SETTLED",
          occurredOn: "2026-09-13",
          currency: "USD",
          netAmount: "8",
        },
      ],
      legacyCashJpy: 1_255_302,
      knownBrokers: ["ibkr", "futu_hk"],
      fxRates,
      asOfDate: "2026-09-17",
    });

    expect(result.status).toBe("SCREENSHOT_PROVISIONAL");
    expect(result.confirmedAccountTotalJpy).toBe(150_000);
    expect(result.confirmedPositiveCashJpy).toBe(150_000);
    expect(result.confirmedNegativeCashJpy).toBe(0);
    expect(result.settledDividendAfterAnchorJpy).toBe(12_600);
    expect(result.provisionalAccountTotalJpy).toBe(162_600);
    expect(result.accounts[0]).toMatchObject({
      confirmedBalance: 1000,
      settledDividendAfterAnchor: 84,
      provisionalBalance: 1084,
      reconciliationStatus: "BASELINE_ONLY",
    });
    expect(result.missingBrokers).toEqual(["futu_hk"]);
  });

  it("プラス現金とIBKR負現金を分離し、相殺後純現金だけをネット表示に使う", () => {
    const result = buildCashBalanceTracking({
      snapshots: [
        {
          broker: "ibkr",
          currency: "SGD",
          asOfDate: "2026-09-19",
          cashBalance: "-1845956.61",
          capturedAt: new Date("2026-09-19T00:00:00Z"),
        },
        {
          broker: "sc_sg",
          currency: "SGD",
          asOfDate: "2026-09-17",
          cashBalance: "40455.01",
          capturedAt: new Date("2026-09-19T00:00:00Z"),
        },
        {
          broker: "rakuten_ispeed",
          currency: "JPY",
          asOfDate: "2026-09-19",
          cashBalance: "1978477",
          capturedAt: new Date("2026-09-19T00:00:00Z"),
        },
        {
          broker: "moomoo_jp",
          currency: "JPY",
          asOfDate: "2026-09-18",
          cashBalance: "1414434",
          capturedAt: new Date("2026-09-19T00:00:00Z"),
        },
      ],
      cashIncomeRecords: [],
      legacyCashJpy: null,
      knownBrokers: ["ibkr", "sc_sg", "rakuten_ispeed", "moomoo_jp"],
      fxRates: { ...fxRates, SGD: 122.936 },
      asOfDate: "2026-09-19",
    });

    expect(result.confirmedPositiveCashJpy).toBe(8_366_288.11);
    expect(result.confirmedNegativeCashJpy).toBe(-226_934_521.81);
    expect(result.confirmedAccountTotalJpy).toBe(-218_568_233.7);
    expect(result.provisionalAccountTotalJpy).toBe(-218_568_233.7);
  });

  it("次回スクショでは前回残高と期間中の確定配当との差を未識別差額として残す", () => {
    const result = buildCashBalanceTracking({
      snapshots: [
        {
          broker: "futu_hk",
          currency: "HKD",
          asOfDate: "2026-08-31",
          cashBalance: "10000",
          capturedAt: new Date("2026-08-31T03:00:00Z"),
        },
        {
          broker: "futu_hk",
          currency: "HKD",
          asOfDate: "2026-09-30",
          cashBalance: "10600",
          capturedAt: new Date("2026-09-30T03:00:00Z"),
        },
      ],
      cashIncomeRecords: [
        {
          broker: "futu_hk",
          kind: "DIVIDEND",
          status: "SETTLED",
          occurredOn: "2026-09-15",
          currency: "HKD",
          netAmount: "400",
        },
      ],
      legacyCashJpy: null,
      knownBrokers: ["futu_hk"],
      fxRates,
      asOfDate: "2026-09-30",
    });

    expect(result.accounts[0]).toMatchObject({
      previousBalance: 10000,
      settledDividendBetweenScreenshots: 400,
      unidentifiedDifference: 200,
      reconciliationStatus: "READY",
      provisionalBalance: 10600,
    });
  });

  it("未対応通貨は円換算を作らず原通貨残高だけを保持する", () => {
    const result = buildCashBalanceTracking({
      snapshots: [
        {
          broker: "other",
          currency: "EUR",
          asOfDate: "2026-09-17",
          cashBalance: "500",
          capturedAt: new Date("2026-09-17T03:00:00Z"),
        },
      ],
      cashIncomeRecords: [],
      legacyCashJpy: null,
      knownBrokers: ["other"],
      fxRates,
      asOfDate: "2026-09-17",
    });

    expect(result.accounts[0].confirmedBalance).toBe(500);
    expect(result.accounts[0].confirmedBalanceJpy).toBeNull();
    expect(result.confirmedAccountTotalJpy).toBeNull();
    expect(result.provisionalAccountTotalJpy).toBeNull();
  });
});
