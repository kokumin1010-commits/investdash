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
} from "../services/consultService";

export const consultRouter = router({
  /** 相談の履歴一覧 */
  list: protectedProcedure.query(async ({ ctx }) => {
    return await listConsultations(ctx.user.id);
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

  remove: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await deleteConsultation(ctx.user.id, input.id);
      return { ok: true };
    }),
});
