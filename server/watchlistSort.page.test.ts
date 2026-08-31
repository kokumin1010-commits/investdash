// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    watchRows: [
      {
        ...baseRow,
        id: 1,
        symbol: "ALPHA",
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
      savedCandidates: { useQuery: () => ({ data: [], isLoading: false }) },
      dismissCandidate: { useMutation: idleMutation },
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
  it("switches added date, priority and target-distance order", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    render(React.createElement(Watchlist));

    const select = screen.getByLabelText("ウォッチリストの並び順");
    expect((select as HTMLSelectElement).value).toBe("NEWEST");
    expect(cardOrder()).toEqual([3, 2, 1]);
    expect(screen.getByText("追加が新しい順で 3 件を表示")).toBeTruthy();

    fireEvent.change(select, { target: { value: "OLDEST" } });
    expect(cardOrder()).toEqual([1, 2, 3]);

    fireEvent.change(select, { target: { value: "PRIORITY" } });
    expect(cardOrder()).toEqual([1, 3, 2]);

    fireEvent.change(select, { target: { value: "TARGET_NEAREST" } });
    expect(cardOrder()).toEqual([2, 3, 1]);
    expect(screen.getByText("目標価格に近い順で 3 件を表示")).toBeTruthy();
  });
});
