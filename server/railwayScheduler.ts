import cron from "node-cron";
import * as db from "./db";
import { recordTransitions } from "./services/bandTransitionService";
import { syncNewsForUser, syncPrices } from "./services/portfolio";
import { syncSymbolNotes } from "./services/symbolNoteService";

const NEWS_BATCH_SIZE = 4;
const NEWS_BATCH_COUNT = 31;
const NEWS_START_UTC_MINUTES = 22 * 60;
const NEWS_INTERVAL_MINUTES = 5;

let priceRunActive = false;
let newsRunActive = false;

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
        console.log(
          `[Railway scheduler] ${trigger} user=${userId} updated=${result.updated} failed=${result.failed.length} transitions=${transitions.recorded} notes=${notes.added}`
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

export function startRailwayScheduler(): boolean {
  if (process.env.INVESTDASH_SCHEDULER_ENABLED !== "true") {
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

  console.log(
    "[Railway scheduler] enabled: prices 06:30/21:30 UTC weekdays; news 22:00-00:30 UTC daily"
  );
  return true;
}

export const RAILWAY_NEWS_SCHEDULE = {
  batchSize: NEWS_BATCH_SIZE,
  batchCount: NEWS_BATCH_COUNT,
  startUtcMinutes: NEWS_START_UTC_MINUTES,
  intervalMinutes: NEWS_INTERVAL_MINUTES,
};
