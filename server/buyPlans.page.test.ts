// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useOverview: vi.fn(),
  useAddProposals: vi.fn(),
  mutateProposal: vi.fn(),
  invalidateProposals: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      portfolio: { addProposals: { invalidate: mocks.invalidateProposals } },
    }),
    portfolio: {
      priceBandOverview: { useQuery: mocks.useOverview },
      addProposals: { useQuery: mocks.useAddProposals },
      generateAddProposalBatch: {
        useMutation: () => ({ mutate: mocks.mutateProposal }),
      },
    },
  },
}));

vi.mock("@/components/investing/TransitionHistoryCard", () => ({
  TransitionHistoryCard: () => null,
}));

import BuyPlans from "../client/src/pages/BuyPlans";

const commonRow = {
  currency: "JPY",
  currentPrice: 3_082,
  actionLabel: null,
  nextGapPct: null,
  nextActionLabel: null,
  needsCheck: false,
  concernCount: 0,
  holdingValueJpy: 10_000_000,
  weightPct: 2,
  avgCost: 2_700,
  pnlPct: 14,
  costRecovered: false,
  held: true,
  watchTargetPrice: null,
  watchGapPct: null,
  watchPriority: null,
  targetTooFar: false,
};

const overviewData = {
  rows: [
    {
      ...commonRow,
      symbol: "7203.T",
      name: "トヨタ自動車",
      action: "ADD_SMALL",
      actionLabel: "小幅に買い増し検討",
      outsideDirection: null,
    },
    {
      ...commonRow,
      symbol: "NVDA",
      name: "NVIDIA",
      action: "VERIFY",
      actionLabel: "下落要因を確認",
      outsideDirection: null,
      needsCheck: true,
    },
    {
      ...commonRow,
      symbol: "9984.T",
      name: "ソフトバンクグループ",
      action: null,
      outsideDirection: "ABOVE",
    },
  ],
  stats: { avgWeightPct: 1.5, topAvgWeightPct: 4.2 },
};

const proposal = {
  id: 1,
  stance: "SKIP",
  held: true,
  symbol: "7203.T",
  name: "トヨタ自動車",
  conclusion: "構成比が上限を超えているため、今は買い増しを見送る",
  amountBase: null,
  shares: null,
  limitPrice: null,
  currency: "JPY",
  sharePctAtProposal: 5.7,
  waitAmountBase: null,
  waitShares: null,
  lotUncertain: false,
  rationale: "市場と個別銘柄への集中を増やさない",
  invalidation: "構成比が 5% を切る",
  createdAt: new Date("2026-08-25T00:00:00Z"),
  priceChangePct: null,
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.useOverview.mockReturnValue({ data: overviewData, isLoading: false, error: null });
  mocks.useAddProposals.mockReturnValue({ data: [proposal], isLoading: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("BuyPlans page interactions", () => {
  it("switches BUY, VERIFY, OUTSIDE and ALL result sets", async () => {
    const user = userEvent.setup();
    render(React.createElement(BuyPlans));

    expect(screen.getByText("トヨタ自動車", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText("NVIDIA", { selector: "span" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /確認が必要/ }));
    expect(screen.getByText("NVIDIA", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText("トヨタ自動車", { selector: "span" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /価格帯の外/ }));
    expect(screen.getByText("ソフトバンクグループ", { selector: "span" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /すべて/ }));
    expect(screen.getByText("トヨタ自動車", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("NVIDIA", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("ソフトバンクグループ", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /すべて/ }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("shows an empty search and restores the list through the clear button", async () => {
    const user = userEvent.setup();
    render(React.createElement(BuyPlans));
    await user.click(screen.getByRole("button", { name: /すべて/ }));

    const search = screen.getByPlaceholderText("銘柄名・ティッカー");
    await user.type(search, "NO-SUCH-SYMBOL");
    expect(screen.getByText("該当する銘柄はありません")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "検索をクリアして一覧に戻す" })
    );
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getByText("トヨタ自動車", { selector: "span" })).toBeTruthy();
  });

  it("renders a consultation link containing the proposal symbol and question", () => {
    render(React.createElement(BuyPlans));
    const link = screen.getByRole("link", { name: "この件を相談する" });
    const url = new URL(link.getAttribute("href") ?? "", "https://example.test");

    expect(url.pathname).toBe("/consult");
    expect(url.searchParams.get("symbol")).toBe("7203.T");
    expect(url.searchParams.get("question")).toContain("構成比が上限を超えている");
  });
});
