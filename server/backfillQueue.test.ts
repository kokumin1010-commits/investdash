import { describe, expect, it } from "vitest";
import { selectBackfillQueue } from "../shared/backfillQueue";

const now = new Date("2026-08-26T00:00:00.000Z").getTime();
const candidates = [
  { symbol: "SMALL", value: 100 },
  { symbol: "LARGE", value: 1_000 },
  { symbol: "MID", value: 500 },
];

describe("selectBackfillQueue", () => {
  it("prioritizes missing symbols by portfolio value", () => {
    const result = selectBackfillQueue(candidates, [], {
      retryFailed: false,
      failureCooldownMs: 6 * 60 * 60 * 1000,
      now,
    });
    expect(result.eligible.map(item => item.symbol)).toEqual(["LARGE", "MID", "SMALL"]);
  });

  it("defers only a recent latest failure", () => {
    const result = selectBackfillQueue(
      candidates,
      [
        { symbol: "LARGE", status: "FAILED", createdAt: new Date(now - 60_000) },
        { symbol: "MID", status: "FAILED", createdAt: new Date(now - 7 * 60 * 60 * 1000) },
      ],
      { retryFailed: false, failureCooldownMs: 6 * 60 * 60 * 1000, now }
    );
    expect(result.deferred.map(item => item.symbol)).toEqual(["LARGE"]);
    expect(result.eligible.map(item => item.symbol)).toEqual(["MID", "SMALL"]);
  });

  it("does not let an older failure override a newer success", () => {
    const result = selectBackfillQueue(
      [candidates[1]],
      [
        { symbol: "LARGE", status: "SUCCESS", createdAt: new Date(now - 60_000) },
        { symbol: "LARGE", status: "FAILED", createdAt: new Date(now - 120_000) },
      ],
      { retryFailed: false, failureCooldownMs: 6 * 60 * 60 * 1000, now }
    );
    expect(result.eligible.map(item => item.symbol)).toEqual(["LARGE"]);
    expect(result.deferred).toEqual([]);
  });

  it("manual retry includes recent failures while preserving priority", () => {
    const result = selectBackfillQueue(
      candidates,
      [{ symbol: "LARGE", status: "FAILED", createdAt: new Date(now - 60_000) }],
      { retryFailed: true, failureCooldownMs: 6 * 60 * 60 * 1000, now }
    );
    expect(result.eligible.map(item => item.symbol)).toEqual(["LARGE", "MID", "SMALL"]);
    expect(result.deferred).toEqual([]);
  });
});
