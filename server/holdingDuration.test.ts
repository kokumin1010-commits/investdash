import { describe, expect, it } from "vitest";
import { aggregateHoldingDurations, buildHoldingDuration } from "../shared/holdingDuration";

describe("holding duration", () => {
  const now = new Date("2026-08-27T12:00:00+09:00");

  it("uses a user-confirmed acquisition date as exact", () => {
    const result = buildHoldingDuration({
      acquiredAt: new Date("2025-08-27T00:00:00+09:00"),
      acquiredAtSource: "USER_CONFIRMED",
      earliestSnapshotAt: new Date("2026-08-25T00:00:00+09:00"),
      trackedAt: new Date("2026-08-25T00:00:00+09:00"),
      now,
    });
    expect(result.confidence).toBe("EXACT");
    expect(result.days).toBe(365);
    expect(result.source).toBe("USER_CONFIRMED");
  });

  it("falls back to at-least from the earliest monthly snapshot", () => {
    const result = buildHoldingDuration({
      earliestSnapshotAt: new Date("2026-08-25T23:30:00+09:00"),
      trackedAt: new Date("2026-08-26T00:30:00+09:00"),
      now,
    });
    expect(result.confidence).toBe("AT_LEAST");
    expect(result.days).toBe(2);
  });

  it("downgrades a multi-account symbol when any account is not exact", () => {
    const result = aggregateHoldingDurations([
      { startDate: new Date("2024-01-01"), days: 900, confidence: "EXACT", source: "BROKER_TRADE" },
      { startDate: new Date("2026-08-25"), days: 2, confidence: "AT_LEAST", source: "MONTHLY_SNAPSHOT" },
    ]);
    expect(result.confidence).toBe("AT_LEAST");
    expect(result.startDate.toISOString()).toContain("2024-01-01");
  });
});
