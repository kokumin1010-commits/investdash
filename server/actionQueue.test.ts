import { describe, expect, it } from "vitest";
import {
  actionQueueDeadline,
  actionQueuePriority,
  buildActionQueueTriggerKey,
  isPendingActionStatus,
  nextActionQueueStatus,
  shouldQueueSignal,
} from "../shared/actionQueue";

describe("action queue state machine", () => {
  it("allows only explicit user decisions from pending", () => {
    expect(nextActionQueueStatus("PENDING_ACTION", "APPROVE")).toBe("APPROVED");
    expect(nextActionQueueStatus("PENDING_ACTION", "SNOOZE")).toBe("SNOOZED");
    expect(nextActionQueueStatus("PENDING_ACTION", "SKIP")).toBe("SKIPPED");
    expect(nextActionQueueStatus("PENDING_ACTION", "COMPLETE")).toBe(
      "COMPLETED"
    );
    expect(nextActionQueueStatus("COMPLETED", "APPROVE")).toBeNull();
  });

  it("queues actionable signals but not unchanged HOLD or ordinary refresh", () => {
    expect(
      shouldQueueSignal({
        triggerType: "EARNINGS",
        previousAction: "HOLD",
        action: "REDUCE",
      })
    ).toBe(true);
    expect(
      shouldQueueSignal({
        triggerType: "IMPORTANT_NEWS",
        previousAction: "HOLD",
        action: "WATCH",
      })
    ).toBe(true);
    expect(
      shouldQueueSignal({
        triggerType: "SIGNAL_CHANGE",
        previousAction: "REDUCE",
        action: "REDUCE",
      })
    ).toBe(false);
    expect(
      shouldQueueSignal({
        triggerType: "SIGNAL_CHANGE",
        previousAction: "HOLD",
        action: "ADD",
      })
    ).toBe(true);
    expect(
      shouldQueueSignal({
        triggerType: "MANUAL_ANALYSIS",
        previousAction: "REDUCE",
        action: "HOLD",
      })
    ).toBe(false);
  });

  it("builds deterministic event keys and action deadlines", () => {
    expect(
      buildActionQueueTriggerKey({
        triggerType: "EARNINGS",
        previousSignalId: 10,
        sourceSignalId: 11,
        sourceNewsId: 77,
        symbol: "2733.T",
      })
    ).toBe("earnings:2733.T:news-77");
    const now = new Date("2026-08-29T00:00:00.000Z");
    expect(actionQueueDeadline("REDUCE", "EARNINGS", now).toISOString()).toBe(
      "2026-08-31T00:00:00.000Z"
    );
    expect(
      actionQueueDeadline("WATCH", "INITIAL_REVIEW", now).toISOString()
    ).toBe("2026-09-05T00:00:00.000Z");
  });

  it("prioritizes exits, overdue items and earnings without value overriding action", () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    const exit = actionQueuePriority({
      action: "EXIT",
      triggerType: "IMPORTANT_NEWS",
      deadline: new Date("2026-08-28T00:00:00.000Z"),
      currentValueBase: 100_000,
      now,
    });
    const reduce = actionQueuePriority({
      action: "REDUCE",
      triggerType: "EARNINGS",
      deadline: new Date("2026-08-30T00:00:00.000Z"),
      currentValueBase: 20_000_000,
      now,
    });
    expect(exit).toBeGreaterThan(reduce);
  });

  it("wakes a snoozed item only after the JST-independent instant is reached", () => {
    const now = new Date("2026-08-29T00:00:00.000Z");
    expect(
      isPendingActionStatus("SNOOZED", now, new Date("2026-08-30T00:00:00Z"))
    ).toBe(false);
    expect(
      isPendingActionStatus("SNOOZED", now, new Date("2026-08-28T00:00:00Z"))
    ).toBe(true);
  });
});
