import { describe, expect, it, vi } from "vitest";
import {
  getNewsBatchForUtcDate,
  RAILWAY_NEWS_SCHEDULE,
  RAILWAY_DATA_BACKFILL_CRON,
  RAILWAY_REVIEW_REMINDER_CRON,
  DATA_BACKFILL_STAGE_ORDER,
  canRunStaleSignalRefresh,
  summarizeDividendBackfill,
  summarizeStaleSignalRefresh,
  runDividendAndSignalStages,
  runRailwayScheduledTaskSafely,
  shouldStartRailwayScheduler,
} from "./railwayScheduler";

describe("Railway news schedule", () => {
  it.each([
    ["2026-08-25T22:00:00.000Z", 0],
    ["2026-08-25T23:55:00.000Z", 23],
    ["2026-08-26T00:00:00.000Z", 24],
    ["2026-08-26T00:30:00.000Z", 30],
    ["2026-08-26T00:35:00.000Z", null],
    ["2026-08-25T21:55:00.000Z", null],
  ])("maps %s to batch %s", (iso, expected) => {
    expect(getNewsBatchForUtcDate(new Date(iso))).toBe(expected);
  });

  it("covers all 123 symbols with 31 batches of four", () => {
    expect(RAILWAY_NEWS_SCHEDULE).toMatchObject({
      batchSize: 4,
      batchCount: 31,
      intervalMinutes: 5,
    });
    expect(
      RAILWAY_NEWS_SCHEDULE.batchSize * RAILWAY_NEWS_SCHEDULE.batchCount
    ).toBeGreaterThanOrEqual(123);
  });

  it("starts automatically on Railway even when the legacy flag is false", () => {
    expect(
      shouldStartRailwayScheduler({
        RAILWAY_ENVIRONMENT_ID: "production-id",
        INVESTDASH_SCHEDULER_ENABLED: "false",
      })
    ).toBe(true);
    expect(
      shouldStartRailwayScheduler({ INVESTDASH_SCHEDULER_ENABLED: "false" })
    ).toBe(false);
  });

  it("runs data completeness checks every 20 minutes outside the news window", () => {
    expect(RAILWAY_DATA_BACKFILL_CRON).toBe("0,20,40 1-21 * * *");
  });

  it("runs one review reminder digest daily at 09:00 JST", () => {
    expect(RAILWAY_REVIEW_REMINDER_CRON).toBe("0 0 * * *");
  });

  it("contains rejected cron tasks so the HTTP process can keep running", async () => {
    const error = new Error("temporary database disconnect");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      runRailwayScheduledTaskSafely("data backfill", async () => {
        throw error;
      })
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "[Railway scheduler] data backfill failed outside task boundary:",
      error
    );
    consoleError.mockRestore();
  });

  it("runs dividend before missing/stale signals and skips stale refresh after quota exhaustion", () => {
    expect(DATA_BACKFILL_STAGE_ORDER.indexOf("dividend_backfill")).toBeLessThan(
      DATA_BACKFILL_STAGE_ORDER.indexOf("signal_refresh")
    );
    expect(canRunStaleSignalRefresh({ quotaExhausted: false })).toBe(true);
    expect(canRunStaleSignalRefresh({ quotaExhausted: true })).toBe(false);
  });

  it("summarizes dividend and stale signal runs for persistent operations logs", () => {
    expect(
      summarizeDividendBackfill({
        processed: 2,
        updatedSymbols: ["AAA"],
        failed: ["BBB"],
        remaining: 3,
        processedSymbols: ["AAA", "BBB"],
        failureDetails: [{ symbol: "BBB", reason: "currency mismatch" }],
      })
    ).toMatchObject({ processed: 2, succeeded: 1, failed: 1, remaining: 3 });
    expect(
      summarizeStaleSignalRefresh({
        processed: 1,
        refreshed: 1,
        failed: [],
        remaining: 4,
        processedSymbols: ["AAA"],
        staleReasons: { AAA: ["NEW_NEWS"] },
        quotaExhausted: false,
      })
    ).toMatchObject({ processed: 1, succeeded: 1, failed: 0, remaining: 4 });
  });

  it("executes the real dividend/signal stage flow in order and skips stale refresh on quota", async () => {
    const order: string[] = [];
    const first = await runDividendAndSignalStages({
      dividend: async () => { order.push("dividend"); return { updated: 1 }; },
      missingSignals: async () => { order.push("missing"); return { quotaExhausted: false }; },
      staleSignals: async () => { order.push("stale"); return { refreshed: 1 }; },
    });
    expect(order).toEqual(["dividend", "missing", "stale"]);
    expect(first.staleSignals).toEqual({ refreshed: 1 });

    order.length = 0;
    const quota = await runDividendAndSignalStages({
      dividend: async () => { order.push("dividend"); return { updated: 1 }; },
      missingSignals: async () => { order.push("missing"); return { quotaExhausted: true }; },
      staleSignals: async () => { order.push("stale"); return { refreshed: 1 }; },
    });
    expect(order).toEqual(["dividend", "missing"]);
    expect(quota.staleSignals).toBeNull();
  });
});
