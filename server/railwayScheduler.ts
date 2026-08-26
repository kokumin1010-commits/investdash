import cron from "node-cron";
import * as db from "./db";
import { recordTransitions } from "./services/bandTransitionService";
import { saveMonthlySnapshot } from "./services/monthlySnapshotService";
import {
  generateMissingHoldingPlans,
  runMissingBandChecksBatch,
} from "./services/priceBandService";
import { draftMissingCards } from "./services/cardService";
import { withSchedulerRunLog } from "./services/schedulerRunLog";
import {
  enrichProfileBatch,
  generateMissingSignalsBatch,
  syncNewsForUser,
  syncPrices,
} from "./services/portfolio";
import { syncSymbolNotes } from "./services/symbolNoteService";

const NEWS_BATCH_SIZE = 4;
const NEWS_BATCH_COUNT = 31;
const NEWS_START_UTC_MINUTES = 22 * 60;
const NEWS_INTERVAL_MINUTES = 5;

let priceRunActive = false;
let newsRunActive = false;
let backfillRunActive = false;
const profileOffsets = new Map<number, number>();
export const RAILWAY_DATA_BACKFILL_CRON = "0,20,40 1-21 * * *";

type RailwayBackfillUserSummary = {
  userId: number;
  profilesUpdated: number;
  profileFailed: number;
  signalsGenerated: number;
  signalRemaining: number;
  plansGenerated: number | null;
  planRemaining: number | null;
  cardsCreated: number | null;
  cardRemaining: number | null;
  bandsChecked: number | null;
  bandCheckRemaining: number | null;
  error?: string;
};

let lastBackfillRun:
  | {
      startedAt: string;
      finishedAt: string;
      users: RailwayBackfillUserSummary[];
    }
  | null = null;

/**
 * node-cron 不会等待异步回调。任务若在自身 try/catch 之前失败，裸 `void task()`
 * 会留下未捕获 rejection。所有 cron 入口统一在这里吞住异常并记录日志，让 HTTP
 * 服务继续运行并等待下一轮，而不是因一次数据库或外部 API 瞬时故障退出。
 */
export async function runRailwayScheduledTaskSafely(
  label: string,
  task: () => Promise<unknown>
): Promise<void> {
  try {
    await task();
  } catch (error) {
    console.error(`[Railway scheduler] ${label} failed outside task boundary:`, error);
  }
}

export function getRailwayDataBackfillStatus() {
  return {
    cron: RAILWAY_DATA_BACKFILL_CRON,
    running: backfillRunActive,
    lastRun: lastBackfillRun,
  };
}

export function getNewsBatchForUtcDate(now: Date): number | null {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const elapsed =
    utcMinutes >= NEWS_START_UTC_MINUTES
      ? utcMinutes - NEWS_START_UTC_MINUTES
      : utcMinutes + 24 * 60 - NEWS_START_UTC_MINUTES;

  if (elapsed < 0 || elapsed % NEWS_INTERVAL_MINUTES !== 0) return null;
  const batch = elapsed / NEWS_INTERVAL_MINUTES;
  return batch >= 0 && batch < NEWS_BATCH_COUNT ? batch : null;
}

export async function runRailwayPriceSync(trigger: "jp-close" | "us-close") {
  if (priceRunActive) {
    console.warn(`[Railway scheduler] price sync ${trigger} skipped: previous run active`);
    return;
  }
  priceRunActive = true;
  try {
    const userIds = await db.listAllUserIds();
    for (const userId of userIds) {
      try {
        const { result, transitions, notes, monthly } = await withSchedulerRunLog({
          userId,
          kind: trigger === "jp-close" ? "price_sync_jp" : "price_sync_us",
          trigger: "SCHEDULED",
          run: async () => {
            const result = await syncPrices(userId);
            const transitions = await recordTransitions(userId).catch(error => {
              console.error(`[Railway scheduler] transition sync failed for ${userId}:`, error);
              return { recorded: 0 };
            });
            const notes = await syncSymbolNotes(userId).catch(error => {
              console.error(`[Railway scheduler] note sync failed for ${userId}:`, error);
              return { added: 0 };
            });
            const monthly =
              trigger === "us-close"
                ? await saveMonthlySnapshot(userId, {
                    source: "scheduled_price_sync",
                    note: "Railway の米国市場終値同期で当月記録を更新",
                  }).catch(error => {
                    console.error(`[Railway scheduler] monthly snapshot failed for ${userId}:`, error);
                    return null;
                  })
                : null;
            return { result, transitions, notes, monthly };
          },
          summarize: value => ({
            processed: value.result.updated + value.result.failed.length,
            succeeded: value.result.updated,
            failed: value.result.failed.length,
            detail: {
              failedSymbols: value.result.failed,
              transitions: value.transitions.recorded,
              notes: value.notes.added,
              monthlyPeriod: value.monthly?.periodYm ?? null,
            },
          }),
        });
        console.log(
          `[Railway scheduler] ${trigger} user=${userId} updated=${result.updated} failed=${result.failed.length} transitions=${transitions.recorded} notes=${notes.added} monthly=${monthly ? monthly.periodYm : "skipped"}`
        );
      } catch (error) {
        console.error(`[Railway scheduler] ${trigger} user=${userId} failed:`, error);
      }
    }
  } finally {
    priceRunActive = false;
  }
}

export async function runRailwayNewsBatch(batch: number) {
  if (!Number.isInteger(batch) || batch < 0 || batch >= NEWS_BATCH_COUNT) {
    throw new Error(`Invalid Railway news batch: ${batch}`);
  }
  if (newsRunActive) {
    console.warn(`[Railway scheduler] news batch ${batch} skipped: previous run active`);
    return;
  }
  newsRunActive = true;
  const offset = batch * NEWS_BATCH_SIZE;
  try {
    const userIds = await db.listAllUserIds();
    for (const userId of userIds) {
      try {
        const settings = await db.getSettings(userId);
        if (!settings.autoNewsEnabled) continue;

        const result = await withSchedulerRunLog({
          userId,
          kind: "news_sync",
          trigger: "SCHEDULED",
          run: () =>
            syncNewsForUser(userId, {
              offset,
              batchSize: NEWS_BATCH_SIZE,
            }),
          summarize: value => ({
            processed: NEWS_BATCH_SIZE,
            succeeded: value.fetched,
            failed: value.analysisUnavailable ? 1 : 0,
            detail: {
              batch,
              offset,
              fetched: value.fetched,
              analyzed: value.analyzed,
              analysisUnavailable: value.analysisUnavailable,
            },
          }),
        });
        await db.pruneOldNews(userId, 90);
        await syncSymbolNotes(userId).catch(error => {
          console.error(`[Railway scheduler] news note sync failed for ${userId}:`, error);
        });
        console.log(
          `[Railway scheduler] news batch=${batch} user=${userId} fetched=${result.fetched} analyzed=${result.analyzed} unavailable=${result.analysisUnavailable}`
        );
      } catch (error) {
        console.error(`[Railway scheduler] news batch=${batch} user=${userId} failed:`, error);
      }
    }
  } finally {
    newsRunActive = false;
  }
}

/**
 * 再構築直後に不足している企業情報・判断・価格帯を少量ずつ埋める。
 * 欠損だけが対象なので、完了後は no-op となり既存判断や編集済みプランを上書きしない。
 */
export async function runRailwayDataBackfill() {
  if (backfillRunActive || priceRunActive || newsRunActive) {
    console.warn("[Railway scheduler] data backfill skipped: another run active");
    return;
  }
  backfillRunActive = true;
  const startedAt = new Date().toISOString();
  const summaries: RailwayBackfillUserSummary[] = [];
  try {
    const userIds = await db.listAllUserIds();
    for (const userId of userIds) {
      try {
        const offset = profileOffsets.get(userId) ?? 0;
        const profiles = await withSchedulerRunLog({
          userId,
          kind: "profile_backfill",
          trigger: "SCHEDULED",
          run: () => enrichProfileBatch(userId, { offset, batchSize: 10 }),
          summarize: value => ({
            processed: value.processed,
            succeeded: value.updated,
            failed: value.failed.length,
            skipped: value.skipped,
            remaining: value.nextOffset === null ? 0 : Math.max(0, value.total - value.nextOffset),
            detail: { failedSymbols: value.failed, nextOffset: value.nextOffset },
          }),
        });
        profileOffsets.set(userId, profiles.nextOffset ?? 0);

        const signals = await withSchedulerRunLog({
          userId,
          kind: "signal_backfill",
          trigger: "SCHEDULED",
          run: () =>
            generateMissingSignalsBatch(userId, {
              batchSize: 4,
              retryFailed: false,
            }),
          summarize: value => ({
            processed: value.processed,
            succeeded: value.generated,
            failed: value.failed.length,
            remaining: value.remaining,
            detail: {
              failedSymbols: value.failed,
              quotaExhausted: value.quotaExhausted,
            },
          }),
        });
        const plans = signals.quotaExhausted
          ? null
          : await withSchedulerRunLog({
              userId,
              kind: "price_band_plan_backfill",
              trigger: "SCHEDULED",
              run: () =>
                generateMissingHoldingPlans(userId, {
                  batchSize: 2,
                  retryFailed: false,
                }),
              summarize: value => ({
                processed: value.processed,
                succeeded: value.generated,
                failed: value.failed.length,
                remaining: value.remaining,
                detail: {
                  failedSymbols: value.failed,
                  quotaExhausted: value.quotaExhausted,
                },
              }),
            });
        const cards =
          signals.quotaExhausted || plans?.quotaExhausted
            ? null
            : await withSchedulerRunLog({
                userId,
                kind: "investment_card_backfill",
                trigger: "SCHEDULED",
                run: () => draftMissingCards(userId, { batchSize: 2, retryFailed: false }),
                summarize: value => ({
                  processed: value.processed,
                  succeeded: value.created,
                  failed: value.failed.length,
                  skipped: value.skipped,
                  remaining: value.remaining,
                  detail: {
                    failedSymbols: value.failed,
                    deferredSymbols: value.deferred,
                    quotaExhausted: value.quotaExhausted,
                  },
                }),
              });
        const bandChecks =
          signals.quotaExhausted || plans?.quotaExhausted || cards?.quotaExhausted
            ? null
            : await withSchedulerRunLog({
                userId,
                kind: "band_check_backfill",
                trigger: "SCHEDULED",
                run: () => runMissingBandChecksBatch(userId, { batchSize: 2, retryFailed: false }),
                summarize: value => ({
                  processed: value.processed,
                  succeeded: value.checked,
                  failed: value.failed.length,
                  remaining: value.remaining,
                  detail: {
                    itemsChecked: value.itemsChecked,
                    failedSymbols: value.failed,
                    deferredSymbols: value.deferred,
                    quotaExhausted: value.quotaExhausted,
                  },
                }),
              });

        console.log(
          `[Railway scheduler] backfill user=${userId} profiles=${profiles.updated}/${profiles.processed} profileFailed=${profiles.failed.length} signals=${signals.generated}/${signals.processed} signalRemaining=${signals.remaining} plans=${plans ? `${plans.generated}/${plans.processed}` : "quota-skipped"} planRemaining=${plans?.remaining ?? "unknown"} cards=${cards ? `${cards.created}/${cards.processed}` : "quota-skipped"} cardRemaining=${cards?.remaining ?? "unknown"} bandChecks=${bandChecks ? `${bandChecks.checked}/${bandChecks.processed}` : "quota-skipped"} bandCheckRemaining=${bandChecks?.remaining ?? "unknown"}`
        );
        summaries.push({
          userId,
          profilesUpdated: profiles.updated,
          profileFailed: profiles.failed.length,
          signalsGenerated: signals.generated,
          signalRemaining: signals.remaining,
          plansGenerated: plans?.generated ?? null,
          planRemaining: plans?.remaining ?? null,
          cardsCreated: cards?.created ?? null,
          cardRemaining: cards?.remaining ?? null,
          bandsChecked: bandChecks?.checked ?? null,
          bandCheckRemaining: bandChecks?.remaining ?? null,
        });
      } catch (error) {
        console.error(`[Railway scheduler] data backfill user=${userId} failed:`, error);
        summaries.push({
          userId,
          profilesUpdated: 0,
          profileFailed: 0,
          signalsGenerated: 0,
          signalRemaining: -1,
          plansGenerated: null,
          planRemaining: null,
          cardsCreated: null,
          cardRemaining: null,
          bandsChecked: null,
          bandCheckRemaining: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    lastBackfillRun = {
      startedAt,
      finishedAt: new Date().toISOString(),
      users: summaries,
    };
    backfillRunActive = false;
  }
}

function scheduleNewsBatchWindow(expression: string) {
  cron.schedule(
    expression,
    () => {
      const batch = getNewsBatchForUtcDate(new Date());
      if (batch !== null) {
        void runRailwayScheduledTaskSafely(`news batch ${batch}`, () =>
          runRailwayNewsBatch(batch)
        );
      }
    },
    { timezone: "UTC", noOverlap: true }
  );
}

export function shouldStartRailwayScheduler(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env.INVESTDASH_SCHEDULER_ENABLED === "true" ||
    Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID)
  );
}

export function startRailwayScheduler(): boolean {
  if (!shouldStartRailwayScheduler()) {
    console.log("[Railway scheduler] disabled");
    return false;
  }

  cron.schedule(
    "30 6 * * 1-5",
    () =>
      void runRailwayScheduledTaskSafely("price sync jp-close", () =>
        runRailwayPriceSync("jp-close")
      ),
    { timezone: "UTC", noOverlap: true }
  );
  cron.schedule(
    "30 21 * * 1-5",
    () =>
      void runRailwayScheduledTaskSafely("price sync us-close", () =>
        runRailwayPriceSync("us-close")
      ),
    { timezone: "UTC", noOverlap: true }
  );
  scheduleNewsBatchWindow("*/5 22-23 * * *");
  scheduleNewsBatchWindow("0-30/5 0 * * *");
  cron.schedule(
    RAILWAY_DATA_BACKFILL_CRON,
    () =>
      void runRailwayScheduledTaskSafely("data backfill", () =>
        runRailwayDataBackfill()
      ),
    { timezone: "UTC", noOverlap: true }
  );

  console.log(
    "[Railway scheduler] enabled: prices 06:30/21:30 UTC weekdays; news 22:00-00:30 UTC daily; data backfill every 20m 01:00-21:40 UTC"
  );
  return true;
}

export const RAILWAY_NEWS_SCHEDULE = {
  batchSize: NEWS_BATCH_SIZE,
  batchCount: NEWS_BATCH_COUNT,
  startUtcMinutes: NEWS_START_UTC_MINUTES,
  intervalMinutes: NEWS_INTERVAL_MINUTES,
};
