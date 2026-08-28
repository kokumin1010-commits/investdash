import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { fetchCompanyProfile, fetchPriceHistory, fetchQuote } from "../services/marketData";
import { isQuotaError, toFriendlyAiError } from "../services/aiErrors";
import { buildAssetTrend, resolveScale, type SnapshotInput } from "../services/assetTrend";
import {
  buildInterestAssetViews,
  summarizeInterestAssets,
} from "../services/interestAssets";
import {
  generateAndSavePlanForHolding,
  generateAndSavePlanForWatchItem,
  generateMissingHoldingPlans,
  getPlan,
  listPlanStatus,
  listPlanOverview,
  computeOverviewStats,
  runChecksForBand,
  runMissingBandChecksBatch,
  runNewsTriggeredBandChecksBatch,
  updateBand,
} from "../services/priceBandService";
import {
  acknowledgeTransitions,
  listTransitions,
  recordTransitions,
} from "../services/bandTransitionService";
import {
  countUnreadReports,
  createWeeklyReport,
  getReport,
  listReports,
} from "../services/reportService";
import { createUrgentReports } from "../services/urgentReport";
import {
  draftCardForSymbol,
  draftMissingCards,
  draftTriggeredCards,
} from "../services/cardService";
import { listAiRuns } from "../services/aiRunLog";
import { checkVerdicts } from "../services/outcomeService";
import { generateCandidateSuggestions, addCandidatesToWatchlist } from "../services/candidateService";
import {
  generateProposal,
  generateProposalBatch,
  listProposals,
  listProposalsForSymbol,
} from "../services/addProposalService";
import { checkDataHealth } from "../services/dataHealthService";
import {
  countNotesBySymbol,
  listSymbolNotes,
  syncSymbolNotes,
} from "../services/symbolNoteService";
import {
  buildPortfolio,
  enrichProfileBatch,
  enrichProfiles,
  generateMissingSignalsBatch,
  refreshStaleSignalsBatch,
  syncDividends,
  regenerateSignal,
  syncFxRate,
  syncPrices,
} from "../services/portfolio";
import { BROKERS, normalizeSymbol } from "../../shared/investing";
import { BAND_ACTIONS } from "../../shared/priceBands";
import { getRailwayDataBackfillStatus } from "../railwayScheduler";
import {
  listSchedulerRuns,
  SCHEDULER_RUN_KINDS,
  withSchedulerRunLog,
} from "../services/schedulerRunLog";

const decimalString = z.union([z.number(), z.string()]).transform(v => String(v));

export const portfolioRouter = router({
  /** ダッシュボード・一覧の統合データ */
  overview: protectedProcedure.query(async ({ ctx }) => {
    return buildPortfolio(ctx.user.id);
  }),

  settings: protectedProcedure.query(async ({ ctx }) => db.getSettings(ctx.user.id)),

  /** Railway 常駐 cron が実際に動いた時刻と不足件数（運用確認用） */
  railwayDataBackfillStatus: protectedProcedure.query(() => getRailwayDataBackfillStatus()),

  schedulerRuns: protectedProcedure
    .input(
      z
        .object({
          kind: z.string().max(64).optional(),
          status: z.enum(["RUNNING", "SUCCESS", "PARTIAL", "FAILED", "SKIPPED"]).optional(),
          trigger: z.enum(["SCHEDULED", "MANUAL", "STARTUP"]).optional(),
          from: z.coerce.date().optional(),
          to: z.coerce.date().optional(),
          limit: z.number().int().min(1).max(300).default(100),
        })
        .default({ limit: 100 })
    )
    .query(async ({ ctx, input }) => {
      const rows = await listSchedulerRuns(ctx.user.id, input);
      return {
        rows,
        kinds: SCHEDULER_RUN_KINDS,
        stats: {
          total: rows.length,
          success: rows.filter(row => row.status === "SUCCESS").length,
          partial: rows.filter(row => row.status === "PARTIAL").length,
          failed: rows.filter(row => row.status === "FAILED").length,
          running: rows.filter(row => row.status === "RUNNING").length,
        },
      } as const;
    }),

  systemEvents: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).default({ limit: 50 }))
    .query(async ({ ctx, input }) => db.listSystemEvents(ctx.user.id, input.limit)),

  updateSettings: protectedProcedure
    .input(
      z.object({
        usdJpyRate: z.number().positive().optional(),
        sgdJpyRate: z.number().positive().optional(),
        hkdJpyRate: z.number().positive().optional(),
        concentrationThreshold: z.number().int().min(1).max(100).optional(),
        sectorConcentrationThreshold: z.number().int().min(1).max(100).optional(),
        cashBalance: z.number().min(0).optional(),
        autoNewsEnabled: z.boolean().optional(),
        fxAutoUpdate: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.updateSettings(ctx.user.id, {
        usdJpyRate: input.usdJpyRate !== undefined ? String(input.usdJpyRate) : undefined,
        sgdJpyRate: input.sgdJpyRate !== undefined ? String(input.sgdJpyRate) : undefined,
        hkdJpyRate: input.hkdJpyRate !== undefined ? String(input.hkdJpyRate) : undefined,
        concentrationThreshold: input.concentrationThreshold,
        sectorConcentrationThreshold: input.sectorConcentrationThreshold,
        cashBalance: input.cashBalance !== undefined ? String(input.cashBalance) : undefined,
        autoNewsEnabled: input.autoNewsEnabled,
        fxAutoUpdate: input.fxAutoUpdate,
        // 手動でレートを入れたときは、自動取得の時刻表示が実態と合わなくなるため消す
        ...(input.usdJpyRate !== undefined ||
        input.sgdJpyRate !== undefined ||
        input.hkdJpyRate !== undefined
          ? { fxRateUpdatedAt: undefined }
          : {}),
      });
    }),

  /**
   * 為替レートだけを今すぐ取得し直す。
   * 株価更新は 27 銘柄以上あると時間がかかるため、レートだけ直したい場合の入口。
   */
  syncFxRate: protectedProcedure.mutation(async ({ ctx }) => {
    const rates = await syncFxRate(ctx.user.id, true);
    // すべて取れなかった場合だけ失敗として扱う（1 つでも取れれば前進している）
    if (rates.usdJpy === null && rates.sgdJpy === null && rates.hkdJpy === null) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          "為替レートを取得できませんでした。時間をおいて再度お試しください。設定画面から手動で入力することもできます。",
      });
    }
    return rates;
  }),

  /** 口座別の残高・証拠金情報（信用取引の負債管理） */
  brokerBalances: protectedProcedure.query(async ({ ctx }) => db.listBrokerBalances(ctx.user.id)),

  /**
   * 口座の残高・証拠金情報を保存する。
   *
   * 信用取引を使っている口座では、株式時価をそのまま資産にすると借入分だけ
   * 過大になる。借入額・維持証拠金を記録して純資産とレバレッジを算出できるようにする。
   */
  saveBrokerBalance: protectedProcedure
    .input(
      z.object({
        broker: z.enum(BROKERS),
        currency: z.string().min(1).max(8).default("JPY"),
        /** 現金残高。マイナスなら借入 */
        cashBalance: z.number(),
        /** 維持証拠金。信用を使わない口座は 0 */
        maintenanceMargin: z.number().min(0).default(0),
        /** 月初来の支払利息（マイナス表記） */
        interestMtd: z.number().default(0),
        /** 借入している通貨（記録用） */
        borrowedCurrency: z.string().max(8).optional(),
        /** 借入額（記録用、マイナス表記） */
        borrowedAmount: z.number().optional(),
        /** 画面表示の株式時価。検算用に残す */
        reportedPositionValue: z.number().optional(),
        /** 画面表示の純資産。検算用に残す */
        reportedNetValue: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      /*
       * 通貨別の内訳は JSON で保持する。どの通貨で借りているかは
       * 金利と為替リスクの判断に必要なため記録しておく。
       */
      const breakdown: Record<string, number> = {};
      if (input.borrowedCurrency && input.borrowedAmount !== undefined) {
        breakdown[input.borrowedCurrency] = input.borrowedAmount;
      }
      if (input.reportedPositionValue !== undefined) {
        breakdown.__reportedPositionValue = input.reportedPositionValue;
      }
      if (input.reportedNetValue !== undefined) {
        breakdown.__reportedNetValue = input.reportedNetValue;
      }

      /*
       * 設定画面からは借入額と維持証拠金だけを直したいことが多い。
       * その場合に通貨別内訳と検算値（画面表示の株式時価・純資産）が
       * 消えてしまわないよう、指定がなかった項目は既存の記録を引き継ぐ。
       */
      const existing = await db.getBrokerBalance(ctx.user.id, input.broker);
      let merged = breakdown;
      if (existing?.currencyBreakdown) {
        try {
          const prev = JSON.parse(existing.currencyBreakdown) as Record<string, number>;
          merged = { ...prev, ...breakdown };
        } catch {
          // 壊れた JSON は引き継がず、今回の入力だけを保存する
        }
      }

      const id = await db.upsertBrokerBalance({
        userId: ctx.user.id,
        broker: input.broker,
        currency: input.currency,
        cashBalance: String(input.cashBalance),
        maintenanceMargin: String(input.maintenanceMargin),
        interestMtd: String(input.interestMtd),
        currencyBreakdown: Object.keys(merged).length > 0 ? JSON.stringify(merged) : null,
        capturedAt: new Date(),
      });
      return { id } as const;
    }),

  /** 口座の残高情報を削除する（信用取引をやめた場合など） */
  deleteBrokerBalance: protectedProcedure
    .input(z.object({ broker: z.enum(BROKERS) }))
    .mutation(async ({ ctx, input }) => {
      const removed = await db.deleteBrokerBalance(ctx.user.id, input.broker);
      return { success: removed } as const;
    }),

  /**
   * 利息で増える現金性資産（貨幣市場基金・現金宝など）の一覧。
   *
   * 株式とは分けて返す。株価が上下する資産と元本がほぼ動かない資産を
   * 同じ枠に入れると「含み損益」の意味が変わってしまうため。
   */
  interestAssets: protectedProcedure.query(async ({ ctx }) => {
    const [rows, settings] = await Promise.all([
      db.listInterestAssets(ctx.user.id),
      db.getSettings(ctx.user.id),
    ]);
    const fx = {
      usdJpy: Number(settings.usdJpyRate),
      sgdJpy: Number(settings.sgdJpyRate),
      hkdJpy: Number(settings.hkdJpyRate),
    };
    const views = buildInterestAssetViews(rows, fx);
    return { items: views, summary: summarizeInterestAssets(views) };
  }),

  /** 利息資産を追加・更新する（同じ口座・同じ商品名なら上書き） */
  saveInterestAsset: protectedProcedure
    .input(
      z.object({
        broker: z.enum(BROKERS),
        name: z.string().min(1).max(160),
        currency: z.string().min(1).max(8),
        amount: z.number().min(0),
        /** 年換算利回り（%）。日次で変わるので記録時点の目安 */
        annualRatePct: z.number().min(0).max(100).optional(),
        /** 前日の受取利息。実績から利回りを検算するために持つ */
        dailyIncome: z.number().optional(),
        /** 累計収益。買った時からの通算 */
        cumulativeIncome: z.number().optional(),
        /** 利息が元本に組み入れられるか */
        compounding: z.boolean().default(true),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.upsertInterestAsset({
        userId: ctx.user.id,
        broker: input.broker,
        name: input.name,
        currency: input.currency.toUpperCase(),
        amount: String(input.amount),
        annualRatePct: input.annualRatePct === undefined ? null : String(input.annualRatePct),
        dailyIncome: input.dailyIncome === undefined ? null : String(input.dailyIncome),
        cumulativeIncome:
          input.cumulativeIncome === undefined ? null : String(input.cumulativeIncome),
        compounding: input.compounding,
        notes: input.notes ?? null,
        capturedAt: new Date(),
      });
      return { id } as const;
    }),

  /** 利息資産を削除する（解約した場合など） */
  deleteInterestAsset: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await db.deleteInterestAsset(ctx.user.id, input.id);
      return { success: removed } as const;
    }),

  /** 銘柄コードから相場情報を照会（追加フォームのプレビュー用） */
  lookup: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(24) }))
    .mutation(async ({ input }) => {
      const { symbol, tickerCode, market } = normalizeSymbol(input.code);
      if (!symbol) throw new TRPCError({ code: "BAD_REQUEST", message: "銘柄コードを入力してください" });

      const quote = await fetchQuote(symbol);
      if (!quote || quote.price === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${input.code} の相場情報が見つかりませんでした。日本株は4桁コード、米国株はティッカーを入力してください。`,
        });
      }
      const profile = await fetchCompanyProfile(symbol);

      return {
        symbol,
        tickerCode,
        market,
        name: quote.longName ?? quote.shortName ?? tickerCode,
        currency: quote.currency,
        price: quote.price,
        previousClose: quote.previousClose,
        exchangeName: quote.exchangeName,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        sector: profile?.sector ?? null,
        industry: profile?.industry ?? null,
        website: profile?.website ?? null,
        businessSummary: profile?.businessSummary ?? null,
      };
    }),

  addHolding: protectedProcedure
    .input(
      z.object({
        code: z.string().min(1).max(24),
        name: z.string().min(1).max(160).optional(),
        quantity: z.number().positive(),
        avgCost: z.number().min(0),
        // BROKERS から生成し、対応プラットフォームを追加したときの漏れを防ぐ
        broker: z.enum(BROKERS).optional(),
        notes: z.string().max(2000).optional(),
        acquiredAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { symbol, tickerCode, market } = normalizeSymbol(input.code);
      if (!symbol) throw new TRPCError({ code: "BAD_REQUEST", message: "銘柄コードが不正です" });

      // 同一銘柄でも証券口座が違えば別ポジションとして登録できる
      // （例: ヤクルトを moomoo と楽天 iSPEED の両方で保有）
      const broker = input.broker ?? "other";
      const existing = await db.getHoldingBySymbolAndBroker(ctx.user.id, symbol, broker);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${symbol} は同じ証券口座に既に登録されています。保有一覧から編集してください。`,
        });
      }

      const quote = await fetchQuote(symbol);
      const profile = await fetchCompanyProfile(symbol);

      const id = await db.insertHolding({
        userId: ctx.user.id,
        symbol,
        tickerCode,
        name: input.name || quote?.longName || quote?.shortName || tickerCode,
        market,
        currency: quote?.currency ?? (market === "JP" ? "JPY" : "USD"),
        broker,
        quantity: String(input.quantity),
        avgCost: String(input.avgCost),
        currentPrice: quote?.price !== null && quote?.price !== undefined ? String(quote.price) : undefined,
        previousClose:
          quote?.previousClose !== null && quote?.previousClose !== undefined
            ? String(quote.previousClose)
            : undefined,
        fiftyTwoWeekHigh:
          quote?.fiftyTwoWeekHigh !== null && quote?.fiftyTwoWeekHigh !== undefined
            ? String(quote.fiftyTwoWeekHigh)
            : undefined,
        fiftyTwoWeekLow:
          quote?.fiftyTwoWeekLow !== null && quote?.fiftyTwoWeekLow !== undefined
            ? String(quote.fiftyTwoWeekLow)
            : undefined,
        sector: profile?.sector ?? undefined,
        industry: profile?.industry ?? undefined,
        website: profile?.website ?? undefined,
        businessSummary: profile?.businessSummary ?? undefined,
        notes: input.notes,
        acquiredAt: input.acquiredAt,
        acquiredAtSource: input.acquiredAt ? "USER_CONFIRMED" : undefined,
        priceUpdatedAt: quote ? new Date() : undefined,
        profileUpdatedAt: profile ? new Date() : undefined,
      });

      return { id, symbol };
    }),

  updateHolding: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(160).optional(),
        quantity: z.number().positive().optional(),
        avgCost: z.number().min(0).optional(),
        broker: z.enum(BROKERS).optional(),
        notes: z.string().max(2000).optional(),
        acquiredAt: z.coerce.date().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const target = await db.getHolding(ctx.user.id, input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });

      await db.updateHolding(ctx.user.id, input.id, {
        name: input.name,
        quantity: input.quantity !== undefined ? String(input.quantity) : undefined,
        avgCost: input.avgCost !== undefined ? String(input.avgCost) : undefined,
        broker: input.broker,
        notes: input.notes,
        acquiredAt: input.acquiredAt,
        acquiredAtSource:
          input.acquiredAt === undefined
            ? undefined
            : input.acquiredAt === null
              ? null
              : "USER_CONFIRMED",
      });
      return { success: true } as const;
    }),

  deleteHolding: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await db.deleteHolding(ctx.user.id, input.id);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });
      return { success: true, symbol: removed.symbol } as const;
    }),

  /** 銘柄詳細（投資カード・ニュース・シグナル履歴・チャート） */
  detail: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const holding = await db.getHolding(ctx.user.id, input.id);
      if (!holding) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });

      const [card, news, history, chart, portfolio] = await Promise.all([
        db.getCard(ctx.user.id, holding.symbol),
        db.listNews(ctx.user.id, { symbol: holding.symbol, limit: 30 }),
        db.signalHistory(ctx.user.id, holding.symbol, 12),
        fetchPriceHistory(holding.symbol, "1y", "1d"),
        buildPortfolio(ctx.user.id),
      ]);

      const view = portfolio.positions.find(p => p.id === holding.id) ?? null;
      /*
       * 買い増し金額は銘柄単位（複数口座の合計）で決める。
       * 口座ごとに 1 回分を出すと、同じ銘柄を 3 口座で持っている場合に
       * 3 倍の金額を買ってよいように見えてしまう。
       */
      const group = portfolio.groups.find(g => g.symbol === holding.symbol) ?? null;

      return {
        holding,
        view,
        card: card ?? null,
        news,
        signalHistory: history,
        chart,
        addPlan: group?.addPlan ?? null,
        /** 銘柄合計の構成比。買い増し後との比較に使う */
        groupWeightPct: group?.weightPct ?? null,
      };
    }),

  chart: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(24),
        range: z.enum(["1mo", "3mo", "6mo", "1y", "5y"]).default("1y"),
      })
    )
    .query(async ({ input }) => fetchPriceHistory(input.symbol, input.range, "1d")),

  saveCard: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1).max(24),
        holdingId: z.number().int().positive().optional(),
        buyReason: z.string().max(4000).optional(),
        coreThesis: z.string().max(4000).optional(),
        valuationAssumption: z.string().max(4000).optional(),
        fairValue: z.number().min(0).nullable().optional(),
        keyFinancials: z.string().max(4000).optional(),
        exitConditions: z.string().max(4000).optional(),
        risks: z.string().max(4000).optional(),
        horizon: z.string().max(80).optional(),
        conviction: z.number().int().min(1).max(5).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = await db.upsertCard({
        userId: ctx.user.id,
        symbol: input.symbol,
        holdingId: input.holdingId,
        buyReason: input.buyReason,
        coreThesis: input.coreThesis,
        valuationAssumption: input.valuationAssumption,
        fairValue:
          input.fairValue === null || input.fairValue === undefined
            ? null
            : String(input.fairValue),
        keyFinancials: input.keyFinancials,
        exitConditions: input.exitConditions,
        risks: input.risks,
        horizon: input.horizon,
        conviction: input.conviction ?? null,
      });
      return { id } as const;
    }),

  /** 株価の手動更新 */
  syncPrices: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await syncPrices(ctx.user.id);
    /*
     * 株価が変わったら判定変化を記録する。
     * 更新と記録を別操作にすると、記録を忘れた期間だけ履歴が飛んで
     * 「いつ買い増し圏に入ったか」が追えなくなる。
     * 記録の失敗で株価更新まで失敗扱いにはしない（株価の更新は成功しているため）。
     */
    let transitions: Awaited<ReturnType<typeof recordTransitions>> | null = null;
    try {
      transitions = await recordTransitions(ctx.user.id);
    } catch (e) {
      console.error("[syncPrices] 判定変化の記録に失敗", e);
    }
    /*
     * 株価が動いたので、相談で出した提案の当否も判定し直す。
     * 経過日数が足りず未判定だったものが、日が経てば判定できるようになる。
     * ここで一緒に走らせないと判定のためだけに別操作が必要になり、
     * 月 1 回しか画面を見ない使い方では実績が溜まらない。
     */
    let verdicts: Awaited<ReturnType<typeof checkVerdicts>> | null = null;
    try {
      verdicts = await checkVerdicts(ctx.user.id);
    } catch (e) {
      console.error("[syncPrices] 提案の当否判定に失敗", e);
    }
    /*
     * 判定変化と当否が確定したので、銘柄メモにも積む。
     * 別操作にすると積み忘れた期間だけ経緯が飛び、相談 AI が
     * 「何が起きてきたか」を踏まえられなくなる。
     * ここでも失敗は無視する（株価更新自体は成功しているため）。
     */
    try {
      await syncSymbolNotes(ctx.user.id);
    } catch (e) {
      console.error("[syncPrices] 銘柄メモの蓄積に失敗", e);
    }
    return { ...result, transitions, verdicts };
  }),

  /** 買い増しプランの判定が変わった履歴 */
  bandTransitions: protectedProcedure
    .input(
      z
        .object({
          symbol: z.string().optional(),
          onlyUnacknowledged: z.boolean().default(false),
          limit: z.number().int().min(1).max(300).default(100),
        })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      listTransitions(ctx.user.id, {
        symbol: input?.symbol,
        onlyUnacknowledged: input?.onlyUnacknowledged ?? false,
        limit: input?.limit ?? 100,
      })
    ),

  /** 判定変化を確認済みにする */
  acknowledgeBandTransitions: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int()).optional() }).optional())
    .mutation(async ({ ctx, input }) =>
      acknowledgeTransitions(ctx.user.id, { ids: input?.ids })
    ),

  /** 判定変化を今すぐ記録する（株価更新なしで確認したいとき用） */
  recordBandTransitions: protectedProcedure.mutation(async ({ ctx }) =>
    recordTransitions(ctx.user.id)
  ),

  /** AI レポートの一覧 */
  reports: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          unreadOnly: z.boolean().default(false),
        })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      listReports(ctx.user.id, {
        limit: input?.limit ?? 50,
        unreadOnly: input?.unreadOnly ?? false,
      })
    ),

  /** AI レポートの本文。開いた時点で既読になる */
  report: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => getReport(ctx.user.id, input.id)),

  /** 未読のレポート件数 */
  unreadReportCount: protectedProcedure.query(async ({ ctx }) =>
    countUnreadReports(ctx.user.id)
  ),

  /**
   * レポートを今すぐ作る。
   *
   * 定期実行を待たずに内容を確認したいときに使う。
   * days を変えれば期間を広げられる（初回は記録が浅いため）。
   */
  generateWeeklyReport: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(7) }).optional())
    .mutation(async ({ ctx, input }) => createWeeklyReport(ctx.user.id, input?.days ?? 7)),

  /**
   * 臨時レポートを今すぐ作る。
   *
   * 決算日を事前に取得できないため、起きたことをニュースから検知して出す。
   * lookbackHours を広げれば過去の出来事も対象にできる。
   */
  generateUrgentReports: protectedProcedure
    .input(z.object({ lookbackHours: z.number().int().min(1).max(720).default(26) }).optional())
    .mutation(async ({ ctx, input }) =>
      createUrgentReports(ctx.user.id, input?.lookbackHours ?? 26)
    ),

  /** セクター情報の補完 */
  /**
   * 投資カードを AI に下書きさせる。
   *
   * 手で書く前提だと 112 銘柄は書き切れず 1 件も作られていなかった。
   * AI が下書きし、必要なら直すだけの形にする。
   */
  draftCard: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24), force: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) =>
      draftCardForSymbol(ctx.user.id, input.symbol, input.force)
    ),

  /** カードが空の銘柄をまとめて下書きする（評価額の大きい順） */
  draftMissingCards: protectedProcedure
    .input(
      z
        .object({
          batchSize: z.number().int().min(1).max(4).optional(),
          /** 旧画面の互換入力。指定時は batchSize より優先する */
          limit: z.number().int().min(1).max(4).optional(),
          retryFailed: z.boolean().default(false),
        })
        .default({ retryFailed: false })
    )
    .mutation(async ({ ctx, input }) =>
      withSchedulerRunLog({
        userId: ctx.user.id,
        kind: "investment_card_backfill",
        trigger: "MANUAL",
        run: () =>
          draftMissingCards(ctx.user.id, {
            batchSize: input.limit ?? input.batchSize ?? 2,
            retryFailed: input.retryFailed,
          }),
        summarize: value => ({
          processed: value.processed,
          succeeded: value.created,
          failed: value.failed.length,
          skipped: value.skipped,
          remaining: value.remaining,
          detail: {
            failedSymbols: value.failed,
            deferredSymbols: value.deferred,
            quotaExhausted: value.quotaExhausted,
          },
        }),
      })
    ),

  enrichProfiles: protectedProcedure
    .input(z.object({ force: z.boolean().default(false) }).optional())
    .mutation(async ({ ctx, input }) => {
      const count = await enrichProfiles(ctx.user.id, input?.force ?? false);
      return { count } as const;
    }),

  enrichProfileBatch: protectedProcedure
    .input(
      z
        .object({
          force: z.boolean().default(false),
          offset: z.number().int().min(0).default(0),
          batchSize: z.number().int().min(1).max(30).default(20),
        })
        .default({ force: false, offset: 0, batchSize: 20 })
    )
    .mutation(async ({ ctx, input }) => enrichProfileBatch(ctx.user.id, input)),

  /**
   * 配当情報の取得。
   *
   * 銘柄数が多いと本番の 180 秒制限に収まらないため、
   * offset / batchSize で分割実行できるようにしている。
   * 呼び出し側は nextOffset が null になるまで繰り返す。
   */
  syncDividends: protectedProcedure
    .input(
      z
        .object({
          force: z.boolean().default(false),
          offset: z.number().int().min(0).default(0),
          batchSize: z.number().int().min(1).max(40).default(20),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      return await syncDividends(ctx.user.id, {
        force: input?.force ?? false,
        offset: input?.offset ?? 0,
        batchSize: input?.batchSize ?? 20,
      });
    }),

  /** シグナル再生成（1 銘柄） */
  regenerateSignal: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const holding = await db.getHolding(ctx.user.id, input.id);
      if (!holding) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });
      try {
        return await regenerateSignal(ctx.user.id, holding);
      } catch (error) {
        // 生の LLM エラーを返すと「押しても何も起きない」と受け取られてしまうため変換する
        throw toFriendlyAiError(error, "シグナルの生成に失敗しました");
      }
    }),

  /**
   * 全銘柄のシグナルを再生成する（1 リクエスト = 1 バッチ）。
   *
   * 本番（Autoscale / Cloud Run）のリクエスト上限は 180 秒。1 銘柄あたり
   * 10〜16 秒かかるため 27 銘柄を 1 リクエストで処理すると 4〜5 分かかり必ず切断される。
   * そこで `offset` から `batchSize` 件だけ処理して `nextOffset` を返し、
   * クライアントが完了まで呼び出しを繰り返す方式にする。
   *
   * batchSize=6 なら最悪 6×16=96 秒で、180 秒に十分収まる。
   */
  regenerateAllSignals: protectedProcedure
    .input(
      z
        .object({
          offset: z.number().int().min(0).default(0),
          batchSize: z.number().int().min(1).max(10).default(6),
        })
        .default({ offset: 0, batchSize: 6 })
    )
    .mutation(async ({ ctx, input }) => {
      const hs = await db.listHoldings(ctx.user.id);
      /**
       * シグナルは銘柄単位。同一銘柄を複数の証券口座で保有している場合、
       * 口座ごとに分析すると同じ内容を 2 回生成して AI 利用枠を無駄に消費するため、
       * シンボルごとに 1 件だけを代表として分析する。
       */
      const bySymbol = new Map<string, (typeof hs)[number]>();
      for (const h of hs) {
        if (!bySymbol.has(h.symbol)) bySymbol.set(h.symbol, h);
      }
      const targets = Array.from(bySymbol.values());
      const total = targets.length;
      const batch = targets.slice(input.offset, input.offset + input.batchSize);

      let ok = 0;
      const failed: string[] = [];
      let quotaExhausted = false;

      for (const h of batch) {
        try {
          await regenerateSignal(ctx.user.id, h);
          ok += 1;
        } catch (error) {
          console.warn(`[portfolio] signal failed for ${h.symbol}:`, error);
          failed.push(h.symbol);
          // 利用枠切れは以降すべて失敗するため、残りを試さず即座に打ち切る。
          // 無駄な待ち時間をユーザーに負わせないための判断。
          if (isQuotaError(error)) {
            quotaExhausted = true;
            break;
          }
        }
      }

      // 利用枠切れなら後続バッチも失敗するので打ち切る
      const processed = input.offset + batch.length;
      const nextOffset = quotaExhausted || processed >= total ? null : processed;

      if (quotaExhausted && ok === 0 && input.offset === 0) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            "AI の利用枠を使い切ったため分析できませんでした。時間をおいてから再度お試しください（通常は数時間で回復します）。",
        });
      }

      return { ok, failed, quotaExhausted, total, processed, nextOffset } as const;
    }),

  generateMissingSignals: protectedProcedure
    .input(
      z
        .object({
          batchSize: z.number().int().min(1).max(6).default(4),
          retryFailed: z.boolean().default(false),
        })
        .default({ batchSize: 4, retryFailed: false })
    )
    .mutation(async ({ ctx, input }) => generateMissingSignalsBatch(ctx.user.id, input)),

  refreshStaleSignals: protectedProcedure
    .input(
      z
        .object({
          batchSize: z.number().int().min(1).max(6).default(2),
          retryFailed: z.boolean().default(false),
        })
        .default({ batchSize: 2, retryFailed: false })
    )
    .mutation(async ({ ctx, input }) => refreshStaleSignalsBatch(ctx.user.id, input)),

  generateMissingPriceBandPlans: protectedProcedure
    .input(
      z
        .object({
          batchSize: z.number().int().min(1).max(4).default(2),
          retryFailed: z.boolean().default(false),
        })
        .default({ batchSize: 2, retryFailed: false })
    )
    .mutation(async ({ ctx, input }) => generateMissingHoldingPlans(ctx.user.id, input)),

  runMissingBandChecks: protectedProcedure
    .input(
      z
        .object({
          batchSize: z.number().int().min(1).max(3).default(2),
          retryFailed: z.boolean().default(false),
        })
        .default({ batchSize: 2, retryFailed: false })
    )
    .mutation(async ({ ctx, input }) =>
      withSchedulerRunLog({
        userId: ctx.user.id,
        kind: "band_check_backfill",
        trigger: "MANUAL",
        run: () => runMissingBandChecksBatch(ctx.user.id, input),
        summarize: value => ({
          processed: value.processed,
          succeeded: value.checked,
          failed: value.failed.length,
          remaining: value.remaining,
          detail: {
            itemsChecked: value.itemsChecked,
            failedSymbols: value.failed,
            deferredSymbols: value.deferred,
            quotaExhausted: value.quotaExhausted,
          },
        }),
      })
    ),

  runNewsTriggeredBandChecks: protectedProcedure
    .input(z.object({ batchSize: z.number().int().min(1).max(3).default(2) }).default({ batchSize: 2 }))
    .mutation(async ({ ctx, input }) =>
      withSchedulerRunLog({
        userId: ctx.user.id,
        kind: "band_check_news_refresh",
        trigger: "MANUAL",
        run: () => runNewsTriggeredBandChecksBatch(ctx.user.id, input),
        summarize: value => ({
          processed: value.processed,
          succeeded: value.checked,
          failed: value.failed.length,
          remaining: value.remaining,
          detail: { itemsChecked: value.itemsChecked, failedSymbols: value.failed, quotaExhausted: value.quotaExhausted },
        }),
      })
    ),

  snapshots: protectedProcedure.query(async ({ ctx }) => db.listSnapshots(ctx.user.id)),

  /**
   * 資産推移グラフ用の集計。
   *
   * 集計を画面側に置くと、粒度の自動切替や「登録作業による増加か値動きか」の
   * 判定が画面ごとにばらつく。サーバーで確定させて 1 か所に集める。
   */
  assetTrend: protectedProcedure
    .input(z.object({ scale: z.enum(["day", "month"]).default("month") }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await db.listSnapshots(ctx.user.id, 400);
      const mapped: SnapshotInput[] = rows.map(r => ({
        totalValue: Number(r.totalValue),
        totalCost: Number(r.totalCost),
        positionCount: r.positionCount,
        borrowed: r.borrowed === null ? null : Number(r.borrowed),
        netAssets: r.netAssets === null ? null : Number(r.netAssets),
        capturedAt: r.capturedAt,
      }));
      const requested = input?.scale ?? "month";
      const { scale, fellBack } = resolveScale(mapped, requested);
      const trend = buildAssetTrend(mapped, scale);
      return { ...trend, scale, requestedScale: requested, fellBack } as const;
    }),

  signalHistory: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .query(async ({ ctx, input }) => db.signalHistory(ctx.user.id, input.symbol, 20)),

  /**
   * 買い増しプラン（価格帯ごとの行動）の取得。
   *
   * 現在値は保有一覧の合算ビューから取る。段の判定に使う価格は現地通貨。
   * 表示通貨に換算した価格で判定すると、実際に注文できない水準になってしまう。
   */
  priceBandPlan: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .query(async ({ ctx, input }) => {
      const portfolio = await buildPortfolio(ctx.user.id);
      const view = portfolio.groups.find(g => g.symbol === input.symbol);
      /*
       * 保有していない銘柄（ウォッチリスト）の場合、合算ビューに現在値がない。
       * その場合はウォッチリストに保存された現在値を使う。
       * ここで現在値を渡せないと「今どの段にいるか」の判定ができなくなる。
       */
      let currentPrice = view?.currentPrice ?? null;
      if (currentPrice === null) {
        const watch = await db.getWatchBySymbol(ctx.user.id, input.symbol);
        if (watch?.currentPrice) currentPrice = Number(watch.currentPrice);
      }
      return await getPlan(ctx.user.id, input.symbol, currentPrice);
    }),

  /** 買い増しプランを AI で生成する（1 銘柄） */
  generatePriceBandPlan: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateAndSavePlanForHolding(ctx.user.id, input.symbol);
      } catch (error) {
        throw toFriendlyAiError(error, "買い増しプランの生成に失敗しました");
      }
    }),

  /**
   * ウォッチリスト銘柄（未保有）の購入プランを AI で生成する。
   *
   * 保有銘柄と分けているのは基準が違うため。取得単価が無いので
   * 52週レンジ・配当利回り・フェアバリューを基準に段を作る。
   */
  generateWatchPricePlan: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateAndSavePlanForWatchItem(ctx.user.id, input.symbol);
      } catch (error) {
        throw toFriendlyAiError(error, "購入プランの生成に失敗しました");
      }
    }),

  /** 保有銘柄のプラン有無の一覧（一括生成の進捗確認に使う） */
  priceBandPlanStatus: protectedProcedure.query(async ({ ctx }) =>
    listPlanStatus(ctx.user.id)
  ),

  /**
   * 買い増しの是非を AI が結論付ける（1 銘柄）。
   *
   * 相談 AI と分けているのは、こちらは質問を待たずに出すものだから。
   * 金額は資産全体から機械的に算定した範囲に収める（AI に自由に
   * 決めさせると根拠のない額が出る）。
   */
  generateAddProposal: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateProposal(ctx.user.id, input.symbol);
      } catch (error) {
        throw toFriendlyAiError(error, "買い増し提案の生成に失敗しました");
      }
    }),

  /**
   * 判断が必要な銘柄をまとめて提案する。
   *
   * 112 銘柄すべてに走らせると 30 分以上かかるため、買い増しの段に
   * いる・懸念がある・次の段が近い銘柄だけに絞る。
   */
  generateAddProposalBatch: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(12).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      try {
        return await generateProposalBatch(ctx.user.id, input?.limit);
      } catch (error) {
        throw toFriendlyAiError(error, "買い増し提案の生成に失敗しました");
      }
    }),

  /** 提案の一覧（銘柄ごとに最新の 1 件） */
  addProposals: protectedProcedure.query(async ({ ctx }) => listProposals(ctx.user.id)),

  /**
   * 株価データの健全性。
   *
   * 自動更新は動いているが失敗した銘柄には気付けない。古い株価で
   * 買い増し圏を判定すると実際には圏外なのに「買い場」と出るため、
   * 古くなっている銘柄を自分から知らせる。
   */
  dataHealth: protectedProcedure.query(async ({ ctx }) => checkDataHealth(ctx.user.id)),

  /**
   * 銘柄メモ（出来事の記録）。
   *
   * ニュース・決算・判定変化・相談・提案の当否を 1 本の時系列にする。
   * 「この銘柄に何が起きてきたか」を後から辿れるようにするため。
   */
  symbolNotes: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .query(async ({ ctx, input }) => listSymbolNotes(ctx.user.id, input.symbol)),

  /** メモの件数（銘柄ごと）。保有一覧に印を出すため */
  noteCounts: protectedProcedure.query(async ({ ctx }) => {
    const map = await countNotesBySymbol(ctx.user.id);
    return Array.from(map.entries()).map(([symbol, count]) => ({ symbol, count }));
  }),

  /** 溜まっているデータからメモを積み直す（手動実行用） */
  syncSymbolNotes: protectedProcedure.mutation(async ({ ctx }) => syncSymbolNotes(ctx.user.id)),

  /**
   * 今カードが必要な銘柄だけ自動で下書きする。
   *
   * 買い増し圏に入った・決算が出た・重大ニュースが出た銘柄に絞る。
   * 112 銘柄を機械的に埋めるより、必要な瞬間にその時点の情報で
   * 作られた方が正確なため。
   */
  draftTriggeredCards: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(10).default(5) }).optional())
    .mutation(async ({ ctx, input }) => draftTriggeredCards(ctx.user.id, input?.limit ?? 5)),

  /** 1 銘柄の提案履歴。判断がいつ変わったかを追えるようにする */
  addProposalHistory: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .query(async ({ ctx, input }) => listProposalsForSymbol(ctx.user.id, input.symbol)),

  /**
   * 全銘柄の「今どの段にいるか」の一覧。
   *
   * 112 銘柄を 1 つずつ開いて確認するのは現実的でないため、
   * 買い増し圏に入っている銘柄と確認が必要な銘柄を横断で拾えるようにする。
   */
  priceBandOverview: protectedProcedure.query(async ({ ctx }) => {
    const [rows, status] = await Promise.all([
      listPlanOverview(ctx.user.id),
      listPlanStatus(ctx.user.id),
    ]);
    const pending = status.filter(item => !item.hasPlan);
    // 構成比が多いか少ないかを判断するには全体の分布が必要なので併せて返す
    return {
      rows,
      stats: computeOverviewStats(rows),
      coverage: {
        total: status.length,
        ready: status.length - pending.length,
        pending,
      },
    };
  }),

  /**
   * 価格帯の確認項目をニュースと照合する。
   *
   * 現在値がその帯の中にいないと実行できない（サービス層で弾く）。
   * 常に動かすと AI 利用枠を無駄に使い、まだ関係のない懸念で判断が濁るため。
   */
  runBandChecks: protectedProcedure
    .input(z.object({ bandId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await runChecksForBand(ctx.user.id, input.bandId);
      } catch (error) {
        throw toFriendlyAiError(error, "確認項目の照合に失敗しました");
      }
    }),

  /**
   * 価格帯を手で書き換える。
   *
   * AI の提案が自分の考えと違う場合に直せるようにする。
   * 段を直すと、その段に紐づく過去の照合結果はサービス層で削除される
   * （古い価格帯に対する判断が別の価格帯の材料として読まれるのを防ぐため）。
   */
  updatePriceBand: protectedProcedure
    .input(
      z.object({
        bandId: z.number().int().positive(),
        lowerPrice: z.number().min(0).nullable(),
        upperPrice: z.number().min(0).nullable(),
        action: z.enum(BAND_ACTIONS),
        actionLabel: z.string().min(1).max(120),
        reason: z.string().max(2000).nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateBand({
        userId: ctx.user.id,
        bandId: input.bandId,
        lowerPrice: input.lowerPrice,
        upperPrice: input.upperPrice,
        action: input.action,
        actionLabel: input.actionLabel,
        reason: input.reason,
      });
      return { success: true } as const;
    }),

  /**
   * 全銘柄のプランを生成する（1 リクエスト = 1 バッチ）。
   *
   * シグナル生成と同じ理由でバッチ分割する。本番のリクエスト上限が 180 秒で、
   * 1 銘柄あたり 10〜16 秒かかるため、一度に処理できるのは 6 件程度。
   */
  generateAllPriceBandPlans: protectedProcedure
    .input(
      z
        .object({
          offset: z.number().int().min(0).default(0),
          batchSize: z.number().int().min(1).max(10).default(6),
          /** すでにプランがある銘柄も作り直すか */
          force: z.boolean().default(false),
        })
        .default({ offset: 0, batchSize: 6, force: false })
    )
    .mutation(async ({ ctx, input }) => {
      const status = await listPlanStatus(ctx.user.id);
      const targets = input.force ? status : status.filter(s => !s.hasPlan);
      const total = targets.length;
      const batch = targets.slice(input.offset, input.offset + input.batchSize);

      let ok = 0;
      const failed: string[] = [];
      let quotaExhausted = false;

      for (const t of batch) {
        try {
          await generateAndSavePlanForHolding(ctx.user.id, t.symbol);
          ok += 1;
        } catch (error) {
          console.warn(`[portfolio] price band plan failed for ${t.symbol}:`, error);
          failed.push(t.symbol);
          if (isQuotaError(error)) {
            quotaExhausted = true;
            break;
          }
        }
      }

      const processed = input.offset + batch.length;
      const nextOffset = quotaExhausted || processed >= total ? null : processed;

      if (quotaExhausted && ok === 0 && input.offset === 0) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message:
            "AI の利用枠を使い切ったため生成できませんでした。時間をおいてから再度お試しください（通常は数時間で回復します）。",
        });
      }

      return { ok, failed, quotaExhausted, total, processed, nextOffset } as const;
    }),

  /** AI 実行履歴（いつ何をどう判断したかを後から追えるようにする） */
  aiRunHistory: protectedProcedure
    .input(
      z
        .object({
          kind: z.string().max(48).optional(),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      listAiRuns(ctx.user.id, { kind: input?.kind, limit: input?.limit ?? 50 })
    ),

  /**
   * 保有の偏りを起点に新規候補銘柄を提案する。
   *
   * 「今後有望な株を挙げて」と聞くと有名銘柄が並ぶだけになるため、
   * 出発点を自分のポートフォリオの数字に固定する。
   * AI が挙げた銘柄は実在検証（株価が取れるか）を通してから返す。
   */
  suggestCandidates: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      return await generateCandidateSuggestions(ctx.user.id);
    } catch (error) {
      throw toFriendlyAiError(error, "候補銘柄の提案に失敗しました");
    }
  }),

  /**
   * 提案された候補のうち選んだものをウォッチリストに取り込む。
   */
  addSuggestedToWatchlist: protectedProcedure
    .input(
      z.object({
        candidates: z
          .array(
            z.object({
              symbol: z.string().min(1).max(24),
              name: z.string().min(1).max(160),
              market: z.enum(["JP", "US", "SG", "HK", "OTHER"]),
              priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
              targetPrice: z.number().min(0).nullable(),
              reason: z.string().max(1000),
              concern: z.string().max(1000),
            })
          )
          .min(1)
          .max(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await addCandidatesToWatchlist(ctx.user.id, input.candidates);
      /*
       * 取り込んだ印を付ける。印がないと、次に提案一覧を開いたときに
       * 既にウォッチリストへ入れた銘柄が「未検討」として並んでしまう。
       * 印付けが失敗しても取り込み自体は成功しているので通す。
       */
      try {
        const added = input.candidates
          .map(c => c.symbol.trim().toUpperCase())
          .filter(s => !result.skipped.includes(s));
        await db.markCandidateAdded(ctx.user.id, added);
      } catch (e) {
        console.warn("[candidate] 取り込み印の記録に失敗:", e);
      }
      return result;
    }),

  /**
   * 保存済みの提案を返す。
   *
   * 生成には 40 秒前後かかるため、画面を開くたびに作り直すのではなく
   * 前回の結果を読めるようにする。月 1 回しか開かない使い方では、
   * 開いた瞬間に前回の提案が見えることの方が重要。
   */
  savedCandidates: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db.listCandidateSuggestions(ctx.user.id);
    return rows.map(r => ({
      symbol: r.symbol,
      name: r.name,
      market: r.market,
      track: r.track,
      basedOn: r.basedOn,
      gapKind: r.gapKind,
      reason: r.reason,
      concern: r.concern,
      priority: r.priority,
      priceAtSuggestion: r.priceAtSuggestion != null ? Number(r.priceAtSuggestion) : null,
      targetPrice: r.targetPrice != null ? Number(r.targetPrice) : null,
      targetBasis: r.targetBasis,
      currency: r.currency,
      sector: r.sector,
      industry: r.industry,
      addedToWatchlist: r.addedToWatchlist,
      dismissed: r.dismissed,
      createdAt: r.createdAt,
    }));
  }),

  /**
   * 提案を見送る。
   *
   * 削除ではなく印にするのは、次回の提案で同じ銘柄を避けるために
   * 記録が必要なため。消すと同じ銘柄が何度も出てくる。
   */
  dismissCandidate: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .mutation(async ({ ctx, input }) => {
      await db.dismissCandidate(ctx.user.id, input.symbol.trim().toUpperCase());
      return { ok: true };
    }),
});

export type PortfolioRouter = typeof portfolioRouter;
export { decimalString };
