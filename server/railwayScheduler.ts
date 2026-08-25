import cron from "node-cron";
import * as db from "./db";
import { recordTransitions } from "./services/bandTransitionService";
import { saveMonthlySnapshot } from "./services/monthlySnapshotService";
import { generateMissingHoldingPlans } from "./services/priceBandService";
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

        const result = await syncNewsForUser(userId, {
          offset,
          batchSize: NEWS_BATCH_SIZE,
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
  try {
    const userIds = await db.listAllUserIds();
    for (const userId of userIds) {
      try {
        const offset = profileOffsets.get(userId) ?? 0;
        const profiles = await enrichProfileBatch(userId, { offset, batchSize: 10 });
        profileOffsets.set(userId, profiles.nextOffset ?? 0);

        const signals = await generateMissingSignalsBatch(userId, {
          batchSize: 4,
          retryFailed: false,
        });
        const plans = signals.quotaExhausted
          ? null
          : await generateMissingHoldingPlans(userId, {
              batchSize: 2,
              retryFailed: false,
            });

        console.log(
          `[Railway scheduler] backfill user=${userId} profiles=${profiles.updated}/${profiles.processed} profileFailed=${profiles.failed.length} signals=${signals.generated}/${signals.processed} signalRemaining=${signals.remaining} plans=${plans ? `${plans.generated}/${plans.processed}` : "quota-skipped"} planRemaining=${plans?.remaining ?? "unknown"}`
        );
      } catch (error) {
        console.error(`[Railway scheduler] data backfill user=${userId} failed:`, error);
      }
    }
  } finally {
    backfillRunActive = false;
  }
}

function scheduleNewsBatchWindow(expression: string) {
  cron.schedule(
    expression,
    () => {
      const batch = getNewsBatchForUtcDate(new Date());
      if (batch !== null) void runRailwayNewsBatch(batch);
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

  cron.schedule("30 6 * * 1-5", () => void runRailwayPriceSync("jp-close"), {
    timezone: "UTC",
    noOverlap: true,
  });
  cron.schedule("30 21 * * 1-5", () => void runRailwayPriceSync("us-close"), {
    timezone: "UTC",
    noOverlap: true,
  });
  scheduleNewsBatchWindow("*/5 22-23 * * *");
  scheduleNewsBatchWindow("0-30/5 0 * * *");
  cron.schedule(RAILWAY_DATA_BACKFILL_CRON, () => void runRailwayDataBackfill(), {
    timezone: "UTC",
    noOverlap: true,
  });

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
