// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ generateCalls: vi.fn(), generateAttempt: 0 }));

const rejectedProposal = {
  id: 91,
  watchItemId: 7,
  symbol: "PYPL",
  stance: "WAIT",
  conclusion: "今は価格を待つ",
  rationale: "利益率改善を確認する。",
  amountBase: null,
  limitPrice: 48,
  priceAtProposal: 53.71,
  buyConditions: "48ドル以下かつ利益率改善",
  invalidation: "次回決算で悪化",
  confidence: 72,
  reviewStatus: "REJECTED",
  evidence: null,
  model: "gemini-3-flash-preview",
  createdAt: "2026-08-29T00:00:00Z",
};

vi.mock("@/lib/trpc", () => {
  const idleMutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    trpc: {
      useUtils: () => ({
        invalidate: vi.fn(),
        watchlist: { invalidate: vi.fn() },
        portfolio: { invalidate: vi.fn(), savedCandidates: { invalidate: vi.fn() } },
      }),
      watchlist: {
        list: {
          useQuery: () => ({
            data: [
              {
                id: 7,
                symbol: "PYPL",
                tickerCode: "PYPL",
                name: "PayPal Holdings, Inc.",
                market: "US",
                currency: "USD",
                priority: "MEDIUM",
                sector: "Financial Services",
                buyConditions: null,
                watchReason: null,
                plannedAmount: null,
                targetPrice: null,
                priceNum: 53.71,
                targetNum: null,
                gapPct: null,
                reachedTarget: false,
                dayChangePct: 0,
                newsCount: 4,
                targetLevel: "MISSING",
                targetNeedsRework: false,
                targetNote: null,
                alreadyHeld: false,
                heldQuantity: null,
                heldAvgCost: null,
                heldBrokers: [],
                heldPnlPct: null,
                signal: null,
                pendingProposal: null,
                latestProposal: rejectedProposal,
              },
            ],
            isLoading: false,
          }),
        },
        generateProposal: {
          useMutation: (options: any) => ({
            isPending: false,
            mutate: (input: { id: number }) => {
              mocks.generateCalls(input);
              mocks.generateAttempt += 1;
              if (mocks.generateAttempt === 1) {
                options.onError?.(new Error("AI サービスが一時的に利用できません"), input);
              } else {
                options.onSuccess?.({ ...rejectedProposal, watchItemId: input.id, reviewStatus: "PENDING" });
              }
              options.onSettled?.();
            },
          }),
        },
        add: { useMutation: idleMutation },
        update: { useMutation: idleMutation },
        promote: { useMutation: idleMutation },
        regenerateSignal: { useMutation: idleMutation },
        remove: { useMutation: idleMutation },
        reviseTarget: { useMutation: idleMutation },
      },
      portfolio: {
        syncPrices: { useMutation: idleMutation },
        suggestCandidates: { useMutation: idleMutation },
        savedCandidates: { useQuery: () => ({ data: [], isLoading: false }) },
        dismissCandidate: { useMutation: idleMutation },
        addSuggestedToWatchlist: { useMutation: idleMutation },
        lookup: { useMutation: () => ({ data: null, mutate: vi.fn(), reset: vi.fn(), isPending: false }) },
        priceBandPlan: { useQuery: () => ({ data: null, isLoading: false }) },
        generateWatchPricePlan: { useMutation: idleMutation },
      },
    },
  };
});

vi.mock("@/components/investing/WatchProposalReviewDialog", () => ({
  WatchProposalReviewDialog: () => null,
}));

import Watchlist from "../client/src/pages/Watchlist";

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.generateAttempt = 0;
  mocks.generateCalls.mockClear();
});
afterEach(() => cleanup());

describe("Watchlist proposal recovery", () => {
  it("retries a rejected proposal, shows the first failure, then clears it after success", async () => {
    render(React.createElement(Watchlist));
    expect(screen.getByText("今回は見送り済み")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "もう一度提案" }));
    expect(await screen.findByText("AI提案を作成できませんでした")).toBeTruthy();
    expect(screen.getByText("AI サービスが一時的に利用できません")).toBeTruthy();
    expect(screen.getByRole("button", { name: "もう一度試す" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
    await waitFor(() => expect(screen.queryByText("AI提案を作成できませんでした")).toBeNull());
    expect(mocks.generateCalls).toHaveBeenCalledTimes(2);
    expect(mocks.generateCalls).toHaveBeenLastCalledWith({ id: 7 });
  });

  it("scrolls to and highlights the watch card selected by the focus URL", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    window.history.replaceState({}, "", "/watchlist?focus=7");

    render(React.createElement(Watchlist));

    const card = document.getElementById("watch-7");
    expect(card).toBeTruthy();
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      expect(card?.className).toContain("ring-sky-400/30");
    });

    window.history.replaceState({}, "", "/watchlist");
  });
});
