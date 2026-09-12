// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useOverview: vi.fn(),
  useResearchIdeas: vi.fn(),
  useLongTermChart: vi.fn(),
  useAddProposals: vi.fn(),
  mutateProposal: vi.fn(),
  mutateChecks: vi.fn(),
  mutateGenerateResearch: vi.fn(),
  mutateAddResearch: vi.fn(),
  mutateDismissResearch: vi.fn(),
  invalidateProposals: vi.fn(),
  invalidateOverview: vi.fn(),
  invalidateScheduler: vi.fn(),
  invalidateResearch: vi.fn(),
  invalidateSavedCandidates: vi.fn(),
  invalidateWatchlist: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      portfolio: {
        addProposals: { invalidate: mocks.invalidateProposals },
        priceBandOverview: { invalidate: mocks.invalidateOverview },
        schedulerRuns: { invalidate: mocks.invalidateScheduler },
        unheldResearchIdeas: { invalidate: mocks.invalidateResearch },
        savedCandidates: { invalidate: mocks.invalidateSavedCandidates },
      },
      watchlist: { invalidate: mocks.invalidateWatchlist },
    }),
    portfolio: {
      priceBandOverview: { useQuery: mocks.useOverview },
      unheldResearchIdeas: { useQuery: mocks.useResearchIdeas },
      longTermChart: { useQuery: mocks.useLongTermChart },
      suggestCandidates: {
        useMutation: () => ({ mutate: mocks.mutateGenerateResearch, isPending: false }),
      },
      addSuggestedToWatchlist: {
        useMutation: () => ({ mutate: mocks.mutateAddResearch, isPending: false }),
      },
      dismissCandidate: {
        useMutation: () => ({ mutate: mocks.mutateDismissResearch, isPending: false }),
      },
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

const additionalEligibleRows = Array.from({ length: 11 }, (_, index) => ({
  ...commonRow,
  symbol: index === 0 ? "GOOGL" : `TEST${index + 2}`,
  name: index === 0 ? "Alphabet" : `候補 ${index + 2}`,
  action: index % 2 === 0 ? "ADD_MAIN" : "ADD_SMALL",
  actionLabel: index % 2 === 0 ? "主力買い増しを検討" : "小幅に買い増し検討",
  outsideDirection: null,
  held: index !== 0,
  holdingValueJpy: index === 0 ? null : 5_000_000,
  weightPct: index === 0 ? null : 1,
  avgCost: index === 0 ? null : 2_700,
  pnlPct: index === 0 ? null : 14,
  watchTargetPrice: index === 0 ? 3_100 : null,
  watchGapPct: index === 0 ? -0.6 : null,
  watchPriority: index === 0 ? "HIGH" : null,
  sizing: {
    ...commonRow.sizing,
    shares: index === 0 ? 25 : 100 + index,
    amountBase: index === 0 ? 770_500 : 1_000_000 + index,
    amountLocal: index === 0 ? 5_137 : 1_000_000 + index,
    currentWeightPct: index === 0 ? 0 : 1,
    afterWeightPct: index === 0 ? 0.09 : 1.2,
  },
  ranking: {
    ...commonRow.ranking,
    rank: index + 2,
    score: 86 - index,
  },
}));

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
    ...additionalEligibleRows,
    {
      ...commonRow,
      symbol: "NVDA",
      name: "NVIDIA",
      held: false,
      holdingValueJpy: null,
      weightPct: null,
      avgCost: null,
      pnlPct: null,
      action: "VERIFY",
      actionLabel: "下落要因を確認",
      outsideDirection: null,
      needsCheck: true,
      currentBandId: 22,
      pendingCheckCount: 3,
      ranking: {
        ...commonRow.ranking,
        eligible: false,
        rank: null,
        gateReasons: ["未照合項目があります"],
      },
    },
    {
      ...commonRow,
      symbol: "MSFT",
      name: "Microsoft",
      held: false,
      holdingValueJpy: null,
      weightPct: null,
      avgCost: null,
      pnlPct: null,
      action: "HOLD",
      actionLabel: "様子見",
      outsideDirection: null,
      ranking: {
        ...commonRow.ranking,
        eligible: false,
        rank: null,
        gateReasons: ["買い増し価格帯ではありません"],
      },
    },
    {
      ...commonRow,
      symbol: "9984.T",
      name: "ソフトバンクグループ",
      held: false,
      holdingValueJpy: null,
      weightPct: null,
      avgCost: null,
      pnlPct: null,
      action: null,
      outsideDirection: "ABOVE",
      ranking: {
        ...commonRow.ranking,
        eligible: false,
        rank: null,
        gateReasons: ["価格帯の外です"],
      },
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
    eligibleCount: 12,
    priorityCandidateCount: 5,
    unheldOpportunityVersion: "unheld-purchase-decision-v2",
    unheldCandidates: [] as Array<
      (typeof overviewData.rows)[number] & {
        purchaseDecision: {
          decision: "BUY_NOW" | "PRICE_WAIT" | "DATA_WAIT" | "SKIP";
          label: string;
          reasons: string[];
        };
      }
    >,
    unheldOpportunities: [] as Array<(typeof overviewData.rows)[number]>,
    frozenAt: new Date("2026-08-01T00:00:00Z"),
    monthlyCandidates: [] as Array<(typeof overviewData.rows)[number]>,
  },
};

overviewData.ranking.monthlyCandidates = overviewData.rows
  .filter(row => row.ranking.eligible && row.ranking.rank !== null)
  .sort((a, b) => (a.ranking.rank ?? 999) - (b.ranking.rank ?? 999));
const unheldBySymbol = (symbol: string) => overviewData.rows.find(row => row.symbol === symbol)!;
overviewData.ranking.unheldCandidates = [
  {
    ...unheldBySymbol("GOOGL"),
    purchaseDecision: {
      decision: "BUY_NOW",
      label: "今すぐ購入を検討",
      reasons: ["全口座合算で保有0株です", "資料と価格条件を通過しています"],
    },
  },
  {
    ...unheldBySymbol("MSFT"),
    purchaseDecision: {
      decision: "PRICE_WAIT",
      label: "価格待ち",
      reasons: ["現在は初回購入の価格帯に入っていません"],
    },
  },
  {
    ...unheldBySymbol("NVDA"),
    purchaseDecision: {
      decision: "DATA_WAIT",
      label: "資料確認待ち",
      reasons: ["未照合の確認項目が 3 件あります"],
    },
  },
  {
    ...unheldBySymbol("9984.T"),
    purchaseDecision: {
      decision: "SKIP",
      label: "今回は見送る",
      reasons: ["現在の購入条件を満たしていません"],
    },
  },
];
overviewData.ranking.unheldOpportunities = [overviewData.ranking.unheldCandidates[0]];

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

const researchIdea = (index: number) => ({
  symbol: index === 0 ? "LRCX" : `IDEA${index + 1}`,
  name: index === 0 ? "Lam Research" : `研究候補 ${index + 1}`,
  market: "US",
  track: index % 2 === 0 ? ("EXPAND" as const) : ("FILL" as const),
  basedOn: index % 2 === 0 ? "Semiconductors" : null,
  gapKind: index % 2 === 0 ? "SECTOR" : "REGION",
  reason: "保有中の半導体関連とは異なる収益源を研究する価値がある",
  concern: "設備投資循環と顧客集中を確認する必要がある",
  priority: index < 3 ? ("HIGH" as const) : ("MEDIUM" as const),
  priceAtSuggestion: 298.22,
  targetPrice: 260,
  targetBasis: "過去の調整局面と利益成長のバランス",
  currency: "USD",
  sector: "Technology",
  industry: index % 2 === 0 ? "Semiconductors" : "Industrials",
  addedToWatchlist: false,
  dismissed: false,
  createdAt: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
  sourceLabel: index % 2 === 0 ? "関心を広げる・Semiconductors" : "地域分散を補う",
  missingChecks: ["企業資料の再確認", "投資カード作成", "価格帯と初回購入量の決定"],
  nextAction: "ウォッチリストへ追加し、企業資料・価格帯・初回購入量を確認する",
});

const researchIdeasData = {
  version: "unheld-research-v1",
  targetCount: 24,
  maxCount: 30,
  count: 13,
  remainingToTarget: 11,
  canGenerateMore: true,
  ideas: Array.from({ length: 13 }, (_, index) => researchIdea(index)),
};

const longTermChartData = {
  symbol: "LRCX",
  currency: "USD",
  currentPrice: 298.22,
  span: "10Y" as const,
  adjustmentBasis: "Yahoo Finance の株式分割調整済み月次終値を年次集約（配当再投資を含まない）",
  bars: [
    { year: 2024, t: Date.UTC(2024, 11, 1), close: 180, yearHigh: 200, yearLow: 120, returnPct: null },
    { year: 2025, t: Date.UTC(2025, 11, 1), close: 240, yearHigh: 260, yearLow: 170, returnPct: 33.33 },
    { year: 2026, t: Date.UTC(2026, 8, 1), close: 298.22, yearHigh: 320, yearLow: 220, returnPct: 24.26 },
  ],
  summary: {
    latestClose: 298.22,
    peakClose: 298.22,
    drawdownFromPeakPct: 0,
    startYear: 2024,
    endYear: 2026,
  },
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.useOverview.mockReturnValue({ data: overviewData, isLoading: false, error: null });
  mocks.useResearchIdeas.mockReturnValue({ data: researchIdeasData, isLoading: false, error: null });
  mocks.useLongTermChart.mockReturnValue({ data: longTermChartData, isLoading: false, error: null });
  mocks.useAddProposals.mockReturnValue({ data: [proposal], isLoading: false });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("BuyPlans page interactions", () => {
  it.each([390, 1280])(
    "%dpx 相当で全候補を10名ごとに表示し、上位5名を優先強調する",
    width => {
    Object.defineProperty(window, "innerWidth", {
      value: width,
      configurable: true,
    });
    render(React.createElement(BuyPlans));

    expect(screen.getByText("今月の候補ランキング（全件）")).toBeTruthy();
    expect(screen.getByText("順位 1〜10")).toBeTruthy();
    expect(screen.getByText("順位 11〜12")).toBeTruthy();
    expect(screen.getAllByText("今月優先")).toHaveLength(5);
    expect(screen.getAllByText("500 株").length).toBeGreaterThan(0);
    expect(screen.getAllByText("154 万円").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2.30%").length).toBeGreaterThan(0);
    expect(screen.getByText(/表示 12 銘柄（全件）/)).toBeTruthy();
    expect(screen.queryByTestId("full-buy-plan-list")).toBeNull();
    expect(screen.getByRole("button", { name: "全 15 銘柄を表示" })).toBeTruthy();
    }
  );

  it.each([390, 1280])(
    "%dpxで真实未持有候补を四类判断に分け、全账户0股と初回购买目安を表示する",
    async width => {
    Object.defineProperty(window, "innerWidth", {
      value: width,
      configurable: true,
    });
    const user = userEvent.setup();
    render(React.createElement(BuyPlans));
    expect(screen.getByText("未保有・購入判断")).toBeTruthy();
    expect(screen.getByText(/未保有 4 銘柄・今すぐ検討 1 銘柄/)).toBeTruthy();
    expect(screen.getAllByText("未保有・0株")).toHaveLength(4);
    expect(screen.getAllByText("全口座合算の実保有を確認済み")).toHaveLength(4);
    expect(screen.getByText("今すぐ購入を検討", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("価格待ち", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("資料確認待ち", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("今回は見送る", { selector: "span" })).toBeTruthy();
    expect(screen.getAllByText("Alphabet").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("25 株").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("77 万円").length).toBeGreaterThanOrEqual(2);
    const priceWaitButton = screen
      .getAllByRole("button")
      .find(button => button.textContent?.includes("価格待ち"));
    expect(priceWaitButton).toBeTruthy();
    await user.click(priceWaitButton!);
    expect(screen.getByTestId("unheld-candidate-MSFT")).toBeTruthy();
    expect(screen.queryByTestId("unheld-candidate-GOOGL")).toBeNull();
    }
  );

  it("未持有候補はあるが今すぐ購入0件なら、待つことを明示する", () => {
    mocks.useOverview.mockReturnValue({
      data: {
        ...overviewData,
        ranking: {
          ...overviewData.ranking,
          unheldCandidates: overviewData.ranking.unheldCandidates.filter(
            row => row.purchaseDecision.decision !== "BUY_NOW"
          ),
          unheldOpportunities: [],
        },
      },
      isLoading: false,
      error: null,
    });
    render(React.createElement(BuyPlans));
    expect(
      screen.getByText(
        "現在、今すぐ購入を検討できる未保有候補はありません。価格または確認資料が揃うまでは待ちます。"
      )
    ).toBeTruthy();
  });

  it.each([390, 1280])(
    "%dpxで研究候補を購入判断と分離し、検索・追加表示・年足を操作できる",
    async width => {
      Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
      const user = userEvent.setup();
      render(React.createElement(BuyPlans));

      expect(screen.getByText("未保有・研究候補")).toBeTruthy();
      expect(screen.getByText("13 / 目安 24 銘柄")).toBeTruthy();
      expect(screen.getAllByText("購入判断前")).toHaveLength(12);
      expect(screen.getByTestId("research-idea-LRCX")).toBeTruthy();
      expect(screen.queryByTestId("research-idea-IDEA13")).toBeNull();

      await user.click(screen.getByRole("button", { name: "残り 1 件も表示" }));
      expect(screen.getByTestId("research-idea-IDEA13")).toBeTruthy();

      const search = screen.getByPlaceholderText("研究候補を銘柄名・コード・業種で検索");
      await user.clear(search);
      await user.type(search, "LRCX");
      expect(screen.getByTestId("research-idea-LRCX")).toBeTruthy();
      expect(screen.queryByTestId("research-idea-IDEA2")).toBeNull();

      await user.click(screen.getByRole("button", { name: "長期年足を見る" }));
      expect(screen.getByTestId("long-term-chart-LRCX")).toBeTruthy();
      expect(screen.getByText("2024〜2026")).toBeTruthy();
      expect(screen.getAllByText("298.22 USD").length).toBeGreaterThanOrEqual(1);
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
    await user.click(screen.getByRole("button", { name: "全 15 銘柄を表示" }));

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

    const allPlansButton = screen
      .getAllByRole("button", { name: /すべて/ })
      .find(button => button.textContent?.includes("15"));
    expect(allPlansButton).toBeTruthy();
    await user.click(allPlansButton!);
    expect(screen.getByText("トヨタ自動車", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("NVIDIA", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Microsoft", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("ソフトバンクグループ", { selector: "span" })).toBeTruthy();
    expect(allPlansButton!.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows an empty search and restores the list through the clear button", async () => {
    const user = userEvent.setup();
    render(React.createElement(BuyPlans));
    await user.click(screen.getByRole("button", { name: "全 15 銘柄を表示" }));
    const allPlansButton = screen
      .getAllByRole("button", { name: /すべて/ })
      .find(button => button.textContent?.includes("15"));
    expect(allPlansButton).toBeTruthy();
    await user.click(allPlansButton!);

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
