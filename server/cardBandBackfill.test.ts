import { describe, expect, it, vi } from "vitest";
import { draftMissingCards } from "./services/cardService";
import { runMissingBandChecksBatch } from "./services/priceBandService";
import { resolveSchedulerRunStatus } from "./services/schedulerRunLog";

const holding = (symbol: string) => ({
  id: symbol.charCodeAt(0),
  userId: 1,
  symbol,
  name: symbol,
  quantity: "1",
  avgCost: "10",
  currency: "JPY",
});

describe("投资卡缺失批处理", () => {
  it("只选空卡、按市值优先，并冷却最近失败标的", async () => {
    const drafted: string[] = [];
    const result = await draftMissingCards(
      1,
      { batchSize: 2, retryFailed: false },
      {
        listHoldings: vi.fn(async () => [holding("A"), holding("B"), holding("C")] as never),
        buildPortfolio: vi.fn(async () => ({
          groups: [
            { symbol: "A", marketValueBase: 200 },
            { symbol: "B", marketValueBase: 300 },
            { symbol: "C", marketValueBase: 100 },
          ],
        }) as never),
        listCards: vi.fn(async () => [{ symbol: "B", buyReason: "手工内容" }] as never),
        listAiRuns: vi.fn(async () => [
          { symbol: "C", status: "FAILED", createdAt: new Date() },
        ] as never),
        draftOne: vi.fn(async (_userId, symbol) => {
          drafted.push(symbol);
          return { symbol, created: true };
        }),
      }
    );

    expect(drafted).toEqual(["A"]);
    expect(result.created).toBe(1);
    expect(result.deferred).toEqual(["C"]);
    expect(result.remaining).toBe(1);
  });

  it("遇到 quota 后立即停止后续标的", async () => {
    const draftOne = vi.fn(async () => {
      throw new Error("429 quota exhausted");
    });
    const result = await draftMissingCards(
      1,
      { batchSize: 2, retryFailed: true },
      {
        listHoldings: vi.fn(async () => [holding("A"), holding("B")] as never),
        buildPortfolio: vi.fn(async () => ({ groups: [
          { symbol: "A", marketValueBase: 200 },
          { symbol: "B", marketValueBase: 100 },
        ] }) as never),
        listCards: vi.fn(async () => []),
        listAiRuns: vi.fn(async () => []),
        draftOne,
      }
    );
    expect(draftOne).toHaveBeenCalledTimes(1);
    expect(result.quotaExhausted).toBe(true);
    expect(result.remaining).toBe(2);
  });
});

describe("价格带缺失核验批处理", () => {
  const row = (symbol: string, value: number, pending = 1) => ({
    symbol,
    held: true,
    needsCheck: true,
    currentBandId: symbol.charCodeAt(0),
    pendingCheckCount: pending,
    holdingValueJpy: value,
  });

  it("按市值优先且跳过冷却中的标的", async () => {
    const checked: number[] = [];
    const result = await runMissingBandChecksBatch(
      1,
      { batchSize: 2, retryFailed: false },
      {
        listOverview: vi.fn(async () => [row("A", 100, 2), row("B", 300, 1)] as never),
        listAiRuns: vi.fn(async () => [
          { symbol: "B", status: "FAILED", createdAt: new Date() },
        ] as never),
        runOne: vi.fn(async (_userId, bandId) => {
          checked.push(bandId);
          return {} as never;
        }),
      }
    );
    expect(checked).toEqual(["A".charCodeAt(0)]);
    expect(result.checked).toBe(1);
    expect(result.itemsChecked).toBe(2);
    expect(result.deferred).toEqual(["B"]);
    expect(result.remaining).toBe(1);
  });

  it("quota 后不继续下一个 band", async () => {
    const runOne = vi.fn(async () => {
      throw new Error("412 usage exhausted");
    });
    const result = await runMissingBandChecksBatch(
      1,
      { batchSize: 2, retryFailed: true },
      {
        listOverview: vi.fn(async () => [row("A", 200), row("B", 100)] as never),
        listAiRuns: vi.fn(async () => []),
        runOne,
      }
    );
    expect(runOne).toHaveBeenCalledTimes(1);
    expect(result.quotaExhausted).toBe(true);
    expect(result.remaining).toBe(2);
  });
});

describe("调度运行状态", () => {
  it("区分成功、部分失败、失败和跳过", () => {
    expect(resolveSchedulerRunStatus({ processed: 2, succeeded: 2, failed: 0 })).toBe("SUCCESS");
    expect(resolveSchedulerRunStatus({ processed: 2, succeeded: 1, failed: 1 })).toBe("PARTIAL");
    expect(resolveSchedulerRunStatus({ processed: 1, succeeded: 0, failed: 1 })).toBe("FAILED");
    expect(resolveSchedulerRunStatus({ processed: 0, succeeded: 0, failed: 0, skipped: 1 })).toBe("SKIPPED");
    expect(resolveSchedulerRunStatus({ processed: 0, succeeded: 0, failed: 0 })).toBe("SKIPPED");
  });
});
