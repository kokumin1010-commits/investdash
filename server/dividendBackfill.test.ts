import { describe, expect, it, vi } from "vitest";
import { syncDividends } from "./services/portfolio";

describe("syncDividends", () => {
  it("按 symbol 去重、更新全部账户，并报告币种不一致和剩余积压", async () => {
    const now = Date.now();
    const holdings = [
      { id: 1, symbol: "AAA", currency: "USD", quantity: "10", currentPrice: "100", dividendUpdatedAt: null },
      { id: 2, symbol: "AAA", currency: "USD", quantity: "20", currentPrice: "100", dividendUpdatedAt: null },
      { id: 3, symbol: "BBB", currency: "JPY", quantity: "1", currentPrice: "1000", dividendUpdatedAt: new Date(now) },
      { id: 4, symbol: "CCC", currency: "JPY", quantity: "5", currentPrice: "500", dividendUpdatedAt: new Date(now - 8 * 86_400_000) },
    ];
    const updateHolding = vi.fn(async () => undefined);
    const fetchDividendHistory = vi.fn(async (symbol: string) =>
      symbol === "AAA"
        ? {
            symbol,
            currency: "USD",
            price: 100,
            dividends: [{ amount: 1.25, date: Math.floor(now / 1000) - 86_400 }],
            splits: [],
          }
        : { symbol, currency: "USD", price: 500, dividends: [], splits: [] }
    );

    const result = await syncDividends(
      1,
      { batchSize: 10 },
      {
        listHoldings: async () => holdings,
        fetchDividendHistory,
        updateHolding,
      } as never
    );

    expect(fetchDividendHistory).toHaveBeenCalledTimes(2);
    expect(result.processedSymbols).toEqual(["AAA", "CCC"]);
    expect(result.updatedSymbols).toEqual(["AAA"]);
    expect(result.updated).toBe(2);
    expect(updateHolding).toHaveBeenCalledTimes(2);
    expect(result.failureDetails[0]).toEqual({
      symbol: "CCC",
      reason: "通貨不一致: 保有 JPY / 配当 USD",
    });
    expect(result.remaining).toBe(1);
    expect(result.nextOffset).toBe(0);
  });
});
