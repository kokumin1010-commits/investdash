// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
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
    expect(candidateChart.getAttribute("data-default-span")).toBe("MAX");
    expect(candidateChart.getAttribute("data-target-price")).toBe("201.52");
    expect(
      candidateTitle.compareDocumentPosition(candidateChart) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

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
