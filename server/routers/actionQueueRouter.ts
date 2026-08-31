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
import { listSkippedActionReviews } from "../services/skipDecisionReviewService";

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

  skipReviews: protectedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(200).default(100) })
        .default({ limit: 100 })
    )
    .query(({ ctx, input }) => listSkippedActionReviews(ctx.user.id, input.limit)),

  skipReviewSummary: protectedProcedure.query(async ({ ctx }) => {
    const reviews = await listSkippedActionReviews(ctx.user.id, 200);
    return {
      total: reviews.length,
      open: reviews.filter(item => item.status === "OPEN").length,
      pendingMilestones: reviews.reduce(
        (count, item) =>
          count + item.milestones.filter(milestone => milestone.status === "PENDING").length,
        0
      ),
      completedMilestones: reviews.reduce(
        (count, item) =>
          count + item.milestones.filter(milestone => milestone.status === "COMPLETED").length,
        0
      ),
      needsProcessImprovement: reviews.filter(
        item => item.processQuality === "DISCIPLINE_NEEDS_IMPROVEMENT"
      ).length,
    };
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
