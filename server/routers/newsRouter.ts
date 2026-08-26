import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { syncNewsForTargets, syncNewsForUser } from "../services/portfolio";

export const newsRouter = router({
  /** 112 個の去重持仓に対する正確なニュース件数・最新日・鮮度。 */
  coverage: protectedProcedure.query(async ({ ctx }) => {
    const [holdings, rows] = await Promise.all([
      db.listHoldings(ctx.user.id),
      db.listNewsCoverage(ctx.user.id),
    ]);
    const rowMap = new Map(rows.map(row => [row.symbol, row]));
    const unique = new Map(holdings.map(h => [h.symbol, h]));
    const staleBefore = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const items = Array.from(unique.values()).map(holding => {
      const row = rowMap.get(holding.symbol);
      const latestPublishedAt = row?.latestPublishedAt ? new Date(row.latestPublishedAt) : null;
      const count = Number(row?.count ?? 0);
      const status = count === 0 ? "MISSING" : !latestPublishedAt || latestPublishedAt.getTime() < staleBefore ? "STALE" : "FRESH";
      return { symbol: holding.symbol, name: holding.name, market: holding.market, count, latestPublishedAt, status };
    });
    return {
      total: items.length,
      covered: items.filter(item => item.count > 0).length,
      missing: items.filter(item => item.status === "MISSING").length,
      stale: items.filter(item => item.status === "STALE").length,
      fresh: items.filter(item => item.status === "FRESH").length,
      items,
    } as const;
  }),

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

  /**
   * 全銘柄のニュースを取得・分析する（1 リクエスト = 1 バッチ）。
   * 本番の 180 秒制限に収めるため分割実行する。1 銘柄あたり約 28 秒
   * （検索 + AI 分析）なので batchSize=4 なら最悪 112 秒程度。
   */
  syncAll: protectedProcedure
    .input(
      z
        .object({
          offset: z.number().int().min(0).default(0),
          batchSize: z.number().int().min(1).max(8).default(4),
        })
        .default({ offset: 0, batchSize: 4 })
    )
    .mutation(async ({ ctx, input }) => {
      return syncNewsForUser(ctx.user.id, {
        offset: input.offset,
        batchSize: input.batchSize,
      });
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
