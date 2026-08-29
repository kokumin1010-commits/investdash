import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  actionQueueSummary,
  decideActionQueueItem,
  listActionQueue,
  reconcileApprovedActionQueue,
  wakeSnoozedActionQueue,
} from "../services/actionQueueService";
import { backfillInitialActionQueue } from "../services/portfolio";

const viewSchema = z.enum(["ACTIVE", "PENDING", "APPROVED", "HISTORY", "ALL"]);
const decisionSchema = z.enum([
  "APPROVE",
  "SNOOZE",
  "SKIP",
  "COMPLETE",
  "RETRY",
]);

export const actionQueueRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          view: viewSchema.default("ACTIVE"),
          limit: z.number().int().min(1).max(200).default(100),
        })
        .default({ view: "ACTIVE", limit: 100 })
    )
    .query(async ({ ctx, input }) => {
      await wakeSnoozedActionQueue(ctx.user.id);
      return listActionQueue(ctx.user.id, input);
    }),

  summary: protectedProcedure.query(async ({ ctx }) => {
    await wakeSnoozedActionQueue(ctx.user.id);
    return actionQueueSummary(ctx.user.id);
  }),

  decide: protectedProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        decision: decisionSchema,
        snoozeDays: z
          .union([z.literal(1), z.literal(3), z.literal(7)])
          .optional(),
        note: z.string().trim().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await decideActionQueueItem({ userId: ctx.user.id, ...input });
      } catch (error) {
        throw new TRPCError({
          code:
            error instanceof Error && error.message.includes("見つかり")
              ? "NOT_FOUND"
              : "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "操作を完了できませんでした",
        });
      }
    }),

  backfillInitial: protectedProcedure.mutation(async ({ ctx }) =>
    backfillInitialActionQueue(ctx.user.id)
  ),

  reconcileExecutions: protectedProcedure.mutation(async ({ ctx }) =>
    reconcileApprovedActionQueue(ctx.user.id)
  ),
});
