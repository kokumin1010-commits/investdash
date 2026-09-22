import { describe, expect, it } from "vitest";
import {
  buildExistingHoldingAddSummary,
  existingHoldingAddDeferralReasons,
  type ExistingHoldingAddCandidateInput,
} from "../shared/existingHoldingAddCandidates";

function candidate(
  overrides: Partial<ExistingHoldingAddCandidateInput> = {}
): ExistingHoldingAddCandidateInput {
  return {
    symbol: "AAA",
    held: true,
    action: "ADD_MAIN",
    concernCount: 0,
    signalAction: "HOLD",
    signalDataQuality: "MODERATE",
    signalWouldBuyNow: "YES",
    signalIsStale: false,
    cardConviction: 3,
    sizing: {
      status: "BUY",
      shares: 100,
      amountBase: 1_000_000,
    },
    ranking: {
      eligible: true,
      rank: 4,
      gateReasons: [],
    },
    ...overrides,
  };
}

describe("existing holding add candidate policy", () => {
  it("includes a held HOLD signal when price, value, quality and risk gates agree", () => {
    const summary = buildExistingHoldingAddSummary([candidate()]);

    expect(summary.rawAddZoneCount).toBe(1);
    expect(summary.safetyGatePassedCount).toBe(1);
    expect(summary.reviewReadyCount).toBe(1);
    expect(summary.reviewReadyMainCount).toBe(1);
    expect(summary.candidates[0]).toMatchObject({
      symbol: "AAA",
      reviewRank: 1,
      priceBandRank: 4,
      signalAction: "HOLD",
    });
  });

  it.each([
    [{ signalAction: "WATCH" }, "SIGNAL_CONFLICT"],
    [{ signalIsStale: true }, "SIGNAL_STALE_OR_MISSING"],
    [{ signalIsStale: null }, "SIGNAL_STALE_OR_MISSING"],
    [{ signalDataQuality: "LIMITED" }, "SIGNAL_DATA_LIMITED"],
    [{ signalWouldBuyNow: "NO" }, "VALUATION_NOT_POSITIVE"],
    [{ concernCount: 1 }, "CONFIRMED_CONCERN"],
    [{ cardConviction: 2 }, "LOW_CONVICTION"],
    [
      {
        ranking: {
          eligible: false,
          rank: null,
          gateReasons: ["IBKR リスク DANGER"],
        },
      },
      "SAFETY_GATE",
    ],
  ] as const)("defers a candidate when %j", (overrides, reason) => {
    expect(existingHoldingAddDeferralReasons(candidate(overrides))).toContain(
      reason
    );
  });

  it("keeps raw zone counts separate and re-numbers only strict review candidates", () => {
    const summary = buildExistingHoldingAddSummary([
      candidate({ symbol: "LATE", action: "ADD_SMALL", ranking: { eligible: true, rank: 12 } }),
      candidate({ symbol: "BLOCKED", concernCount: 1, ranking: { eligible: true, rank: 2 } }),
      candidate({ symbol: "FIRST", ranking: { eligible: true, rank: 1 } }),
      candidate({ symbol: "UNHELD", held: false, ranking: { eligible: true, rank: 3 } }),
      candidate({ symbol: "HOLD-ZONE", action: "HOLD", ranking: { eligible: false, rank: null } }),
    ]);

    expect(summary).toMatchObject({
      rawAddZoneCount: 3,
      rawAddMainCount: 2,
      rawAddSmallCount: 1,
      safetyGatePassedCount: 3,
      reviewReadyCount: 2,
      reviewReadyMainCount: 1,
      reviewReadySmallCount: 1,
      reviewOnlyCount: 1,
    });
    expect(
      summary.candidates.map(item => [
        item.symbol,
        item.reviewRank,
        item.priceBandRank,
      ])
    ).toEqual([
      ["FIRST", 1, 1],
      ["LATE", 2, 12],
    ]);
  });
});
