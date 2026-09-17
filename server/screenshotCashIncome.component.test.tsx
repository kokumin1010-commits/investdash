/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenshotCashIncomeReview } from "../client/src/components/investing/ScreenshotCashIncomeReview";
import type {
  ScreenshotAccountCashDraft,
  ScreenshotDividendDraft,
  ScreenshotInterestDraft,
} from "../shared/screenshotCashIncome";

afterEach(cleanup);

const interest: ScreenshotInterestDraft = {
  draftKey: "interest-1234567890123456",
  mode: "APPLY",
  broker: "futu_hk",
  name: "易方達(香港)美元貨幣市場基金",
  currency: "USD",
  amount: 145_500,
  annualRatePct: 3.4,
  dailyIncome: 8.7,
  cumulativeIncome: 900,
  asOfDate: "2026-09-13",
  dateSource: "SCREEN",
  confidence: 98,
  evidence: "累計収益 USD 900",
  existingInterestAssetId: 7,
  previousCumulativeIncome: 697.62,
  previousAsOfDate: "2026-08-24",
  periodIncome: 202.38,
  deltaStatus: "READY",
  issues: [],
};

const dividend: ScreenshotDividendDraft = {
  draftKey: "dividend-1234567890123456",
  mode: "APPLY",
  broker: "ibkr",
  symbol: "TXN",
  name: "Texas Instruments Dividend",
  currency: "USD",
  grossAmount: null,
  taxAmount: null,
  feeAmount: null,
  netAmount: 84,
  occurredOn: "2026-09-10",
  confidence: 96,
  evidence: "Dividend USD 84 Settled",
  issues: ["税前額は画面にないため未取得のまま保存します"],
};

const accountCash: ScreenshotAccountCashDraft = {
  draftKey: "account-cash-1234567890123456",
  mode: "APPLY",
  broker: "ibkr",
  currency: "USD",
  cashBalance: 10_600,
  asOfDate: "2026-09-30",
  dateSource: "SCREEN",
  confidence: 97,
  evidence: "Cash USD 10,600",
  previousBalance: 10_000,
  previousAsOfDate: "2026-08-31",
  settledDividendBetween: 400,
  expectedBalance: 10_400,
  unidentifiedDifference: 200,
  reconciliationStatus: "READY",
  issues: [],
};

describe("ScreenshotCashIncomeReview", () => {
  for (const width of [390, 1280]) {
    it(`${width}pxで実績差額とネット入金を明確に表示する`, () => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      render(
        <ScreenshotCashIncomeReview
          accountCash={null}
          interestAssets={[interest]}
          dividendIncomes={[dividend]}
          onAccountCashChange={vi.fn()}
          onInterestChange={vi.fn()}
          onDividendChange={vi.fn()}
        />
      );

      expect(screen.getByText("キャッシュ収入の自動計算")).toBeTruthy();
      expect(screen.getByText("USD 202.38")).toBeTruthy();
      expect(screen.getByText("2026-08-24")).toBeTruthy();
      expect(screen.getByText("ネット入金のみ取得")).toBeTruthy();
      expect(screen.getByText("USD 84")).toBeTruthy();
      expect(screen.getAllByText(/確定基準として保存/).length).toBeGreaterThan(0);
    });
  }

  for (const width of [390, 1280]) {
    it(`${width}pxで口座現金の確定基準と未識別差額を分けて表示する`, () => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      render(
        <ScreenshotCashIncomeReview
          accountCash={accountCash}
          interestAssets={[]}
          dividendIncomes={[]}
          onAccountCashChange={vi.fn()}
          onInterestChange={vi.fn()}
          onDividendChange={vi.fn()}
        />
      );

      expect(screen.getByText("口座現金：スクショ確定基準")).toBeTruthy();
      expect(screen.getByText("USD 10,000")).toBeTruthy();
      expect(screen.getByText("USD 400")).toBeTruthy();
      expect(screen.getByText("USD 10,400")).toBeTruthy();
      expect(screen.getByText("USD 200")).toBeTruthy();
    });
  }

  it("基準日を編集すると画面確認済み日付として親へ返す", () => {
    const onInterestChange = vi.fn();
    render(
      <ScreenshotCashIncomeReview
        accountCash={null}
        interestAssets={[{ ...interest, dateSource: "UPLOAD_DATE" }]}
        dividendIncomes={[]}
        onAccountCashChange={vi.fn()}
        onInterestChange={onInterestChange}
        onDividendChange={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("スクショ基準日"), {
      target: { value: "2026-09-12" },
    });
    expect(onInterestChange).toHaveBeenCalledWith(0, {
      asOfDate: "2026-09-12",
      dateSource: "SCREEN",
    });
  });

  it("累計が前回より小さいと画面でも算定不可を示す", () => {
    render(
      <ScreenshotCashIncomeReview
        accountCash={null}
        interestAssets={[
          {
            ...interest,
            cumulativeIncome: 600,
            deltaStatus: "BLOCKED",
            mode: "SKIP",
          },
        ]}
        dividendIncomes={[]}
        onAccountCashChange={vi.fn()}
        onInterestChange={vi.fn()}
        onDividendChange={vi.fn()}
      />
    );

    expect(screen.getByText("算定不可：日付または累計値を確認")).toBeTruthy();
  });
});
