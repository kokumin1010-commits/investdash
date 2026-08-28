import { describe, expect, it, vi } from "vitest";
import { refreshStaleSignalsBatch } from "./services/portfolio";

describe("refreshStaleSignalsBatch", () => {
  it("只刷新 stale signal，并返回 symbol、原因和 remaining", async () => {
    const regenerateSignal = vi.fn(async () => ({ action: "HOLD" }));
    const groups = [
      {
        symbol: "AAA",
        marketValueBase: 100,
        signal: { action: "WATCH", freshness: { isStale: true, reasons: ["NEW_NEWS"], priceMovePct: null } },
      },
      {
        symbol: "BBB",
        marketValueBase: 200,
        signal: { action: "HOLD", freshness: { isStale: false, reasons: [], priceMovePct: null } },
      },
    ];

    const result = await refreshStaleSignalsBatch(
      1,
      { batchSize: 2 },
      {
        listHoldings: async () => [{ id: 1, symbol: "AAA" }],
        buildPortfolio: async () => ({ groups }),
        listAiRuns: async () => [],
        regenerateSignal,
      } as never
    );

    expect(result.total).toBe(1);
    expect(result.processedSymbols).toEqual(["AAA"]);
    expect(result.staleReasons).toEqual({ AAA: ["NEW_NEWS"] });
    expect(result.refreshed).toBe(1);
    expect(result.remaining).toBe(0);
    expect(regenerateSignal).toHaveBeenCalledTimes(1);
  });
});
