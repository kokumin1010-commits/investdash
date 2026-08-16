import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { BROKERS, normalizeSymbol } from "../../shared/investing";
import { fetchCompanyProfile, fetchQuote } from "../services/marketData";
import { regenerateWatchSignal } from "../services/portfolio";

export const watchlistRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const [items, signalMap, news] = await Promise.all([
      db.listWatchlist(ctx.user.id),
      db.latestSignals(ctx.user.id),
      db.listNews(ctx.user.id, { limit: 400 }),
    ]);

    const newsCount = new Map<string, number>();
    news.forEach(x => newsCount.set(x.symbol, (newsCount.get(x.symbol) ?? 0) + 1));

    return items.map(w => {
      const price = w.currentPrice ? Number(w.currentPrice) : null;
      const target = w.targetPrice ? Number(w.targetPrice) : null;
      const prev = w.previousClose ? Number(w.previousClose) : null;
      const sig = signalMap.get(w.symbol);
      return {
        ...w,
        priceNum: price,
        targetNum: target,
        /** 目標価格までの乖離率（負なら目標より安い＝条件に近い） */
        gapPct: price !== null && target !== null && target !== 0 ? ((price - target) / target) * 100 : null,
        reachedTarget: price !== null && target !== null ? price <= target : false,
        dayChangePct: price !== null && prev !== null && prev !== 0 ? ((price - prev) / prev) * 100 : null,
        signal: sig && sig.scope === "WATCHLIST"
          ? {
              action: sig.action,
              confidence: sig.confidence,
              rationale: sig.rationale,
              createdAt: sig.createdAt,
            }
          : null,
        newsCount: newsCount.get(w.symbol) ?? 0,
      };
    });
  }),

  add: protectedProcedure
    .input(
      z.object({
        code: z.string().min(1).max(24),
        name: z.string().max(160).optional(),
        targetPrice: z.number().min(0).nullable().optional(),
        buyConditions: z.string().max(4000).optional(),
        watchReason: z.string().max(4000).optional(),
        plannedAmount: z.number().min(0).nullable().optional(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { symbol, tickerCode, market } = normalizeSymbol(input.code);
      if (!symbol) throw new TRPCError({ code: "BAD_REQUEST", message: "銘柄コードが不正です" });

      const existing = await db.getWatchBySymbol(ctx.user.id, symbol);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: `${symbol} は既にウォッチリストにあります` });
      }

      const quote = await fetchQuote(symbol);
      if (!quote || quote.price === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${input.code} の相場情報が見つかりませんでした。コードをご確認ください。`,
        });
      }
      const profile = await fetchCompanyProfile(symbol);

      const id = await db.insertWatchItem({
        userId: ctx.user.id,
        symbol,
        tickerCode,
        name: input.name || quote.longName || quote.shortName || tickerCode,
        market,
        currency: quote.currency,
        currentPrice: String(quote.price),
        previousClose: quote.previousClose !== null ? String(quote.previousClose) : undefined,
        targetPrice:
          input.targetPrice === null || input.targetPrice === undefined
            ? null
            : String(input.targetPrice),
        buyConditions: input.buyConditions,
        watchReason: input.watchReason,
        plannedAmount:
          input.plannedAmount === null || input.plannedAmount === undefined
            ? null
            : String(input.plannedAmount),
        priority: input.priority,
        sector: profile?.sector ?? undefined,
        industry: profile?.industry ?? undefined,
        priceUpdatedAt: new Date(),
      });

      return { id, symbol } as const;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(160).optional(),
        targetPrice: z.number().min(0).nullable().optional(),
        buyConditions: z.string().max(4000).optional(),
        watchReason: z.string().max(4000).optional(),
        plannedAmount: z.number().min(0).nullable().optional(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const target = await db.getWatchItem(ctx.user.id, input.id);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });

      await db.updateWatchItem(ctx.user.id, input.id, {
        name: input.name,
        targetPrice:
          input.targetPrice === undefined
            ? undefined
            : input.targetPrice === null
              ? null
              : String(input.targetPrice),
        buyConditions: input.buyConditions,
        watchReason: input.watchReason,
        plannedAmount:
          input.plannedAmount === undefined
            ? undefined
            : input.plannedAmount === null
              ? null
              : String(input.plannedAmount),
        priority: input.priority,
      });
      return { success: true } as const;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const removed = await db.deleteWatchItem(ctx.user.id, input.id);
      if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });
      return { success: true } as const;
    }),

  /** ウォッチリスト銘柄を保有ポジションへ昇格 */
  promote: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        quantity: z.number().positive(),
        avgCost: z.number().min(0),
        broker: z.enum(BROKERS).optional(),
        keepInWatchlist: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const item = await db.getWatchItem(ctx.user.id, input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });

      // 同一銘柄でも証券口座が違えば別ポジションになるため、口座まで見て判定する
      const broker = input.broker ?? "other";
      const existing = await db.getHoldingBySymbolAndBroker(ctx.user.id, item.symbol, broker);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "この銘柄は同じ証券口座の保有一覧に既にあります",
        });
      }

      const holdingId = await db.insertHolding({
        userId: ctx.user.id,
        symbol: item.symbol,
        tickerCode: item.tickerCode,
        name: item.name,
        market: item.market,
        currency: item.currency,
        broker,
        quantity: String(input.quantity),
        avgCost: String(input.avgCost),
        currentPrice: item.currentPrice ?? undefined,
        previousClose: item.previousClose ?? undefined,
        sector: item.sector ?? undefined,
        industry: item.industry ?? undefined,
        priceUpdatedAt: new Date(),
      });

      // ウォッチリストの記録を投資カードへ引き継ぐ
      if (item.watchReason || item.buyConditions) {
        await db.upsertCard({
          userId: ctx.user.id,
          symbol: item.symbol,
          holdingId,
          buyReason: item.watchReason ?? undefined,
          coreThesis: item.buyConditions ?? undefined,
        });
      }

      if (!input.keepInWatchlist) {
        await db.deleteWatchItem(ctx.user.id, input.id);
      }

      return { holdingId } as const;
    }),

  regenerateSignal: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const item = await db.getWatchItem(ctx.user.id, input.id);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });
      return regenerateWatchSignal(ctx.user.id, item);
    }),
});
