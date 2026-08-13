import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { syncNewsForTargets, syncNewsForUser } from "../services/portfolio";

export const newsRouter = router({
  /** ニュース一覧（全銘柄 or 特定銘柄） */
  list: protectedProcedure
    .input(
      z
        .object({
          symbol: z.string().max(24).optional(),
          limit: z.number().int().min(1).max(200).default(80),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const items = await db.listNews(ctx.user.id, {
        symbol: input?.symbol,
        limit: input?.limit ?? 80,
      });
      const holdings = await db.listHoldings(ctx.user.id);
      const watch = await db.listWatchlist(ctx.user.id);
      const nameMap = new Map<string, string>();
      holdings.forEach(h => nameMap.set(h.symbol, h.name));
      watch.forEach(w => {
        if (!nameMap.has(w.symbol)) nameMap.set(w.symbol, w.name);
      });

      return items.map(it => ({ ...it, companyName: nameMap.get(it.symbol) ?? it.symbol }));
    }),

  /** 全銘柄のニュースを取得・分析 */
  syncAll: protectedProcedure.mutation(async ({ ctx }) => {
    return syncNewsForUser(ctx.user.id);
  }),

  /** 特定銘柄のニュースを取得・分析 */
  syncOne: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .mutation(async ({ ctx, input }) => {
      const holding = await db.getHoldingBySymbol(ctx.user.id, input.symbol);
      const watch = holding ? undefined : await db.getWatchBySymbol(ctx.user.id, input.symbol);
      const target = holding ?? watch;
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "銘柄が見つかりません" });

      return syncNewsForTargets(ctx.user.id, [
        {
          symbol: target.symbol,
          name: target.name,
          tickerCode: target.tickerCode,
          market: target.market,
        },
      ]);
    }),
});
