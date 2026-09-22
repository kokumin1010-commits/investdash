// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  dataHealth: vi.fn(),
  priceBandOverview: vi.fn(),
  assetTrend: vi.fn(),
  settings: vi.fn(),
  updateSettings: vi.fn(),
  recordDividendIncome: vi.fn(),
  searchSecurities: vi.fn(),
  deleteRecentSecuritySearch: vi.fn(),
  clearRecentSecuritySearches: vi.fn(),
  addWatch: vi.fn(),
  generateWatchProposal: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      invalidate: vi.fn(),
      portfolio: {
        invalidate: vi.fn(),
        settings: { invalidate: vi.fn() },
        overview: { invalidate: vi.fn() },
        recentSecuritySearches: { invalidate: vi.fn() },
      },
      watchlist: { invalidate: vi.fn() },
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
      recordDividendIncome: {
        useMutation: () => ({
          mutate: mocks.recordDividendIncome,
          isPending: false,
        }),
      },
      searchSecurities: {
        useMutation: () => ({
          mutate: mocks.searchSecurities,
          data: [],
          error: null,
          isPending: false,
          isSuccess: false,
          reset: vi.fn(),
        }),
      },
      recentSecuritySearches: {
        useQuery: () => ({ data: [] }),
      },
      deleteRecentSecuritySearch: {
        useMutation: () => ({
          mutate: mocks.deleteRecentSecuritySearch,
          isPending: false,
        }),
      },
      clearRecentSecuritySearches: {
        useMutation: () => ({
          mutate: mocks.clearRecentSecuritySearches,
          isPending: false,
        }),
      },
      dataHealth: { useQuery: mocks.dataHealth },
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
    watchlist: {
      add: {
        useMutation: () => ({
          mutate: mocks.addWatch,
          isPending: false,
        }),
      },
      generateProposal: {
        useMutation: () => ({
          mutate: mocks.generateWatchProposal,
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
    cashIncome: {
      actual: {
        asOfDate: "2026-09-13",
        latestDailyInterest: {
          amountJpy: 8_530,
          status: "AVAILABLE",
          recordCount: 4,
          recordedDays: 1,
          lastDate: "2026-08-24",
          sourceLabel: "現金宝・貨幣基金の日次利息付与",
        },
        interestMtd: {
          amountJpy: null,
          status: "UNAVAILABLE",
          recordCount: 0,
          recordedDays: 0,
          lastDate: null,
          sourceLabel: "現金宝・貨幣基金の月次記録分",
        },
        interestYtd: {
          amountJpy: 8_530,
          status: "PARTIAL",
          recordCount: 4,
          recordedDays: 1,
          lastDate: "2026-08-24",
          sourceLabel: "現金宝・貨幣基金の年次記録分",
        },
        lifetimeInterest: {
          amountJpy: 586_970,
          status: "PARTIAL",
          recordCount: 4,
          recordedDays: 1,
          lastDate: "2026-08-24",
          sourceLabel: "現金宝・貨幣基金の最新累計収益",
        },
        dividendMtd: {
          amountJpy: null,
          status: "UNAVAILABLE",
          recordCount: 0,
          recordedDays: 0,
          lastDate: null,
          sourceLabel: "券商の実際入金記録",
        },
        dividendYtd: {
          amountJpy: null,
          status: "UNAVAILABLE",
          recordCount: 0,
          recordedDays: 0,
          lastDate: null,
          sourceLabel: "券商の実際入金記録",
        },
        recordedGrossIncomeMtdJpy: null,
        recordedGrossIncomeMtdStatus: "UNAVAILABLE",
        recordedGrossIncomeYtdJpy: 8_530,
        recordedGrossIncomeYtdStatus: "PARTIAL",
        borrowingInterestMtd: {
          amountJpy: 152_530,
          status: "PARTIAL",
          recordCount: 1,
          recordedDays: 0,
          lastDate: "2026-08-25",
          sourceLabel: "証券口座の月初来支払利息",
        },
        netCashMtdJpy: null,
        netCashMtdStatus: "UNAVAILABLE",
        note: "実績は記録済みの計提・入金だけを集計します。",
      },
      forecast: {
        asOfDate: "2026-09-13",
        annualDividendJpy: 22_000_000,
        annualDividendStatus: "AVAILABLE",
        annualInterestJpy: 3_000_000,
        annualInterestStatus: "AVAILABLE",
        annualBorrowingInterestJpy: 4_000_000,
        annualBorrowingInterestStatus: "AVAILABLE",
        annualNetCashJpy: 21_000_000,
        annualNetCashStatus: "AVAILABLE",
        dividendBasis: "現在保有株数 × 直近12か月の1株配当実績（税引前）",
        interestBasis: "現在の現金宝・貨幣基金残高 × 記録年率の日次複利試算",
        borrowingBasis: "現在の借入残高 × 通貨別金利の年換算試算",
      },
    },
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
  mocks.dataHealth.mockReturnValue({ data: null, isLoading: false });
  mocks.priceBandOverview.mockReturnValue({
    data: {
      ranking: {
        existingHoldingAddSummary: {
          policyVersion: "existing-holding-add-review-v1",
          rawAddZoneCount: 3,
          rawAddMainCount: 1,
          rawAddSmallCount: 2,
          safetyGatePassedCount: 2,
          reviewReadyCount: 1,
          reviewReadyMainCount: 1,
          reviewReadySmallCount: 0,
          reviewOnlyCount: 2,
          deferralCounts: {
            SAFETY_GATE: 1,
            CONFIRMED_CONCERN: 0,
            SIGNAL_CONFLICT: 0,
            SIGNAL_STALE_OR_MISSING: 1,
            SIGNAL_DATA_LIMITED: 0,
            VALUATION_NOT_POSITIVE: 1,
            LOW_CONVICTION: 0,
          },
          candidates: [
            {
              symbol: "7203.T",
              name: "トヨタ自動車",
              currency: "JPY",
              currentPrice: 3000,
              action: "ADD_MAIN",
              currentBandReason: "企業価値の伸びに対して価格が許容範囲です",
              holdingQuantity: 100,
              signalAction: "HOLD",
              signalConfidence: 68,
              signalWouldBuyNowReason: "現在値でも長期価値を確認できます",
              cardConviction: 4,
              reviewRank: 1,
              priceBandRank: 2,
              sizing: {
                amountBase: 600000,
                shares: 200,
                afterWeightPct: 1.2,
              },
            },
          ],
        },
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
  it("separates AI holding ADD 0 from strict existing-holding add candidates", () => {
    render(React.createElement(Dashboard));

    expect(screen.getByTestId("existing-holding-add-panel")).toBeTruthy();
    expect(screen.getByText("既存保有・今月の買い増し検討順")).toBeTruthy();
    expect(screen.getByText("AI 保有シグナル内訳")).toBeTruthy();
    expect(screen.getByRole("button", { name: /ADD\s*0/ })).toBeTruthy();
    expect(
      screen.getByTestId("signal-add-separation-note").textContent
    ).toContain("別集計");
    expect(
      screen.getByTestId("existing-holding-add-funnel").textContent
    ).toContain("価格帯内");
    expect(
      screen.getByTestId("existing-holding-add-candidate-7203.T").textContent
    ).toContain("+200株");
    expect(
      screen.getByTestId("existing-holding-add-candidate-7203.T").textContent
    ).toContain("実行後 300株");
    expect(screen.getByText(/検討用の参考案であり、注文ではありません/)).toBeTruthy();
  });

  it("株価データ正常表示を小さなピルにして検索欄より上へ置く", () => {
    mocks.dataHealth.mockReturnValue({
      data: {
        summary: { total: 146, problem: 0 },
        problems: [],
        lastSyncAt: new Date("2026-09-19T06:30:00.000Z"),
      },
      isLoading: false,
    });

    render(React.createElement(Dashboard));

    const health = screen.getByTestId("data-health-compact");
    const search = screen.getByPlaceholderText(
      "会社名・コードを検索（V03 / Venture / AAPL）"
    );
    expect(health.className).toContain("rounded-full");
    expect(health.className).toContain("py-1.5");
    expect(
      health.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("puts the asset temperature, value, P/L and trend before income and goal sections", () => {
    const data = overviewData(0) as any;
    data.summary.dayChangeBase = -3_600_000;
    data.summary.dayChangePct = -1.2;
    data.summary.marketChanges = {
      day: null,
      sevenDay: {
        fromAt: new Date("2026-09-12T00:00:00Z"),
        toAt: new Date("2026-09-19T00:00:00Z"),
        days: 7,
        totalDelta: -20_000_000,
        costDelta: 4_000_000,
        gainDelta: -24_000_000,
        gainPct: -8,
        countDelta: 0,
        compositionChanged: false,
        targetDays: 7,
        fellShort: false,
        usedSameCompositionFallback: false,
      },
      thirtyDay: null,
    };
    data.cashIncome.forecast.netAssets = {
      currentJpy: 300_000,
      previousJpy: 303_000,
      dayChangeJpy: -3_000,
      dayChangePct: -1,
      previousAsOfDate: "2026-09-18",
      sevenDayChangeJpy: -21_000,
      sevenDayChangePct: -6.5,
      sevenDayAsOfDate: "2026-09-12",
      thirtyDayChangeJpy: 12_000,
      thirtyDayChangePct: 4,
      thirtyDayAsOfDate: "2026-08-20",
    };
    data.cashIncome.cashBalanceTracking = {
      status: "SCREENSHOT_PROVISIONAL",
      asOfDate: "2026-09-19",
      confirmedAccountCount: 2,
      confirmedAccountTotalJpy: -212_000_000,
      confirmedPositiveCashJpy: 8_000_000,
      confirmedNegativeCashJpy: -220_000_000,
      settledDividendAfterAnchorJpy: 0,
      provisionalAccountTotalJpy: -212_000_000,
      provisionalPositiveCashJpy: 8_000_000,
      provisionalNegativeCashJpy: -220_000_000,
      legacyTotalJpy: null,
      missingBrokers: [],
      accounts: [],
      note: "test",
    };
    mocks.overview.mockReturnValue({ data, isLoading: false, error: null });
    mocks.assetTrend.mockReturnValue({
      data: {
        points: [
          {
            date: "9/18",
            at: new Date("2026-09-18T00:00:00Z"),
            value: 300_000,
            cost: 250_000,
            netAssets: 280_000,
            positionCount: 1,
            positionChanged: false,
            positionDelta: 0,
            priceChange: null,
          },
          {
            date: "9/19",
            at: new Date("2026-09-19T00:00:00Z"),
            value: 296_400,
            cost: 250_000,
            netAssets: 276_400,
            positionCount: 1,
            positionChanged: false,
            positionDelta: 0,
            priceChange: -3_600,
          },
        ],
        snapshotCount: 2,
        firstAt: new Date("2026-09-17T15:30:00Z"),
        lastAt: new Date("2026-09-18T15:30:00Z"),
        changedPointCount: 0,
        priceOnlyChange: -3_600,
        fellBack: false,
      },
      isLoading: false,
    });

    render(React.createElement(Dashboard));

    const panel = screen.getByTestId("market-temperature-panel");
    const addPanel = screen.getByTestId("existing-holding-add-panel");
    const income = screen.getByText("キャッシュ収入：確定実績と将来予想");
    expect(screen.getByText("資産温度計")).toBeTruthy();
    expect(screen.getByText("調整局面")).toBeTruthy();
    expect(screen.getByTestId("top-stock-value-card")).toBeTruthy();
    expect(screen.getByTestId("top-unrealized-pnl-card")).toBeTruthy();
    expect(screen.getByTestId("top-asset-trend-card")).toBeTruthy();
    expect(screen.getByText(/（9\/18〜9\/19）/)).toBeTruthy();
    expect(screen.getByTestId("temperature-前日")).toBeTruthy();
    expect(screen.getByTestId("temperature-7日")).toBeTruthy();
    expect(screen.getByTestId("temperature-30日")).toBeTruthy();
    expect(screen.getAllByText("保有株値動き").length).toBeGreaterThan(0);
    expect(screen.getAllByText("純資産評価変動").length).toBeGreaterThan(0);
    expect(screen.getByText(/実測 2\/3期間/)).toBeTruthy();
    expect(screen.getByText(/確認済みプラス現金/)).toBeTruthy();
    expect(
      panel.compareDocumentPosition(income) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      panel.compareDocumentPosition(addPanel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      addPanel.compareDocumentPosition(income) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(mocks.assetTrend).toHaveBeenCalledWith({ scale: "day" });
  });

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
      expect(screen.getByText("キャッシュ収入：確定実績と将来予想")).toBeTruthy();
      expect(screen.getByText("記録済みの確定キャッシュ収益")).toBeTruthy();
      expect(screen.getByText("前回スクショ以降の確定利息")).toBeTruthy();
      expect(screen.getByText("本年の入金済み配当")).toBeTruthy();
      expect(screen.getAllByText("未連携").length).toBeGreaterThan(0);
      expect(screen.getByText("利益の種類を分けて表示")).toBeTruthy();
      expect(screen.getByText("株式：含み損益")).toBeTruthy();
      expect(
        screen.getByText("現金宝：前回スクショ以降の確定利息")
      ).toBeTruthy();
      expect(screen.getByText("株式：入金済み配当")).toBeTruthy();
      expect(screen.getByText("未実現")).toBeTruthy();
      expect(screen.getAllByText("確定（記録範囲）").length).toBeGreaterThan(0);
      expect(screen.getByText("将来予想（未確定）")).toBeTruthy();
      expect(screen.getByText("将来1年間の予想（未確定）")).toBeTruthy();
      expect(screen.getByText("未来の配当予想（税引前）")).toBeTruthy();
      expect(screen.getByText("未来の利息予想")).toBeTruthy();
      expect(screen.getByText("未来の純キャッシュ収入予想")).toBeTruthy();
      expect(screen.getByText("¥737,103,099")).toBeTruthy();
      expect(screen.getByText("¥50,000")).toBeTruthy();
      expect(screen.getByText("現在の純資産（評価額）")).toBeTruthy();
      expect(screen.getByText("純資産の評価変動（未確定を含む）")).toBeTruthy();
      expect(screen.getByText(/前日／前回比 前回値未取得/)).toBeTruthy();
      expect(
        screen.getByText(/株価・為替・入出金・現金性資産・借入などを含み/)
      ).toBeTruthy();
      expect(screen.getByText("2030年末の3つの複利・再投資情景")).toBeTruthy();
      expect(screen.getByTestId("long-term-projection-basis")).toBeTruthy();
      expect(screen.getByText("配当は全額再投資")).toBeTruthy();
      expect(screen.getByText("株価年率 4.0%")).toBeTruthy();
      expect(screen.getByText("株価年率 8.0%")).toBeTruthy();
      expect(screen.getByText("株価年率 12.0%")).toBeTruthy();
      expect(screen.getAllByText("配当再投資")).toHaveLength(3);
      expect(screen.getAllByText("現金宝複利")).toHaveLength(3);
      expect(screen.getAllByText("借入利息").length).toBeGreaterThanOrEqual(3);
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

  it("records only an actual settled dividend through the protected income form", () => {
    render(React.createElement(Dashboard));

    expect(
      screen
        .getByRole("link", { name: "スクショから自動計算" })
        .getAttribute("href")
    ).toBe("/import");
    fireEvent.click(screen.getByRole("button", { name: "手入力" }));
    fireEvent.change(screen.getByLabelText("入金日"), {
      target: { value: "2026-09-10" },
    });
    fireEvent.change(screen.getByLabelText("銘柄・配当名"), {
      target: { value: "Texas Instruments 配当" },
    });
    fireEvent.change(screen.getByLabelText("配当総額（原通貨）"), {
      target: { value: "100" },
    });
    fireEvent.change(screen.getByLabelText("源泉税（原通貨）"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText("手数料（原通貨）"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "実績として保存" }));

    expect(mocks.recordDividendIncome).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        occurredOn: "2026-09-10",
        broker: "futu_hk",
        name: "Texas Instruments 配当",
        currency: "USD",
        grossAmount: 100,
        taxAmount: 15,
        feeAmount: 1,
      })
    );
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
      .getByText("AI 保有シグナル内訳")
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
