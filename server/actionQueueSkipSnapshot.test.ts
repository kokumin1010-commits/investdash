import { describe, expect, it } from "vitest";
import type { ActionQueueItem } from "../drizzle/schema";
import { buildSkippedActionReviewPayload } from "./services/actionQueueService";

function queueItem(overrides: Partial<ActionQueueItem> = {}): ActionQueueItem {
  const now = new Date("2026-08-31T00:15:00.000Z");
  return {
    id: 77,
    userId: 3,
    symbol: "2733.T",
    name: "あらた",
    status: "PENDING_ACTION",
    triggerType: "EARNINGS",
    triggerKey: "earnings:2733.T:news-99",
    triggerSummary: "四半期決算を確認",
    sourceNewsId: 99,
    sourceSignalId: 12,
    previousSignalId: 11,
    previousAction: "HOLD",
    action: "REDUCE",
    direction: "SELL",
    currency: "JPY",
    rationale: "利益減少が続くため一部売却を検討",
    evidence: {
      reviewTriggers: ["次回決算で純利益を確認"],
      riskFlags: ["業績悪化リスク"],
    },
    currentQuantity: "2000.0000",
    currentPrice: "2738.0000",
    currentValueBase: "5476000.00",
    currentWeightPct: "0.6300",
    recommendedShares: "500.0000",
    recommendedAmountLocal: "1369000.00",
    recommendedAmountBase: "1369000.00",
    afterQuantity: "1500.0000",
    afterWeightPct: "0.4725",
    priority: 96,
    deadline: new Date("2026-09-02T00:00:00.000Z"),
    snoozedUntil: null,
    decisionNote: null,
    approvedAt: null,
    skippedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("Action Queue skipped snapshot", () => {
  it("freezes contemporaneous evidence and a JST-day baseline observation", () => {
    const now = new Date("2026-08-31T15:15:00.000Z");
    const payload = buildSkippedActionReviewPayload({
      userId: 3,
      current: queueItem(),
      decisionNote: "次の決算で利益回復を確認する",
      now,
    });

    expect(payload.reviewValues).toMatchObject({
      userId: 3,
      actionQueueItemId: 77,
      symbol: "2733.T",
      baselinePrice: "2738.0000",
      baselineQuantity: "2000.0000",
      recommendedAmountBase: "1369000.00",
      decisionNote: "次の決算で利益回復を確認する",
      processVersion: "skip-process-v1",
      processQuality: "DISCIPLINE_SOUND",
    });
    expect(payload.snapshot).toMatchObject({
      triggerKey: "earnings:2733.T:news-99",
      sourceNewsId: 99,
      sourceSignalId: 12,
      currentPrice: "2738.0000",
      recommendedShares: "500.0000",
      decisionNote: "次の決算で利益回復を確認する",
      skippedAt: now.toISOString(),
    });
    expect(payload.baselineObservation).toEqual({
      userId: 3,
      symbol: "2733.T",
      currency: "JPY",
      observedDateJst: "2026-09-01",
      currentPrice: "2738.0000",
      source: "QUEUE_BASELINE",
      observedAt: now,
    });
  });

  it("does not invent a zero baseline when the skip-time price is missing", () => {
    const payload = buildSkippedActionReviewPayload({
      userId: 9,
      current: queueItem({ userId: 9, currentPrice: null }),
      decisionNote: "価格データを確認してから判断する",
      now: new Date("2026-08-31T00:00:00.000Z"),
    });

    expect(payload.reviewValues.userId).toBe(9);
    expect(payload.reviewValues.baselinePrice).toBeNull();
    expect(payload.baselineObservation).toBeNull();
  });
});
