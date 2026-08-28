// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateCalls: vi.fn(),
  generateAttempt: 0,
}));

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
        portfolio: {
          invalidate: vi.fn(),
          savedCandidates: { invalidate: vi.fn() },
        },
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
                options.onError?.(
                  new Error("AI サービスが一時的に利用できません"),
                  input
                );
              } else {
                options.onSuccess?.({
                  ...rejectedProposal,
                  watchItemId: input.id,
                  reviewStatus: "PENDING",
                });
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
            data: {
              id: 12,
              symbol: "PYPL",
              currency: "USD",
              scope: "WATCHLIST",
              strategy: "LONG_TERM",
              rationale: "段階的に買う",
              model: "gemini-3-flash-preview",
              editedByUser: false,
              generatedAt: "2026-08-29T00:00:00Z",
              currentPrice: 53.71,
              bands: [
                {
                  id: 1,
                  lowerPrice: 48,
                  upperPrice: 54,
                  action: "ADD_SMALL",
                  actionLabel: "打診買いを検討",
                  reason: "目標帯に入った",
                  checkItems: [],
                  plannedAmount: null,
                  sortOrder: 1,
                  checks: [],
                },
              ],
              evaluation: {
                currentBand: {
                  id: 1,
                  lowerPrice: 48,
                  upperPrice: 54,
                  action: "ADD_SMALL",
                  actionLabel: "打診買いを検討",
                  reason: "目標帯に入った",
                  checkItems: [],
                  plannedAmount: null,
                  sortOrder: 1,
                  checks: [],
                },
                abovePlan: false,
                belowPlan: false,
                nextBand: null,
                gapToNextPct: null,
                nextBandPrice: null,
              },
              sizing: {
                status: "BUY",
                amountBase: 4_790_000,
                amountLocal: 4_790_000,
                shares: 100,
                currentWeightPct: 0,
                afterWeightPct: 0.652,
                targetWeightPct: 1,
                targetGapBase: 7_346_678,
                tranchePct: 25,
                liquidAssetsBase: 95_908_963,
                deployableLiquidityBase: 23_977_241,
                remainingLiquidBase: 91_118_963,
                positionRoomBase: 36_733_391,
                sectorCurrentPct: 22.73,
                sectorAfterPct: 23.38,
                sectorLimitPct: 30,
                sectorRoomBase: 23_057_941,
                marginFactor: 0.5,
                ibkrLeverage: 1.825,
                ibkrRiskLevel: "CAUTION",
                ibkrDropToMarginCallPct: 33.88,
                lotSize: 100,
                lotAdjusted: true,
                fundingMode: "CASH_ONLY",
                reasons: [
                  "IBKR が CAUTION のため通常額を 50% に抑えます",
                  "借入は増やさず、現金性資産だけを原資にします",
                  "最低売買単位に合わせて初回額を調整しました",
                ],
              },
            },
            isLoading: false,
            isPending: false,
            isError: false,
            error: null,
          }),
        },
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
    expect(
      await screen.findByText("AI提案を作成できませんでした")
    ).toBeTruthy();
    expect(
      screen.getByText("AI サービスが一時的に利用できません")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "もう一度試す" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "もう一度試す" }));
    await waitFor(() =>
      expect(screen.queryByText("AI提案を作成できませんでした")).toBeNull()
    );
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
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
      expect(card?.className).toContain("ring-sky-400/30");
    });

    window.history.replaceState({}, "", "/watchlist");
  });

  it("shows the simple three-number sizing first and reveals professional grounds on demand", () => {
    render(React.createElement(Watchlist));

    expect(screen.getByText("今回")).toBeTruthy();
    expect(screen.getByText("買う価格")).toBeTruthy();
    expect(screen.getByText("買った後")).toBeTruthy();
    expect(screen.getByText("479万円")).toBeTruthy();
    expect(screen.getByText("100 株")).toBeTruthy();
    expect(screen.getByText("現在 0.00%・未保有")).toBeTruthy();
    expect(screen.queryByText("現在の実保有")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "計算根拠を見る" }));

    expect(screen.getByText("現在の実保有")).toBeTruthy();
    expect(screen.getByText(/4,790,000・100 株/)).toBeTruthy();
    expect(screen.getByText("0.00%（未保有）")).toBeTruthy();
    expect(screen.getByText("IBKR 主レバレッジ")).toBeTruthy();
    expect(screen.getByText("1.82x")).toBeTruthy();
    expect(
      screen.getByText("・IBKR が CAUTION のため通常額を 50% に抑えます")
    ).toBeTruthy();
  });
});
