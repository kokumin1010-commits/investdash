// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateMetricsAndSizing } from "../client/src/components/investing/CandidateMetricsAndSizing";
import type {
  CandidateCardInsight,
  CandidateFinancialMetric,
} from "../shared/candidateFinancialMetrics";

function metric(
  value: number | null,
  unit: CandidateFinancialMetric["unit"],
  status: CandidateFinancialMetric["status"] = "AVAILABLE",
  currency: string | null = null
): CandidateFinancialMetric {
  return {
    status,
    value,
    unit,
    currency,
    asOfDate: "2026-09-11",
    period: "TTM",
    basis: "テスト算定根拠",
    source: "Yahoo Finance fundamentals-timeseries",
  };
}

function insight(): CandidateCardInsight {
  return {
    symbol: "TXN",
    financials: {
      version: "candidate-financial-v1",
      symbol: "TXN",
      source: "Yahoo Finance fundamentals-timeseries",
      fetchedAt: "2026-09-13T00:00:00.000Z",
      currency: "USD",
      currentPrice: 268.7,
      priceAsOfDate: "2026-09-11",
      marketAsOfDate: "2026-09-11",
      fiscalPeriodEnd: "2025-12-31",
      industryClass: "ORDINARY",
      dataQuality: "COMPLETE",
      notes: [],
      metrics: {
        forecastDividendYieldPct: metric(2.11, "PERCENT", "AVAILABLE", "USD"),
        trailingPe: metric(40.84, "RATIO"),
        priceToBook: metric(15.08, "RATIO"),
        marketCap: metric(245_389_653_228, "CURRENCY", "AVAILABLE", "USD"),
        roePct: metric(31.5, "PERCENT"),
        roicPct: metric(18.2, "PERCENT"),
        operatingMarginPct: metric(35.6, "PERCENT"),
        freeCashFlow: metric(6_000_000_000, "CURRENCY", "AVAILABLE", "USD"),
        fcfYieldPct: metric(2.45, "PERCENT"),
        netCash: metric(-5_000_000_000, "CURRENCY", "AVAILABLE", "USD"),
        revenueGrowthPct: metric(4.2, "PERCENT"),
        epsGrowthPct: metric(5.1, "PERCENT"),
        payoutRatioPct: metric(62, "PERCENT"),
        dividendGrowthPct: metric(null, "PERCENT", "UNAVAILABLE"),
      },
    },
    sizing: {
      status: "RESEARCH_ONLY",
      engineStatus: "BUY",
      currentQuantity: 0,
      currentWeightPct: 0,
      recommendedShares: 21,
      recommendedAmountLocal: 5_642.7,
      recommendedAmountBase: 898_792,
      afterQuantity: 21,
      afterWeightPct: 0.12,
      currency: "USD",
      tranchePct: 25,
      trancheCount: 4,
      trancheLabel: "目標枠の25%（初回1回分）",
      nextTrancheCondition: "次回決算確認後に再判定",
      constraints: ["借入は増やさず、現金性資産だけを原資にします"],
      fundingMode: "CASH_ONLY",
      basis: "既存portfolioPositionSizing／268.7 USD基準。分析用参考で自動注文しません",
    },
  };
}

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each([390, 1280])("CandidateMetricsAndSizing at %ipx", width => {
  it("always shows four core metrics plus shares, amount, post-buy weight and batches", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    render(React.createElement(CandidateMetricsAndSizing, { insight: insight() }));

    expect(screen.getByText("予想配当利回り")).toBeTruthy();
    expect(screen.getByText("2.11%")).toBeTruthy();
    expect(screen.getByText("PER")).toBeTruthy();
    expect(screen.getByText("40.84倍")).toBeTruthy();
    expect(screen.getByText("PBR")).toBeTruthy();
    expect(screen.getByText("15.08倍")).toBeTruthy();
    expect(screen.getByText("時価総額")).toBeTruthy();
    expect(screen.getByText("21 株")).toBeTruthy();
    expect(screen.getByText("0.12%")).toBeTruthy();
    expect(screen.getByText(/4回想定/)).toBeTruthy();
    expect(screen.getByText(/市場基準 2026-09-11/)).toBeTruthy();
    expect(screen.getByText(/Yahoo Finance fundamentals-timeseries/)).toBeTruthy();
  });
});

describe("CandidateMetricsAndSizing missing and strict states", () => {
  it("suppresses a calculated amount when the strict candidate is DATA_WAIT", () => {
    render(
      React.createElement(CandidateMetricsAndSizing, {
        insight: insight(),
        strictDecision: "DATA_WAIT",
      })
    );

    expect(screen.getAllByText("暫定計算不可").length).toBeGreaterThan(0);
    expect(screen.getByText(/財務・資料確認前/)).toBeTruthy();
    expect(screen.queryByText("21 株")).toBeNull();
  });

  it("distinguishes not meaningful from unavailable and reveals calculation basis", () => {
    const value = insight();
    value.financials.metrics.trailingPe = metric(null, "RATIO", "NOT_MEANINGFUL");
    value.financials.metrics.priceToBook = metric(null, "RATIO", "UNAVAILABLE");
    render(React.createElement(CandidateMetricsAndSizing, { insight: value }));

    expect(screen.getByText("算定対象外")).toBeTruthy();
    expect(screen.getAllByText("未取得").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /品質・財務余力・算定根拠/ }));
    expect(screen.getAllByText("テスト算定根拠").length).toBeGreaterThan(0);
    expect(screen.getByText(/自動注文ではありません/)).toBeTruthy();
  });
});
