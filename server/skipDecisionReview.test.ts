import { describe, expect, it } from "vitest";
import {
  buildSkipMilestoneSeeds,
  calculateCounterfactualEffectBase,
  evaluateSkipOutcome,
  evaluateSkipProcess,
} from "../shared/skipDecisionReview";

describe("skip decision review", () => {
  it("builds deterministic 30/90/180 day milestones", () => {
    const skippedAt = new Date("2026-08-31T03:00:00.000Z");
    const milestones = buildSkipMilestoneSeeds(skippedAt);

    expect(milestones.map(item => item.eventKey)).toEqual([
      "day-30",
      "day-90",
      "day-180",
    ]);
    expect(milestones[0].dueAt.toISOString()).toBe("2026-09-30T03:00:00.000Z");
    expect(milestones[2].dueAt.toISOString()).toBe("2027-02-27T03:00:00.000Z");
  });

  it("treats contemporaneous risk evidence as sound discipline", () => {
    const result = evaluateSkipProcess({
      direction: "BUY",
      decisionNote: null,
      recommendedShares: 0,
      recommendedAmountBase: 0,
      evidence: {
        riskFlags: ["debt"],
        dataQuality: "LIMITED",
        ibkrRiskLevel: "WARNING",
      },
    });

    expect(result.quality).toBe("DISCIPLINE_SOUND");
    expect(result.reasons.join(" ")).toContain("IBKR");
  });

  it("asks for process improvement when an executable action is skipped without a reason", () => {
    expect(
      evaluateSkipProcess({
        direction: "SELL",
        decisionNote: "",
        recommendedShares: 10,
        recommendedAmountBase: 100_000,
        evidence: { dataQuality: "STRONG" },
      }).quality
    ).toBe("DISCIPLINE_NEEDS_IMPROVEMENT");
  });

  it("keeps day-30 outcome unclear even after a large price move", () => {
    const result = evaluateSkipOutcome({
      direction: "BUY",
      milestoneType: "DAY_30",
      baselinePrice: 100,
      currentPrice: 135,
      observedPrices: Array.from({ length: 20 }, (_, index) => 100 + index),
      signalAction: "ADD",
    });

    expect(result.quality).toBe("OUTCOME_NOT_YET_CLEAR");
  });

  it("separates an unfavorable buy-skip outcome from process quality", () => {
    const process = evaluateSkipProcess({
      direction: "BUY",
      decisionNote: "価格ではなく決算の確認を待つ",
      recommendedShares: 10,
      recommendedAmountBase: 100_000,
      evidence: { dataQuality: "STRONG" },
    });
    const outcome = evaluateSkipOutcome({
      direction: "BUY",
      milestoneType: "DAY_90",
      baselinePrice: 100,
      currentPrice: 112,
      observedPrices: Array.from({ length: 15 }, (_, index) => 100 + index),
      signalAction: "ADD",
    });

    expect(process.quality).toBe("DISCIPLINE_SOUND");
    expect(outcome.quality).toBe("OUTCOME_UNFAVORABLE");
  });

  it("interprets the same positive return favorably for a skipped sell", () => {
    const result = evaluateSkipOutcome({
      direction: "SELL",
      milestoneType: "DAY_180",
      baselinePrice: 100,
      currentPrice: 116,
      observedPrices: Array.from({ length: 20 }, (_, index) => 95 + index),
      signalAction: "HOLD",
    });

    expect(result.quality).toBe("OUTCOME_FAVORABLE");
    expect(result.highestPrice).toBe(114);
    expect(result.lowestPrice).toBe(95);
  });

  it("does not invent a return when baseline or current price is missing", () => {
    const result = evaluateSkipOutcome({
      direction: "BUY",
      milestoneType: "DAY_180",
      baselinePrice: null,
      currentPrice: 120,
      observedPrices: [110, 120],
      signalAction: "ADD",
    });

    expect(result.returnPct).toBeNull();
    expect(result.quality).toBe("OUTCOME_NOT_YET_CLEAR");
  });

  it("allows an after-earnings signal reversal to support a skip without hindsight pricing", () => {
    const result = evaluateSkipOutcome({
      direction: "BUY",
      milestoneType: "AFTER_EARNINGS",
      baselinePrice: 100,
      currentPrice: 101,
      observedPrices: [101],
      signalAction: "EXIT",
    });

    expect(result.quality).toBe("OUTCOME_FAVORABLE");
    expect(result.summary).toContain("シグナル方向");
  });

  it("computes direction-aware counterfactual effects without inventing review amounts", () => {
    expect(
      calculateCounterfactualEffectBase({
        direction: "BUY",
        recommendedAmountBase: 1_000_000,
        returnPct: 12,
      })
    ).toBe(120_000);
    expect(
      calculateCounterfactualEffectBase({
        direction: "SELL",
        recommendedAmountBase: 1_000_000,
        returnPct: -12,
      })
    ).toBe(120_000);
    expect(
      calculateCounterfactualEffectBase({
        direction: "REVIEW",
        recommendedAmountBase: 1_000_000,
        returnPct: 12,
      })
    ).toBeNull();
  });
});
