// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const metric = (
    value: number | null,
    unit: "PERCENT" | "RATIO" | "CURRENCY",
    currency: string | null = null
  ) => ({
    status: "AVAILABLE" as const,
    value,
    unit,
    currency,
    asOfDate: "2026-09-11",
    period: "TTM",
    basis: "実データに基づくテスト口径",
    source: "Yahoo Finance fundamentals-timeseries",
  });
  const insight = (symbol: string) => ({
    symbol,
    financials: {
      version: "candidate-financial-v1",
      symbol,
      source: "Yahoo Finance fundamentals-timeseries",
      fetchedAt: "2026-09-13T00:00:00.000Z",
      currency: "USD",
      currentPrice: 100,
      priceAsOfDate: "2026-09-11",
      marketAsOfDate: "2026-09-11",
      fiscalPeriodEnd: "2025-12-31",
      industryClass: "ORDINARY" as const,
      dataQuality: "COMPLETE" as const,
      notes: [],
      metrics: {
        forecastDividendYieldPct: metric(2.4, "PERCENT", "USD"),
        trailingPe: metric(18.5, "RATIO"),
        priceToBook: metric(3.2, "RATIO"),
        marketCap: metric(50_000_000_000, "CURRENCY", "USD"),
      },
    },
    sizing: {
      status: "PRICE_WAIT" as const,
      engineStatus: "BUY" as const,
      currentQuantity: 0,
      currentWeightPct: 0,
      recommendedShares: 12,
      recommendedAmountLocal: 1_080,
      recommendedAmountBase: 172_000,
      afterQuantity: 12,
      afterWeightPct: 0.08,
      currency: "USD",
      tranchePct: 25,
      trancheCount: 4,
      trancheLabel: "目標枠の25%（初回1回分）",
      nextTrancheCondition: "目標価格到達後に再確認",
      constraints: ["現金性資産だけを原資にします"],
      fundingMode: "CASH_ONLY" as const,
      basis: "既存portfolioPositionSizingによる分析用参考",
    },
  });
  const baseRow = {
    tickerCode: "CODE",
    market: "US",
    currency: "USD",
    sector: "Technology",
    buyConditions: null,
    watchReason: null,
    plannedAmount: null,
    targetPrice: "90",
    priceNum: 100,
    targetNum: 90,
    dayChangePct: 0,
    newsCount: 0,
    targetLevel: "REALISTIC",
    targetNeedsRework: false,
    targetNote: null,
    alreadyHeld: false,
    heldQuantity: null,
    heldAvgCost: null,
    heldBrokers: [],
    heldPnlPct: null,
    signal: null,
    pendingProposal: null,
    latestProposal: null,
  };
  return {
    dismissCandidate: vi.fn(),
    candidateInsights: [
      insight("TXN"),
      insight("ALPHA"),
      insight("BRAVO"),
      insight("CHARLIE"),
    ],
    savedCandidates: [
      {
        symbol: "TXN",
        name: "Texas Instruments Incorporated",
        track: "EXPAND",
        priority: "HIGH",
        priceAtSuggestion: 268.7,
        targetPrice: 201.52,
        currency: "USD",
        reason: "長期で調査する価値がある。",
        createdAt: "2026-09-12T00:00:00Z",
        dismissed: false,
        addedToWatchlist: false,
      },
    ],
    watchRows: [
      {
        ...baseRow,
        id: 1,
        symbol: "ALPHA",
        tickerCode: "ALP",
        name: "Alpha Corp",
        priority: "HIGH",
        gapPct: -20,
        reachedTarget: false,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        ...baseRow,
        id: 2,
        symbol: "BRAVO",
        tickerCode: "BRV",
        name: "Bravo Corp",
        priority: "LOW",
        gapPct: 4,
        reachedTarget: true,
        createdAt: "2026-02-01T00:00:00Z",
      },
      {
        ...baseRow,
        id: 3,
        symbol: "CHARLIE",
        tickerCode: "285A",
        name: "Charlie Corp",
        priority: "MEDIUM",
        gapPct: -2,
        reachedTarget: false,
        createdAt: "2026-03-01T00:00:00Z",
      },
    ],
  };
});

vi.mock("@/lib/trpc", () => ({
  trpc: (() => {
    const idleMutation = () => ({ mutate: vi.fn(), isPending: false });
    return {
    useUtils: () => ({
      invalidate: vi.fn(),
      watchlist: { invalidate: vi.fn() },
      portfolio: {
        invalidate: vi.fn(),
        savedCandidates: { invalidate: vi.fn() },
      },
    }),
    watchlist: {
      list: { useQuery: () => ({ data: mocks.watchRows, isLoading: false }) },
      add: { useMutation: idleMutation },
      update: { useMutation: idleMutation },
      promote: { useMutation: idleMutation },
      regenerateSignal: { useMutation: idleMutation },
      generateProposal: { useMutation: idleMutation },
      remove: { useMutation: idleMutation },
      reviseTarget: { useMutation: idleMutation },
    },
    portfolio: {
      syncPrices: { useMutation: idleMutation },
      suggestCandidates: { useMutation: idleMutation },
      candidateCardInsights: {
        useQuery: () => ({ data: mocks.candidateInsights, isLoading: false, error: null }),
      },
      savedCandidates: {
        useQuery: () => ({ data: mocks.savedCandidates, isLoading: false }),
      },
      dismissCandidate: {
        useMutation: () => ({ mutate: mocks.dismissCandidate, isPending: false }),
      },
      addSuggestedToWatchlist: { useMutation: idleMutation },
      lookup: {
        useMutation: () => ({
          data: null,
          mutate: vi.fn(),
          reset: vi.fn(),
          isPending: false,
        }),
      },
      priceBandPlan: {
        useQuery: () => ({
          data: null,
          isLoading: false,
          isPending: false,
          isError: false,
          error: null,
        }),
      },
      generateWatchPricePlan: { useMutation: idleMutation },
    },
    };
  })(),
}));

vi.mock("@/components/investing/WatchProposalReviewDialog", () => ({
  WatchProposalReviewDialog: () => null,
}));

vi.mock("@/components/investing/LongTermAnnualChart", () => ({
  LongTermAnnualChart: ({ symbol, targetPrice }: { symbol: string; targetPrice: number | null }) =>
    React.createElement(
      "section",
      {
        "data-testid": `watchlist-long-term-chart-${symbol}`,
        "data-target-price": targetPrice,
        "data-default-span": "MAX",
      },
      "長期年足・上場来"
    ),
}));

import Watchlist from "../client/src/pages/Watchlist";

function cardOrder(): number[] {
  return Array.from(document.querySelectorAll("[data-watch-id]")).map(node =>
    Number(node.getAttribute("data-watch-id"))
  );
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  window.history.replaceState({}, "", "/watchlist");
});

afterEach(() => cleanup());

describe.each([390, 1280])("Watchlist sort at %ipx", width => {
  it("shows a listing-to-date annual chart directly below each company name", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    render(React.createElement(Watchlist));

    const card = document.querySelector('[data-watch-id="3"]');
    expect(card).toBeTruthy();
    const title = within(card as HTMLElement).getByText("Charlie Corp");
    const chart = within(card as HTMLElement).getByTestId("watchlist-long-term-chart-CHARLIE");
    expect(chart.getAttribute("data-default-span")).toBe("MAX");
    expect(chart.getAttribute("data-target-price")).toBe("90");
    expect(title.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const candidateTitle = screen.getByText("Texas Instruments Incorporated");
    const candidateCard = candidateTitle.closest(".rounded-lg.border");
    expect(candidateCard).toBeTruthy();
    const candidateChart = within(candidateCard as HTMLElement).getByTestId(
      "watchlist-long-term-chart-TXN"
    );
    const candidateMetrics = within(candidateCard as HTMLElement).getByTestId(
      "candidate-metrics-TXN"
    );
    expect(within(candidateMetrics).getByText("予想配当利回り")).toBeTruthy();
    expect(within(candidateMetrics).getByText("18.5倍")).toBeTruthy();
    expect(within(candidateMetrics).getByText("3.2倍")).toBeTruthy();
    expect(within(candidateMetrics).getByText("12 株")).toBeTruthy();
    expect(candidateChart.getAttribute("data-default-span")).toBe("MAX");
    expect(candidateChart.getAttribute("data-target-price")).toBe("201.52");
    expect(
      candidateTitle.compareDocumentPosition(candidateChart) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const watchMetrics = within(card as HTMLElement).getByTestId(
      "candidate-metrics-CHARLIE"
    );
    expect(within(watchMetrics).getByText("時価総額")).toBeTruthy();
    expect(within(watchMetrics).getByText("0.08%")).toBeTruthy();

    fireEvent.click(within(candidateCard as HTMLElement).getByRole("button", { name: "今後出さない" }));
    expect(mocks.dismissCandidate).toHaveBeenCalledWith({ symbol: "TXN" });
  });

  it("switches added date, priority and target-distance order", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    render(React.createElement(Watchlist));

    const select = screen.getByLabelText("ウォッチリストの並び順");
    expect((select as HTMLSelectElement).value).toBe("NEWEST");
    expect(cardOrder()).toEqual([3, 2, 1]);
    expect(screen.getByText("3 件を表示")).toBeTruthy();

    fireEvent.change(select, { target: { value: "OLDEST" } });
    expect(cardOrder()).toEqual([1, 2, 3]);

    fireEvent.change(select, { target: { value: "PRIORITY" } });
    expect(cardOrder()).toEqual([1, 3, 2]);

    fireEvent.change(select, { target: { value: "TARGET_NEAREST" } });
    expect(cardOrder()).toEqual([2, 3, 1]);
    expect((select as HTMLSelectElement).value).toBe("TARGET_NEAREST");
  });

  it("searches by name/code, keeps sorting, clears and explains no results", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    render(React.createElement(Watchlist));

    const input = screen.getByLabelText(
      "ウォッチリストを名称または銘柄コードで検索"
    );
    const select = screen.getByLabelText("ウォッチリストの並び順");

    fireEvent.change(input, { target: { value: "  alpha  " } });
    expect(cardOrder()).toEqual([1]);
    expect(screen.getByText("3 件中 1 件を表示")).toBeTruthy();

    fireEvent.change(input, { target: { value: "２８５ａ" } });
    expect(cardOrder()).toEqual([3]);

    fireEvent.change(input, { target: { value: "corp" } });
    expect(cardOrder()).toEqual([3, 2, 1]);
    fireEvent.change(select, { target: { value: "PRIORITY" } });
    expect(cardOrder()).toEqual([1, 3, 2]);

    fireEvent.click(screen.getByRole("button", { name: "クリア" }));
    expect((input as HTMLInputElement).value).toBe("");
    expect(cardOrder()).toEqual([1, 3, 2]);

    fireEvent.change(input, { target: { value: "not-found-symbol" } });
    expect(cardOrder()).toEqual([]);
    expect(screen.getByText("一致する銘柄がありません")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "検索をクリア" }));
    expect(cardOrder()).toEqual([1, 3, 2]);
  });
});
