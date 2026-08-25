import { describe, expect, it } from "vitest";
import {
  getNewsBatchForUtcDate,
  RAILWAY_NEWS_SCHEDULE,
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
});
