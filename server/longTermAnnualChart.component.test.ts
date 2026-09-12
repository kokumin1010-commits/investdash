// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useLongTermChart: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    portfolio: {
      longTermChart: { useQuery: mocks.useLongTermChart },
    },
  },
}));

vi.mock("recharts", () => {
  const box = ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children);
  return {
    Area: box,
    AreaChart: box,
    CartesianGrid: box,
    ReferenceLine: box,
    ResponsiveContainer: box,
    Tooltip: box,
    XAxis: box,
    YAxis: box,
  };
});

import { LongTermAnnualChart } from "../client/src/components/investing/LongTermAnnualChart";

let triggerIntersection: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        triggerIntersection = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
  mocks.useLongTermChart.mockReturnValue({
    data: {
      symbol: "TXN",
      currency: "USD",
      currentPrice: 198.5,
      span: "MAX",
      adjustmentBasis: "split-adjusted",
      bars: [
        { year: 1992, t: 1, close: 2.5, yearHigh: 3, yearLow: 2, returnPct: null },
        { year: 2026, t: 2, close: 198.5, yearHigh: 220, yearLow: 160, returnPct: 12 },
      ],
      summary: {
        latestClose: 198.5,
        peakClose: 210,
        drawdownFromPeakPct: -5.48,
        startYear: 1992,
        endYear: 2026,
      },
    },
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  triggerIntersection = null;
});

describe("LongTermAnnualChart", () => {
  it("defaults to an expanded listing-to-date chart and only enables data near the viewport", () => {
    render(
      React.createElement(LongTermAnnualChart, {
        symbol: "TXN",
        targetPrice: 180,
      })
    );

    expect(screen.getByRole("button", { name: "長期年足を見る" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "上場来" }).getAttribute("aria-pressed")).toBe("true");
    expect(mocks.useLongTermChart).toHaveBeenLastCalledWith(
      { symbol: "TXN", span: "MAX" },
      expect.objectContaining({ enabled: false })
    );

    act(() => triggerIntersection?.([{ isIntersecting: true }]));
    expect(mocks.useLongTermChart).toHaveBeenLastCalledWith(
      { symbol: "TXN", span: "MAX" },
      expect.objectContaining({ enabled: true })
    );
    expect(screen.getByText("1992〜2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "10年" }));
    expect(mocks.useLongTermChart).toHaveBeenLastCalledWith(
      { symbol: "TXN", span: "10Y" },
      expect.objectContaining({ enabled: true })
    );

    fireEvent.click(screen.getByRole("button", { name: "長期年足を見る" }));
    expect(screen.queryByTestId("long-term-chart-TXN")).toBeNull();
  });
});
