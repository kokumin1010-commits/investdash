/**
 * 相談 AI の API。
 *
 * 相談は AI 呼び出しを含むため 20 秒前後かかる。本番のリクエスト上限は
 * 180 秒なので 1 回の質問であれば収まる。
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  ask,
  deleteConsultation,
  getConsultation,
  listConsultations,
  listConsultationsBySymbol,
  listSymbolConsultStats,
} from "../services/consultService";
import { applyConsultToCard } from "../services/cardService";

export const consultRouter = router({
  /** 相談の履歴一覧 */
  list: protectedProcedure.query(async ({ ctx }) => {
    return await listConsultations(ctx.user.id);
  }),

  /**
   * 銘柄ごとの相談の状況。
   *
   * 保有一覧で「前に相談した銘柄」に印を出すために使う。
   * Map は tRPC を通せないので配列にして返す。
   */
  symbolStats: protectedProcedure.query(async ({ ctx }) => {
    const stats = await listSymbolConsultStats(ctx.user.id);
    return Array.from(stats.values());
  }),

  /** 特定の銘柄の相談だけを返す（銘柄詳細で使う） */
  bySymbol: protectedProcedure
    .input(z.object({ symbol: z.string().min(1).max(24) }))
    .query(async ({ ctx, input }) => {
      return await listConsultationsBySymbol(ctx.user.id, input.symbol);
    }),

  /** 1 件の相談を開く（続きを聞くために全発言を返す） */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return await getConsultation(ctx.user.id, input.id);
    }),

  /**
   * 質問する。
   * consultationId を渡すと既存の会話の続きとして扱う。
   */
  ask: protectedProcedure
    .input(
      z.object({
        question: z.string().min(1).max(2000),
        consultationId: z.number().int().positive().nullish(),
        symbol: z.string().max(24).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await ask({
        userId: ctx.user.id,
        question: input.question,
        consultationId: input.consultationId ?? null,
        symbol: input.symbol ?? null,
      });
    }),

  /**
   * 相談の内容を投資カードに書き戻す。
   *
   * 既定は追記。上書きにすると手で書いた内容が消えるため、
   * 明示的に選んだときだけ置き換える。
   */
  applyToCard: protectedProcedure
    .input(
      z.object({
        consultationId: z.number().int().positive(),
        mode: z.enum(["append", "overwrite"]).default("append"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await applyConsultToCard({
        userId: ctx.user.id,
        consultationId: input.consultationId,
        mode: input.mode,
      });
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await deleteConsultation(ctx.user.id, input.id);
      return { ok: true };
    }),
});
