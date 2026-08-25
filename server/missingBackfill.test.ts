import { describe, expect, it, vi } from "vitest";
import { generateMissingSignalsBatch } from "./services/portfolio";
import { generateMissingHoldingPlans } from "./services/priceBandService";

const group = (
  symbol: string,
  value: number,
  signal: object | null = null,
  currentPrice: number | null = 100
) => ({ symbol, marketValueBase: value, signal, currentPrice });

describe("generateMissingSignalsBatch", () => {
  it("generates only missing signals in value order and reports remaining", async () => {
    const regenerate = vi.fn().mockResolvedValue({});
    const result = await generateMissingSignalsBatch(
      1,
      { batchSize: 2 },
      {
        listHoldings: vi.fn().mockResolvedValue([
          { symbol: "SMALL" },
          { symbol: "READY" },
          { symbol: "LARGE" },
        ]) as never,
        buildPortfolio: vi.fn().mockResolvedValue({
          groups: [group("SMALL", 100), group("READY", 500, { action: "HOLD" }), group("LARGE", 1000)],
        }) as never,
        listAiRuns: vi.fn().mockResolvedValue([]) as never,
        regenerateSignal: regenerate as never,
      }
    );

    expect(regenerate.mock.calls.map(call => call[1].symbol)).toEqual(["LARGE", "SMALL"]);
    expect(result).toMatchObject({
      total: 2,
      processed: 2,
      generated: 2,
      remaining: 0,
      nextOffset: null,
      quotaExhausted: false,
    });
  });

  it("stops after a quota error and leaves a retryable remainder", async () => {
    const regenerate = vi
      .fn()
      .mockRejectedValueOnce(new Error("429 quota exhausted"))
      .mockResolvedValue({});
    const result = await generateMissingSignalsBatch(
      1,
      { batchSize: 3 },
      {
        listHoldings: vi.fn().mockResolvedValue([{ symbol: "A" }, { symbol: "B" }]) as never,
        buildPortfolio: vi.fn().mockResolvedValue({ groups: [group("A", 1000), group("B", 500)] }) as never,
        listAiRuns: vi.fn().mockResolvedValue([]) as never,
        regenerateSignal: regenerate as never,
      }
    );

    expect(regenerate).toHaveBeenCalledOnce();
    expect(result.quotaExhausted).toBe(true);
    expect(result.failed[0].symbol).toBe("A");
    expect(result.remaining).toBe(2);
    expect(result.nextOffset).toBeNull();
  });
});

describe("generateMissingHoldingPlans", () => {
  it("preserves existing plans and generates only missing plans", async () => {
    const generatePlan = vi.fn().mockResolvedValue({});
    const result = await generateMissingHoldingPlans(
      1,
      { batchSize: 2 },
      {
        listPlanStatus: vi.fn().mockResolvedValue([
          { symbol: "READY", name: "Ready", hasPlan: true, generatedAt: new Date() },
          { symbol: "SMALL", name: "Small", hasPlan: false, generatedAt: null },
          { symbol: "LARGE", name: "Large", hasPlan: false, generatedAt: null },
        ]),
        buildPortfolio: vi.fn().mockResolvedValue({
          groups: [group("READY", 500), group("SMALL", 100), group("LARGE", 1000)],
        }) as never,
        listAiRuns: vi.fn().mockResolvedValue([]) as never,
        generatePlan: generatePlan as never,
      }
    );

    expect(generatePlan.mock.calls.map(call => call[1])).toEqual(["LARGE", "SMALL"]);
    expect(result).toMatchObject({ total: 2, generated: 2, remaining: 0, nextOffset: null });
  });

  it("skips a missing current price without inventing a band", async () => {
    const generatePlan = vi.fn();
    const result = await generateMissingHoldingPlans(
      1,
      { batchSize: 2 },
      {
        listPlanStatus: vi.fn().mockResolvedValue([
          { symbol: "NO_PRICE", name: "No price", hasPlan: false, generatedAt: null },
        ]),
        buildPortfolio: vi.fn().mockResolvedValue({ groups: [group("NO_PRICE", 1000, null, null)] }) as never,
        listAiRuns: vi.fn().mockResolvedValue([]) as never,
        generatePlan: generatePlan as never,
      }
    );

    expect(generatePlan).not.toHaveBeenCalled();
    expect(result.skipped).toEqual([{ symbol: "NO_PRICE", reason: "現在値が未取得です" }]);
    expect(result.remaining).toBe(1);
    expect(result.nextOffset).toBe(0);
  });
});
