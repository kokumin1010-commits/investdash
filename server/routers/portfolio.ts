import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { fetchCompanyProfile, fetchPriceHistory, fetchQuote } from "../services/marketData";
import { isQuotaError, toFriendlyAiError } from "../services/aiErrors";
import { buildAssetTrend, resolveScale, type SnapshotInput } from "../services/assetTrend";
import {
  buildPortfolio,
  enrichProfiles,
  syncDividends,
  regenerateSignal,
  syncFxRate,
  syncPrices,
} from "../services/portfolio";
import { BROKERS, normalizeSymbol } from "../../shared/investing";

const decimalString = z.union([z.number(), z.string()]).transform(v => String(v));

export const portfolioRouter = router({
  /** ダッシュボード・一覧の統合データ */
  overview: protectedProcedure.query(async ({ ctx }) => {
    return buildPortfolio(ctx.user.id);
  }),

  settings: protectedProcedure.query(async ({ ctx }) => db.getSettings(ctx.user.id)),

  updateSettings: protectedProcedure
    .input(
      z.object({
        usdJpyRate: z.number().positive().optional(),
        sgdJpyRate: z.number().positive().optional(),
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
        concentrationThreshold: input.concentrationThreshold,
        sectorConcentrationThreshold: input.sectorConcentrationThreshold,
        cashBalance: input.cashBalance !== undefined ? String(input.cashBalance) : undefined,
        autoNewsEnabled: input.autoNewsEnabled,
        fxAutoUpdate: input.fxAutoUpdate,
        // 手動でレートを入れたときは、自動取得の時刻表示が実態と合わなくなるため消す
        ...(input.usdJpyRate !== undefined || input.sgdJpyRate !== undefined
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
    // どちらも取れなかった場合だけ失敗として扱う（片方でも取れれば前進している）
    if (rates.usdJpy === null && rates.sgdJpy === null) {
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

      return {
        holding,
        view,
        card: card ?? null,
        news,
        signalHistory: history,
        chart,
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
    return result;
  }),

  /** セクター情報の補完 */
  enrichProfiles: protectedProcedure
    .input(z.object({ force: z.boolean().default(false) }).optional())
    .mutation(async ({ ctx, input }) => {
      const count = await enrichProfiles(ctx.user.id, input?.force ?? false);
      return { count } as const;
    }),

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
});

export type PortfolioRouter = typeof portfolioRouter;
export { decimalString };
