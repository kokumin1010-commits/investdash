// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ detail: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      invalidate: vi.fn(),
      portfolio: {
        invalidate: vi.fn(),
        priceBandPlan: { invalidate: vi.fn() },
        priceBandOverview: { invalidate: vi.fn() },
      },
    }),
    portfolio: {
      detail: { useQuery: mocks.detail },
      priceBandPlan: { useQuery: () => ({ data: null, isLoading: false }) },
      generatePriceBandPlan: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      runBandChecks: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      updatePriceBand: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      regenerateSignal: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      draftCard: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
      saveCard: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
    news: {
      syncOne: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
        }),
      },
    },
    consult: { bySymbol: { useQuery: () => ({ data: [], isLoading: false }) } },
  },
}));

vi.mock("recharts", () => {
  const box = ({ children }: { children?: React.ReactNode }) =>
    children ?? null;
  return {
    Area: box,
    AreaChart: box,
    ReferenceLine: box,
    ResponsiveContainer: box,
    Tooltip: box,
    XAxis: box,
    YAxis: box,
  };
});

import HoldingDetail from "../client/src/pages/HoldingDetail";

function detailData(stale: boolean) {
  return {
    holding: {
      id: 1,
      userId: 1,
      brokerId: 1,
      broker: {
        id: 1,
        name: "楽天証券 iSPEED",
        code: "RAKUTEN",
        type: "DOMESTIC",
      },
      name: "トヨタ自動車",
      symbol: "7203.T",
      tickerCode: "7203",
      market: "JP",
      currency: "JPY",
      quantity: "8100",
      avgCost: "2581",
      sector: "一般消費財",
      industry: "Auto Manufacturers",
      businessSummary: null,
      website: null,
      acquiredAt: null,
      acquiredAtSource: null,
    },
    view: {
      id: 1,
      symbol: "7203.T",
      name: "トヨタ自動車",
      market: "JP",
      currency: "JPY",
      quantity: 8100,
      avgCost: 2581,
      currentPrice: 3130,
      marketValue: 25353000,
      marketValueBase: 25353000,
      costValue: 20906100,
      costValueBase: 20906100,
      pnl: 4446900,
      pnlBase: 4446900,
      pnlPct: 21.27,
      weightPct: 2.9,
      fiftyTwoWeekLow: 2686,
      fiftyTwoWeekHigh: 4000,
      holdingDuration: {
        days: 3,
        startDate: new Date("2026-08-26T00:00:00Z"),
        confidence: "AT_LEAST",
        source: "MONTHLY_SNAPSHOT",
      },
      signal: {
        id: 3,
        action: "HOLD",
        confidence: 72,
        rationale: "事業前提は維持されています。",
        factors: {},
        wouldBuyNow: "YES",
        wouldBuyNowReason: "未保有なら買付を検討できる。",
        priceVsValue: "IN_LINE",
        priceVsValueReason: "価格と中身は概ね釣り合う。",
        dataQuality: "STRONG",
        schemaVersion: 3,
        reviewTriggers: ["次回決算で営業利益率を確認"],
        riskFlags: ["為替感応度が高い"],
        validUntil: new Date("2026-09-05T00:00:00Z"),
        freshness: stale
          ? {
              isStale: true,
              reasons: ["NEW_NEWS", "PRICE_MOVE"],
              priceMovePct: 11,
            }
          : { isStale: false, reasons: [], priceMovePct: 2 },
        createdAt: new Date("2026-08-28T00:00:00Z"),
      },
      dividend: {
        perShare: 90,
        annualIncome: 729000,
        annualIncomeBase: 729000,
        yieldPct: 2.8754,
        yieldOnCostPct: 3.487,
        count: 2,
        frequency: "semiannual",
        lastDate: new Date("2026-06-01T00:00:00Z"),
        lastAmount: 45,
        updatedAt: new Date("2026-08-28T00:00:00Z"),
        hasSpecial: false,
        recurringPerShare: 90,
        recurringYieldPct: 2.8754,
        yieldNeedsCheck: false,
        monthlyIncomeBase: null,
        monthlyPerShare: null,
      },
    },
    card: null,
    news: [],
    signalHistory: [],
    chart: [],
    addPlan: null,
    groupWeightPct: 2.9,
    actionPlan: {
      direction: "NONE",
      shares: 0,
      amountLocal: 0,
      amountBase: 0,
      afterQuantity: 8100,
      afterWeightPct: 2.9,
      accountCount: 1,
      lotSize: 100,
      lotUncertain: false,
      rationale: "現在の保有を維持し、追加売買は行いません",
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.detail.mockReturnValue({
    data: detailData(true),
    isLoading: false,
    error: null,
  });
});
afterEach(() => cleanup());

describe("HoldingDetail actual page", () => {
  it("renders holding duration, basis and rich stale signal metadata", () => {
    render(React.createElement(HoldingDetail, { params: { id: "1" } }));
    expect(screen.getByText("保有期間")).toBeTruthy();
    expect(screen.getByText("少なくとも 3日")).toBeTruthy();
    expect(screen.getByText(/月次記録/)).toBeTruthy();
    expect(screen.getByText("材料充足")).toBeTruthy();
    expect(screen.getByText("再分析待ち")).toBeTruthy();
    expect(screen.getByText(/分析後に新しいニュースあり/)).toBeTruthy();
    expect(screen.getByText(/次回決算で営業利益率を確認/)).toBeTruthy();
    expect(screen.getByText(/為替感応度が高い/)).toBeTruthy();
  });

  it("renders valid-until date for a fresh signal", () => {
    mocks.detail.mockReturnValue({
      data: detailData(false),
      isLoading: false,
      error: null,
    });
    render(React.createElement(HoldingDetail, { params: { id: "1" } }));
    expect(screen.getByText(/通常の再確認期限/)).toBeTruthy();
  });

  it("renders real dividend metrics and an actual-holding action before the reference lens", () => {
    render(React.createElement(HoldingDetail, { params: { id: "1" } }));
    expect(screen.getByText("予想配当利回り")).toBeTruthy();
    expect(screen.getByText("2.88%")).toBeTruthy();
    expect(screen.getByText("年間配当見込")).toBeTruthy();
    expect(screen.getByText(/729,000/)).toBeTruthy();
    expect(screen.getByText("8,100株を継続保有")).toBeTruthy();
    expect(screen.getByText("売買なし")).toBeTruthy();
    const reference = screen.getByText(/参考視点/).closest("details");
    expect(reference?.open).toBe(false);
  });

  it("shows a compact JPY execution amount for REDUCE without truncating the decision", () => {
    const data = detailData(false);
    data.view.signal.action = "REDUCE";
    data.actionPlan = {
      ...data.actionPlan,
      direction: "SELL",
      shares: 500,
      amountLocal: 1369000,
      amountBase: 1369000,
      afterQuantity: 7600,
      afterWeightPct: 2.72,
      rationale: "保有合計の25%を一部売却する初回目安です",
    };
    mocks.detail.mockReturnValue({ data, isLoading: false, error: null });
    render(React.createElement(HoldingDetail, { params: { id: "1" } }));
    expect(screen.getByText("500株の一部売却を検討")).toBeTruthy();
    expect(screen.getByText("¥137万")).toBeTruthy();
  });
});
