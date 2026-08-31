// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useOverview: vi.fn(),
  useAddProposals: vi.fn(),
  mutateProposal: vi.fn(),
  mutateChecks: vi.fn(),
  invalidateProposals: vi.fn(),
  invalidateOverview: vi.fn(),
  invalidateScheduler: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      portfolio: {
        addProposals: { invalidate: mocks.invalidateProposals },
        priceBandOverview: { invalidate: mocks.invalidateOverview },
        schedulerRuns: { invalidate: mocks.invalidateScheduler },
      },
    }),
    portfolio: {
      priceBandOverview: { useQuery: mocks.useOverview },
      addProposals: { useQuery: mocks.useAddProposals },
      generateAddProposalBatch: {
        useMutation: () => ({ mutate: mocks.mutateProposal }),
      },
      runMissingBandChecks: {
        useMutation: () => ({ mutate: mocks.mutateChecks, isPending: false }),
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
  currentBandId: null,
  currentBandLowerPrice: 2_900,
  currentBandUpperPrice: 3_100,
  currentBandReason: "企業価値の伸びに対して価格が許容範囲",
  currentBandPlannedAmount: null,
  currentBandCheckItems: [],
  pendingCheckCount: 0,
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
  generatedAt: new Date("2026-08-01T00:00:00Z"),
  signalAction: "ADD",
  signalConfidence: 85,
  signalDataQuality: "STRONG",
  cardConviction: 4,
  sizing: {
    status: "BUY",
    amountBase: 1_540_000,
    amountLocal: 1_540_000,
    shares: 500,
    currentWeightPct: 2,
    afterWeightPct: 2.3,
    sectorAfterPct: 12,
    sectorLimitPct: 30,
    ibkrRiskLevel: "SAFE",
    reasons: ["借入は増やさず、現金性資産だけを原資にします"],
  },
  ranking: {
    eligible: true,
    rank: 1,
    score: 88,
    scoreVersion: "buy-plan-rank-v1",
    breakdown: {
      quality: 27,
      valuation: 22,
      fundamentals: 18,
      portfolioFit: 12,
      liquidityLeverage: 9,
    },
    gateReasons: [],
    rationale: ["現在は小幅買い増し価格帯"],
  },
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
      currentBandId: 22,
      pendingCheckCount: 3,
    },
    {
      ...commonRow,
      symbol: "MSFT",
      name: "Microsoft",
      action: "HOLD",
      actionLabel: "様子見",
      outsideDirection: null,
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
  coverage: {
    total: 5,
    ready: 4,
    pending: [
      { symbol: "9432.T", name: "NTT", hasPlan: false, generatedAt: null },
      { symbol: "V", name: "Visa", hasPlan: false, generatedAt: null },
    ],
  },
  ranking: {
    rankingMonth: "2026-08",
    scoreVersion: "buy-plan-rank-v1",
    rankingFingerprint: "fixture",
    snapshotRecomputed: false,
    eligibleCount: 1,
    frozenAt: new Date("2026-08-01T00:00:00Z"),
    monthlyCandidates: [] as Array<(typeof overviewData.rows)[number]>,
  },
};

overviewData.ranking.monthlyCandidates = [overviewData.rows[0]];

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
  it.each([390, 1280])(
    "%dpx 相当で本月优先候补の具体数量を表示し、全一覧は既定で閉じる",
    width => {
    Object.defineProperty(window, "innerWidth", {
      value: width,
      configurable: true,
    });
    render(React.createElement(BuyPlans));

    expect(screen.getByText("今月の優先候補")).toBeTruthy();
    expect(screen.getByText("500 株")).toBeTruthy();
    expect(screen.getByText("154 万円")).toBeTruthy();
    expect(screen.getByText("2.30%")).toBeTruthy();
    expect(screen.queryByTestId("full-buy-plan-list")).toBeNull();
    expect(screen.getByRole("button", { name: "全 4 銘柄を表示" })).toBeTruthy();
    }
  );

  it("shows real plan coverage and every pending holding without fake price bands", () => {
    render(React.createElement(BuyPlans));

    expect(screen.getByText("4 / 5 銘柄を作成済み。", { exact: false })).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "価格帯プラン作成率" })
        .getAttribute("aria-valuenow")
    ).toBe("4");
    expect(screen.getByText("NTT", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Visa", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("未作成 2 銘柄")).toBeTruthy();
    expect(screen.getByText("に未照合 3 項目があります", { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2 銘柄を今すぐ照合" })).toBeTruthy();
    expect(screen.getByText("Railway が 20 分ごとに", { exact: false })).toBeTruthy();
  });

  it("switches BUY, VERIFY, OUTSIDE and ALL result sets", async () => {
    const user = userEvent.setup();
    render(React.createElement(BuyPlans));
    await user.click(screen.getByRole("button", { name: "全 4 銘柄を表示" }));

    expect(screen.getByText("トヨタ自動車", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText("NVIDIA", { selector: "span" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /様子見/ }));
    expect(screen.getByText("Microsoft", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText("トヨタ自動車", { selector: "span" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /確認が必要/ }));
    expect(screen.getByText("NVIDIA", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText("トヨタ自動車", { selector: "span" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /価格帯の外/ }));
    expect(screen.getByText("ソフトバンクグループ", { selector: "span" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /すべて/ }));
    expect(screen.getByText("トヨタ自動車", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("NVIDIA", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Microsoft", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("ソフトバンクグループ", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /すべて/ }).getAttribute("aria-pressed")).toBe(
      "true"
    );
  });

  it("shows an empty search and restores the list through the clear button", async () => {
    const user = userEvent.setup();
    render(React.createElement(BuyPlans));
    await user.click(screen.getByRole("button", { name: "全 4 銘柄を表示" }));
    await user.click(screen.getByRole("button", { name: /すべて/ }));

    const search = screen.getByPlaceholderText("銘柄名・ティッカー");
    await user.type(search, "NO-SUCH-SYMBOL");
    expect(screen.getByText("該当する銘柄はありません")).toBeTruthy();
    expect(screen.getByText("この検索条件に一致する未作成銘柄はありません")).toBeTruthy();

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
