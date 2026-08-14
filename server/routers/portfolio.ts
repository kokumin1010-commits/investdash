import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { fetchCompanyProfile, fetchPriceHistory, fetchQuote } from "../services/marketData";
import {
  buildPortfolio,
  enrichProfiles,
  regenerateSignal,
  syncPrices,
} from "../services/portfolio";
import { normalizeSymbol } from "../../shared/investing";

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
        concentrationThreshold: z.number().int().min(1).max(100).optional(),
        sectorConcentrationThreshold: z.number().int().min(1).max(100).optional(),
        cashBalance: z.number().min(0).optional(),
        autoNewsEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return db.updateSettings(ctx.user.id, {
        usdJpyRate: input.usdJpyRate !== undefined ? String(input.usdJpyRate) : undefined,
        concentrationThreshold: input.concentrationThreshold,
        sectorConcentrationThreshold: input.sectorConcentrationThreshold,
        cashBalance: input.cashBalance !== undefined ? String(input.cashBalance) : undefined,
        autoNewsEnabled: input.autoNewsEnabled,
      });
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
        broker: z.enum(["moomoo_jp", "rakuten_ispeed", "futu", "other"]).optional(),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { symbol, tickerCode, market } = normalizeSymbol(input.code);
      if (!symbol) throw new TRPCError({ code: "BAD_REQUEST", message: "銘柄コードが不正です" });

      const existing = await db.getHoldingBySymbol(ctx.user.id, symbol);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${symbol} は既に登録されています。保有一覧から編集してください。`,
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
        broker: input.broker ?? "other",
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
        broker: z.enum(["moomoo_jp", "rakuten_ispeed", "futu", "other"]).optional(),
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

  /** シグナル再生成（1 銘柄） */
  regenerateSignal: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const holding = await db.getHolding(ctx.user.id, input.id);
      if (!holding) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });
      return regenerateSignal(ctx.user.id, holding);
    }),

  /** 全銘柄のシグナルを順次再生成 */
  regenerateAllSignals: protectedProcedure.mutation(async ({ ctx }) => {
    const hs = await db.listHoldings(ctx.user.id);
    let ok = 0;
    const failed: string[] = [];
    for (const h of hs) {
      try {
        await regenerateSignal(ctx.user.id, h);
        ok += 1;
      } catch (error) {
        console.warn(`[portfolio] signal failed for ${h.symbol}:`, error);
        failed.push(h.symbol);
      }
    }
    return { ok, failed } as const;
  }),

  snapshots: protectedProcedure.query(async ({ ctx }) => db.listSnapshots(ctx.user.id)),

  signalHistory: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .query(async ({ ctx, input }) => db.signalHistory(ctx.user.id, input.symbol, 20)),
});

export type PortfolioRouter = typeof portfolioRouter;
export { decimalString };
