import { describe, expect, it } from "vitest";
import { evaluateSignalFreshness } from "../shared/signalFreshness";

describe("evaluateSignalFreshness", () => {
  it("新 schema、ニュース、カード、価格10%変動、期限を分别记录", () => {
    const createdAt = new Date("2026-08-01T00:00:00Z");
    const result = evaluateSignalFreshness({
      createdAt,
      validUntil: new Date("2026-08-08T00:00:00Z"),
      schemaVersion: 1,
      currentSchemaVersion: 2,
      priceAtSignal: 100,
      currentPrice: 111,
      latestAnalyzedNewsAt: new Date("2026-08-02T00:00:00Z"),
      cardUpdatedAt: new Date("2026-08-03T00:00:00Z"),
      now: new Date("2026-08-09T00:00:00Z"),
    });

    expect(result.isStale).toBe(true);
    expect(result.reasons).toEqual(["SCHEMA", "EXPIRED", "NEW_NEWS", "CARD_UPDATED", "PRICE_MOVE"]);
    expect(result.priceMovePct).toBeCloseTo(11);
  });

  it("最新 schema かつ期限内・価格変動未満なら stale にしない", () => {
    const result = evaluateSignalFreshness({
      createdAt: new Date("2026-08-01T00:00:00Z"),
      validUntil: new Date("2026-08-10T00:00:00Z"),
      schemaVersion: 2,
      currentSchemaVersion: 2,
      priceAtSignal: 100,
      currentPrice: 109.9,
      now: new Date("2026-08-05T00:00:00Z"),
    });
    expect(result).toEqual({ isStale: false, reasons: [], priceMovePct: expect.closeTo(9.9) });
  });
});
