// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  priceBandOverview: vi.fn(),
  assetTrend: vi.fn(),
  settings: vi.fn(),
  updateSettings: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      invalidate: vi.fn(),
      portfolio: {
        invalidate: vi.fn(),
        settings: { invalidate: vi.fn() },
      },
    }),
    portfolio: {
      overview: { useQuery: mocks.overview },
      priceBandOverview: { useQuery: mocks.priceBandOverview },
      assetTrend: { useQuery: mocks.assetTrend },
      settings: { useQuery: mocks.settings },
      updateSettings: {
        useMutation: () => ({
          mutate: mocks.updateSettings,
          isPending: false,
        }),
      },
      dataHealth: { useQuery: () => ({ data: null, isLoading: false }) },
      syncPrices: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: mocks.mutateAsync,
          isPending: false,
        }),
      },
      regenerateAllSignals: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: mocks.mutateAsync,
          isPending: false,
        }),
      },
      syncDividends: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: mocks.mutateAsync,
          isPending: false,
        }),
      },
    },
    actionQueue: {
      summary: {
        useQuery: () => ({
          data: {
            pending: 0,
            urgent: 0,
            approved: 0,
            snoozed: 0,
            reviewing: 0,
            failed: 0,
            top: [],
          },
          isLoading: false,
        }),
      },
    },
    news: {
      syncAll: {
        useMutation: () => ({
          mutate: vi.fn(),
          mutateAsync: mocks.mutateAsync,
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock("@/hooks/useBatchRun", () => ({
  useBatchRun: () => ({
    start: vi.fn(),
    progress: { running: false, processed: 0, total: 0 },
  }),
}));

vi.mock("recharts", () => {
  const box = ({ children }: { children?: React.ReactNode }) =>
    children ?? null;
  return {
    Area: box,
    AreaChart: box,
    Bar: box,
    BarChart: box,
    Cell: box,
    Line: box,
    Pie: box,
    PieChart: box,
    ReferenceLine: box,
    ResponsiveContainer: box,
    Tooltip: box,
    XAxis: box,
    YAxis: box,
  };
});

import Dashboard from "../client/src/pages/Dashboard";
import { buildSignalReviewPlan } from "../shared/signalReviewPlan";

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
    reviewPlan: buildSignalReviewPlan({
      validUntil: new Date("2026-09-05T00:00:00Z"),
      reviewTriggers: ["次回決算を確認"],
      now: new Date("2026-08-29T00:00:00Z"),
    }),
    freshness: { isStale: true, reasons: ["NEW_NEWS"], priceMovePct: 1 },
    createdAt: new Date("2026-08-28T00:00:00Z"),
  };
  const group = {
    symbol: "7203.T",
    name: "トヨタ自動車",
    market: "JP",
    currency: "JPY",
    quantity: 100,
    avgCost: 2500,
    currentPrice: 3000,
    marketValue: 300000,
    marketValueBase: 300000,
    costValueBase: 250000,
    pnl: 50000,
    pnlBase: 50000,
    pnlPct: 20,
    weightPct: 100,
    sector: "一般消費財",
    industry: "Auto Manufacturers",
    signal,
    accountCount: 1,
    brokers: [],
    dividend: null,
    holdingDuration: null,
  };
  return {
    summary: {
      baseCurrency: "JPY",
      totalAssets: 300000,
      totalValueBase: 300000,
      totalCostBase: 250000,
      totalPnl: 50000,
      totalPnlPct: 20,
      positionCount: 1,
      cashBalance: 0,
      interestAssetsBase: 0,
      interestIncomeBase: 0,
      interestRatePct: 0,
      totalBorrowedBase: 0,
      netAssetsBase: 300000,
      overallLeverage: 1,
      missingPriceCount: 0,
      lastPriceSyncAt: new Date("2026-08-28T00:00:00Z"),
      periodChange: null,
    },
    positions: [],
    groups: [group],
    sectors: [],
    currencies: [],
    markets: [],
    brokers: [],
    alerts: [],
    interestAssets: [],
    dividendCalendar: {},
    dividends: {
      annualIncomeBase: 0,
      monthlyAverageBase: 0,
      recurringIncomeBase: 0,
      yieldPct: 0,
      yieldOnCostPct: 0,
      payingCount: 0,
      nonPayingCount: unknownCount === 0 ? 1 : 0,
      unknownCount,
      specialCount: 0,
      updatedAt: unknownCount === 0 ? new Date("2026-08-28T00:00:00Z") : null,
    },
  };
}

function borrowingOverview() {
  const data = overviewData(0);
  data.summary.totalAssets = 964_000_000;
  data.summary.totalValueBase = 870_751_581;
  data.summary.totalBorrowedBase = 229_223_831;
  data.summary.netAssetsBase = 737_103_099;
  data.summary.overallLeverage = 1.18;
  data.brokers = [
    {
      key: "ibkr",
      label: "IBKR シンガポール",
      count: 51,
      value: 509_266_407,
      pnl: 55_390_000,
      pnlPct: 12.2,
      pct: 58.5,
      dividendIncomeBase: 12_525_194,
      dividendYieldPct: 2.46,
      leverage: {
        borrowedBase: 229_223_831,
        netValueBase: 280_042_576,
        leverage: 1.82,
        marginCushionBase: 174_022_087,
        dropToMarginCallPct: 34.2,
        riskLevel: "CAUTION",
        interest: {
          effectiveRatePct: 1.73,
          annualInterestBase: 3_961_737,
        },
        carry: null,
      },
    },
  ];
  return data;
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.assetTrend.mockReturnValue({
    data: {
      points: [],
      snapshotCount: 0,
      firstAt: null,
      lastAt: null,
      changedPointCount: 0,
      priceOnlyChange: null,
    },
    isLoading: false,
  });
  mocks.overview.mockReturnValue({
    data: overviewData(0),
    isLoading: false,
    error: null,
  });
  mocks.priceBandOverview.mockReturnValue({
    data: {
      ranking: {
        unheldCandidates: [
          { symbol: "GOOGL", purchaseDecision: { decision: "BUY_NOW" } },
          { symbol: "MSFT", purchaseDecision: { decision: "PRICE_WAIT" } },
          { symbol: "NVDA", purchaseDecision: { decision: "DATA_WAIT" } },
          { symbol: "SNOW", purchaseDecision: { decision: "SKIP" } },
        ],
      },
    },
    isLoading: false,
    error: null,
  });
  mocks.settings.mockReturnValue({
    data: {
      longTermTargetNetAssetsJpy: "100000000000.00",
      longTermTargetDate: "2030-12-31",
      longTermTargetAnnualDividendJpy: "2100000000.00",
      longTermTargetAnnualInterestJpy: "300000000.00",
      longTermTargetAnnualNetCashJpy: "2400000000.00",
      longTermAnnualContributionJpy: "120000000.00",
      longTermScenarioConservativePct: "4.00",
      longTermScenarioBasePct: "8.00",
      longTermScenarioOptimisticPct: "12.00",
    },
    isLoading: false,
  });
});

afterEach(() => cleanup());

describe("Dashboard actual page", () => {
  for (const width of [390, 1280]) {
    it(`renders the 2030 long-term goal at ${width}px without turning it into a trade target`, () => {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      mocks.overview.mockReturnValue({
        data: borrowingOverview(),
        isLoading: false,
        error: null,
      });

      render(React.createElement(Dashboard));

      expect(screen.getByText("長期目標")).toBeTruthy();
      expect(screen.getByText("1,000 億円")).toBeTruthy();
      expect(screen.getByText("2030-12-31 まで")).toBeTruthy();
      expect(screen.getByText("高い挑戦目標")).toBeTruthy();
      expect(screen.getByText("現在の年間配当（税引前）")).toBeTruthy();
      expect(screen.getByText("年間利息（見込み）")).toBeTruthy();
      expect(screen.getByText("年間純キャッシュ収入")).toBeTruthy();
      expect(screen.getByText("2030年末の3つの達成情景")).toBeTruthy();
      expect(screen.getByText("年率仮定 4.0%")).toBeTruthy();
      expect(screen.getByText("年率仮定 8.0%")).toBeTruthy();
      expect(screen.getByText("年率仮定 12.0%")).toBeTruthy();
      expect(screen.getAllByText("未達試算")).toHaveLength(3);
      expect(screen.getAllByText("2030年までに必要な月次入金")).toHaveLength(3);
      expect(
        screen.getAllByText("現在の入金計画（0.1 億円 / 月）での到達目安")
      ).toHaveLength(3);
      expect(screen.getAllByText(/年\d+月・あと\d+年/)).toHaveLength(3);
      expect(screen.getAllByText(/現在計画との差 \+/)).toHaveLength(3);
      expect(
        screen.getByText("目標は進捗確認だけに使い、売買順位や提案を変えません。")
      ).toBeTruthy();
    });
  }

  it("shows an honest empty state when a long-term goal is not configured", () => {
    mocks.settings.mockReturnValue({
      data: {
        longTermTargetNetAssetsJpy: null,
        longTermTargetDate: null,
        longTermTargetAnnualDividendJpy: null,
        longTermTargetAnnualInterestJpy: null,
        longTermTargetAnnualNetCashJpy: null,
        longTermAnnualContributionJpy: null,
        longTermScenarioConservativePct: null,
        longTermScenarioBasePct: null,
        longTermScenarioOptimisticPct: null,
      },
      isLoading: false,
    });

    render(React.createElement(Dashboard));
    expect(
      screen.getByText(
        "目標純資産と目標日がまだ設定されていません。「目標を編集」から登録できます。"
      )
    ).toBeTruthy();
  });

  it("edits the asset target in oku-yen and optional income goals in man-yen", () => {
    render(React.createElement(Dashboard));
    fireEvent.click(screen.getByRole("button", { name: "目標を編集" }));

    const targetAsset = screen.getByLabelText("目標純資産（億円）") as HTMLInputElement;
    const targetDate = screen.getByLabelText("目標日") as HTMLInputElement;
    const dividendTarget = screen.getByLabelText(
      "年間配当目標（万円・任意）"
    ) as HTMLInputElement;
    const contributionTarget = screen.getByLabelText(
      "年間追加入金計画（万円・任意）"
    ) as HTMLInputElement;
    const conservativeRate = screen.getByLabelText("保守（%）") as HTMLInputElement;
    const baseRate = screen.getByLabelText("基準（%）") as HTMLInputElement;
    const optimisticRate = screen.getByLabelText("楽観（%）") as HTMLInputElement;
    expect(targetAsset.value).toBe("1000");
    expect(targetDate.value).toBe("2030-12-31");
    expect(contributionTarget.value).toBe("12000");
    expect(conservativeRate.value).toBe("4.00");
    expect(baseRate.value).toBe("8.00");
    expect(optimisticRate.value).toBe("12.00");

    fireEvent.change(dividendTarget, { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      longTermTargetNetAssetsJpy: 100_000_000_000,
      longTermTargetDate: "2030-12-31",
      longTermTargetAnnualDividendJpy: 50_000_000,
      longTermTargetAnnualInterestJpy: 300_000_000,
      longTermTargetAnnualNetCashJpy: 2_400_000_000,
      longTermAnnualContributionJpy: 120_000_000,
      longTermScenarioConservativePct: 4,
      longTermScenarioBasePct: 8,
      longTermScenarioOptimisticPct: 12,
    });
  });

  it("renders ¥0 dividend coverage and all five signal actions with stale stats", () => {
    render(React.createElement(Dashboard));
    expect(screen.getByText("年間配当（税引前）")).toBeTruthy();
    expect(screen.getByText("配当データ取得済み 1/1")).toBeTruthy();
    expect(screen.getByText("判定済み 1/1")).toBeTruthy();
    expect(screen.getByText("平均確信度 68")).toBeTruthy();
    expect(screen.getByText("再分析待ち 1")).toBeTruthy();
    expect(screen.getByText("今週確認する銘柄")).toBeTruthy();
    expect(screen.getByText("あと7日で確認")).toBeTruthy();
    expect(screen.getByText("AI目安")).toBeTruthy();
    expect(screen.getByText("次回決算を確認")).toBeTruthy();
    expect(screen.getByText("未保有・購入判断")).toBeTruthy();
    expect(screen.getByText("今すぐ購入を検討")).toBeTruthy();
    expect(screen.getByText("価格待ち")).toBeTruthy();
    expect(screen.getByText("資料確認待ち")).toBeTruthy();
    expect(screen.getByText("今回は見送る")).toBeTruthy();
    expect(screen.queryByText("未保有と仮定した新規判断")).toBeNull();
    const signalCard = screen
      .getByText("AI シグナル内訳")
      .closest("[data-slot='card']");
    expect(signalCard?.querySelectorAll("button")).toHaveLength(5);
  });

  it("renders a dash when every symbol dividend is unknown", () => {
    mocks.overview.mockReturnValue({
      data: overviewData(1),
      isLoading: false,
      error: null,
    });
    render(React.createElement(Dashboard));
    expect(screen.getByText("配当データ未取得")).toBeTruthy();
  });

  it("promotes the leveraged IBKR account and keeps overall leverage as a reference", () => {
    mocks.overview.mockReturnValue({
      data: borrowingOverview(),
      isLoading: false,
      error: null,
    });
    render(React.createElement(Dashboard));
    expect(screen.getByText("借入（IBKR シンガポールのみ）")).toBeTruthy();
    expect(screen.getByText("IBKR シンガポール レバレッジ")).toBeTruthy();
    expect(screen.getAllByText("1.82 倍").length).toBeGreaterThan(0);
    expect(screen.getByText("全体レバレッジ（参考）")).toBeTruthy();
    expect(screen.getByText("1.18 倍")).toBeTruthy();
    expect(screen.getAllByText("追証までの下落余地").length).toBeGreaterThan(0);
    expect(screen.getByText("年間の借入利息")).toBeTruthy();
  });
});
