import { and, desc, eq, gte, lte } from "drizzle-orm";
import { schedulerRunLogs, type SchedulerRunLog } from "../../drizzle/schema";
import { getDb, readInsertId } from "../db";

export type SchedulerRunTrigger = "SCHEDULED" | "MANUAL" | "STARTUP";
export type SchedulerRunStatus =
  | "RUNNING"
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED";

export type SchedulerRunSummary = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped?: number;
  remaining?: number | null;
  detail?: Record<string, unknown> | null;
  status?: Exclude<SchedulerRunStatus, "RUNNING" | "FAILED">;
};

export function resolveSchedulerRunStatus(
  summary: SchedulerRunSummary
): Exclude<SchedulerRunStatus, "RUNNING"> {
  return (
    summary.status ??
    (summary.failed > 0
      ? summary.succeeded > 0
        ? "PARTIAL"
        : "FAILED"
      : summary.processed === 0
        ? "SKIPPED"
        : "SUCCESS")
  );
}

async function startSchedulerRun(params: {
  userId: number;
  kind: string;
  trigger: SchedulerRunTrigger;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(schedulerRunLogs).values({
    userId: params.userId,
    kind: params.kind,
    trigger: params.trigger,
    status: "RUNNING",
  });
  return readInsertId(result, "schedulerRunLogs");
}

async function finishSchedulerRun(
  id: number | null,
  values: Omit<SchedulerRunSummary, "status"> & {
    status: Exclude<SchedulerRunStatus, "RUNNING">;
    errorMessage?: string | null;
  }
): Promise<void> {
  if (id === null) return;
  const db = await getDb();
  if (!db) return;
  await db
    .update(schedulerRunLogs)
    .set({
      status: values.status,
      processed: values.processed,
      succeeded: values.succeeded,
      failed: values.failed,
      skipped: values.skipped ?? 0,
      remaining: values.remaining ?? null,
      detailJson: values.detail ?? null,
      errorMessage: values.errorMessage?.slice(0, 4000) ?? null,
      finishedAt: new Date(),
    })
    .where(eq(schedulerRunLogs.id, id));
}

export async function withSchedulerRunLog<T>(params: {
  userId: number;
  kind: string;
  trigger: SchedulerRunTrigger;
  run: () => Promise<T>;
  summarize: (result: T) => SchedulerRunSummary;
}): Promise<T> {
  const id = await startSchedulerRun(params);
  try {
    const result = await params.run();
    const summary = params.summarize(result);
    const status = resolveSchedulerRunStatus(summary);
    await finishSchedulerRun(id, { ...summary, status });
    return result;
  } catch (error) {
    await finishSchedulerRun(id, {
      status: "FAILED",
      processed: 0,
      succeeded: 0,
      failed: 1,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function listSchedulerRuns(
  userId: number,
  options: {
    kind?: string;
    status?: SchedulerRunStatus;
    trigger?: SchedulerRunTrigger;
    from?: Date;
    to?: Date;
    limit?: number;
  } = {}
): Promise<SchedulerRunLog[]> {
  const db = await getDb();
  if (!db) return [];
  const filters = [eq(schedulerRunLogs.userId, userId)];
  if (options.kind) filters.push(eq(schedulerRunLogs.kind, options.kind));
  if (options.status) filters.push(eq(schedulerRunLogs.status, options.status));
  if (options.trigger)
    filters.push(eq(schedulerRunLogs.trigger, options.trigger));
  if (options.from) filters.push(gte(schedulerRunLogs.startedAt, options.from));
  if (options.to) filters.push(lte(schedulerRunLogs.startedAt, options.to));
  return db
    .select()
    .from(schedulerRunLogs)
    .where(and(...filters))
    .orderBy(desc(schedulerRunLogs.startedAt))
    .limit(Math.min(300, Math.max(1, options.limit ?? 100)));
}

export const SCHEDULER_RUN_KINDS = [
  "price_sync_jp",
  "price_sync_us",
  "news_sync",
  "profile_backfill",
  "signal_backfill",
  "price_band_plan_backfill",
  "investment_card_backfill",
  "band_check_backfill",
  "review_reminder",
  "skip_decision_review",
  "monthly_snapshot",
] as const;
