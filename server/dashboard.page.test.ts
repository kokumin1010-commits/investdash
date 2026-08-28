// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  assetTrend: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ invalidate: vi.fn(), portfolio: { invalidate: vi.fn() } }),
    portfolio: {
      overview: { useQuery: mocks.overview },
      assetTrend: { useQuery: mocks.assetTrend },
      dataHealth: { useQuery: () => ({ data: null, isLoading: false }) },
      syncPrices: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: mocks.mutateAsync, isPending: false }) },
      regenerateAllSignals: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: mocks.mutateAsync, isPending: false }) },
      syncDividends: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: mocks.mutateAsync, isPending: false }) },
    },
    news: { syncAll: { useMutation: () => ({ mutate: vi.fn(), mutateAsync: mocks.mutateAsync, isPending: false }) } },
  },
}));

vi.mock("@/hooks/useBatchRun", () => ({
  useBatchRun: () => ({ start: vi.fn(), progress: { running: false, processed: 0, total: 0 } }),
}));

vi.mock("recharts", () => {
  const box = ({ children }: { children?: React.ReactNode }) => children ?? null;
  return {
    Area: box, AreaChart: box, Bar: box, BarChart: box, Cell: box, Line: box,
    Pie: box, PieChart: box, ReferenceLine: box, ResponsiveContainer: box,
    Tooltip: box, XAxis: box, YAxis: box,
  };
});

import Dashboard from "../client/src/pages/Dashboard";

function overviewData(unknownCount: number) {
  const signal = {
    id: 1,
    action: "HOLD",
    confidence: 68,
    rationale: "事業前提は維持されています。",
    factors: {},
    wouldBuyNow: "UNCLEAR",
    priceVsValue: "UNKNOWN",
    dataQuality: "MODERATE",
    reviewTriggers: ["次回決算を確認"],
    riskFlags: ["高値圏"],
    validUntil: new Date("2026-09-05T00:00:00Z"),
    freshness: { isStale: true, reasons: ["NEW_NEWS"], priceMovePct: 1 },
    createdAt: new Date("2026-08-28T00:00:00Z"),
  };
  const group = {
    symbol: "7203.T", name: "トヨタ自動車", market: "JP", currency: "JPY",
    quantity: 100, avgCost: 2500, currentPrice: 3000, marketValue: 300000,
    marketValueBase: 300000, costValueBase: 250000, pnl: 50000, pnlBase: 50000,
    pnlPct: 20, weightPct: 100, sector: "一般消費財", industry: "Auto Manufacturers",
    signal, accountCount: 1, brokers: [], dividend: null, holdingDuration: null,
  };
  return {
    summary: {
      baseCurrency: "JPY", totalAssets: 300000, totalValueBase: 300000,
      totalCostBase: 250000, totalPnl: 50000, totalPnlPct: 20, positionCount: 1,
      cashBalance: 0, interestAssetsBase: 0, interestIncomeBase: 0, interestRatePct: 0,
      totalBorrowedBase: 0, netAssetsBase: 300000, overallLeverage: 1,
      missingPriceCount: 0, lastPriceSyncAt: new Date("2026-08-28T00:00:00Z"), periodChange: null,
    },
    positions: [], groups: [group], sectors: [], currencies: [], markets: [], brokers: [],
    alerts: [], interestAssets: [], dividendCalendar: {},
    dividends: {
      annualIncomeBase: 0, monthlyAverageBase: 0, recurringIncomeBase: 0,
      yieldPct: 0, yieldOnCostPct: 0, payingCount: 0,
      nonPayingCount: unknownCount === 0 ? 1 : 0, unknownCount, specialCount: 0,
      updatedAt: unknownCount === 0 ? new Date("2026-08-28T00:00:00Z") : null,
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.assetTrend.mockReturnValue({
    data: { points: [], snapshotCount: 0, firstAt: null, lastAt: null, changedPointCount: 0, priceOnlyChange: null },
    isLoading: false,
  });
  mocks.overview.mockReturnValue({ data: overviewData(0), isLoading: false, error: null });
});

afterEach(() => cleanup());

describe("Dashboard actual page", () => {
  it("renders ¥0 dividend coverage and all five signal actions with stale stats", () => {
    render(React.createElement(Dashboard));
    expect(screen.getByText("年間配当（税引前）")).toBeTruthy();
    expect(screen.getByText("配当データ取得済み 1/1")).toBeTruthy();
    expect(screen.getByText("判定済み 1/1")).toBeTruthy();
    expect(screen.getByText("平均確信度 68")).toBeTruthy();
    expect(screen.getByText("再分析待ち 1")).toBeTruthy();
    const signalCard = screen.getByText("AI シグナル内訳").closest("[data-slot='card']");
    expect(signalCard?.querySelectorAll("button")).toHaveLength(5);
  });

  it("renders a dash when every symbol dividend is unknown", () => {
    mocks.overview.mockReturnValue({ data: overviewData(1), isLoading: false, error: null });
    render(React.createElement(Dashboard));
    expect(screen.getByText("配当データ未取得")).toBeTruthy();
  });
});
