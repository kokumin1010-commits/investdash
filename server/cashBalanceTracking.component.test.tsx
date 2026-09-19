/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CashBalanceTrackingSection } from "../client/src/components/investing/CashBalanceTrackingSection";
import type { CashBalanceTracking } from "../shared/cashBalanceTracking";

afterEach(cleanup);

const tracking: CashBalanceTracking = {
  status: "SCREENSHOT_PROVISIONAL",
  asOfDate: "2026-09-17",
  confirmedAccountCount: 1,
  confirmedAccountTotalJpy: 1_590_000,
  confirmedPositiveCashJpy: 1_590_000,
  confirmedNegativeCashJpy: 0,
  settledDividendAfterAnchorJpy: 12_600,
  provisionalAccountTotalJpy: 1_602_600,
  provisionalPositiveCashJpy: 1_602_600,
  provisionalNegativeCashJpy: 0,
  legacyTotalJpy: 1_255_302,
  missingBrokers: ["futu_hk"],
  accounts: [
    {
      broker: "ibkr",
      currency: "USD",
      confirmedBalance: 10_600,
      confirmedBalanceJpy: 1_590_000,
      confirmedAsOfDate: "2026-09-13",
      settledDividendAfterAnchor: 84,
      settledDividendAfterAnchorJpy: 12_600,
      provisionalBalance: 10_684,
      provisionalBalanceJpy: 1_602_600,
      reconciliationStatus: "READY",
      previousBalance: 10_000,
      previousAsOfDate: "2026-08-31",
      settledDividendBetweenScreenshots: 400,
      unidentifiedDifference: 200,
    },
  ],
  note: "予想配当は暫定残高へ加えません。",
};

describe("CashBalanceTrackingSection", () => {
  for (const width of [390, 1280]) {
    it(`${width}pxで確定・暫定・確認待ちを混ぜずに表示する`, () => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      render(
        <CashBalanceTrackingSection
          data={tracking}
          annualDividendJpy={22_096_246}
        />
      );

      expect(screen.getByText("現金残高：スクショ確定＋暫定更新")).toBeTruthy();
      expect(screen.getByText("プラス現金（確定）")).toBeTruthy();
      expect(screen.getByText("借入・負現金（確定）")).toBeTruthy();
      expect(screen.getByText("¥1,590,000")).toBeTruthy();
      expect(screen.getByText("¥0")).toBeTruthy();
      expect(screen.getByText("¥12,600")).toBeTruthy();
      expect(screen.getByText("¥1,602,600")).toBeTruthy();
      expect(screen.getByText("¥22,096,246")).toBeTruthy();
      expect(screen.getByText("USD 200")).toBeTruthy();
      expect(screen.getByText(/暫定残高へ加えません/)).toBeTruthy();
      expect(screen.getByText("富途證券 香港")).toBeTruthy();
    });
  }

  it("旧全体現金は口座別基準へ推測配分せず別状態で示す", () => {
    render(
      <CashBalanceTrackingSection
        data={{
          ...tracking,
          status: "LEGACY_TOTAL_ONLY",
          confirmedAccountCount: 0,
          confirmedAccountTotalJpy: null,
          confirmedPositiveCashJpy: null,
          confirmedNegativeCashJpy: null,
          settledDividendAfterAnchorJpy: null,
          provisionalAccountTotalJpy: null,
          provisionalPositiveCashJpy: null,
          provisionalNegativeCashJpy: null,
          accounts: [],
        }}
        annualDividendJpy={22_096_246}
      />
    );

    expect(screen.getByText("旧全体値・口座未分類")).toBeTruthy();
    expect(screen.getByText("¥1,255,302")).toBeTruthy();
    expect(screen.getAllByText("未取得").length).toBeGreaterThan(0);
  });
});
