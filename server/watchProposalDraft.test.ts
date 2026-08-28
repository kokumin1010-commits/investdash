import { describe, expect, it, vi } from "vitest";
import { generateWatchProposalDraft } from "./services/watchProposalService";

describe("generateWatchProposalDraft", () => {
  it("collects real-data evidence and leaves watch plan fields untouched before confirmation", async () => {
    const now = new Date("2026-08-29T03:00:00Z");
    let item: any = {
      id: 7,
      userId: 1,
      symbol: "PYPL",
      tickerCode: "PYPL",
      name: "PayPal Holdings, Inc.",
      market: "US",
      currency: "USD",
      currentPrice: "53.71",
      previousClose: "54.00",
      targetPrice: null,
      plannedAmount: null,
      watchReason: null,
      buyConditions: null,
      priority: "MEDIUM",
      sector: null,
      industry: null,
      priceUpdatedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const updateWatchItem = vi.fn(async (_userId: number, _id: number, patch: any) => {
      item = { ...item, ...patch };
    });
    const generateProposal = vi.fn(async () => ({
      id: 91,
      symbol: "PYPL",
      stance: "WAIT",
      conclusion: "今は価格を待つ",
      rationale: "利益率改善を確認する。",
      amountBase: null,
      limitPrice: 48,
      priceAtProposal: 53.8,
      buyConditions: "48ドル以下かつ利益率改善",
      invalidation: "次回決算で悪化",
      confidence: 72,
      model: "gemini-3-flash-preview",
    }));

    const result = await generateWatchProposalDraft(1, 7, {
      getWatchItem: vi.fn(async () => item) as any,
      updateWatchItem: updateWatchItem as any,
      fetchQuote: vi.fn(async () => ({
        price: 53.8,
        previousClose: 54,
        currency: "USD",
        longName: "PayPal Holdings, Inc.",
        shortName: "PayPal",
      })) as any,
      fetchCompanyProfile: vi.fn(async () => ({
        sector: "Financial Services",
        industry: "Credit Services",
      })) as any,
      fetchPriceHistory: vi.fn(async () => [
        { t: new Date("2026-03-01T00:00:00Z"), c: 44 },
        { t: new Date("2026-08-28T00:00:00Z"), c: 79 },
      ]) as any,
      fetchDividendHistory: vi.fn(async () => ({
        currency: "USD",
        dividends: [],
        splits: [],
      })) as any,
      syncNewsForTargets: vi.fn(async () => ({ fetched: 2, analyzed: 1 })) as any,
      listNews: vi.fn(async () => [
        {
          publishedAt: new Date("2026-08-28T00:00:00Z"),
          createdAt: new Date("2026-08-28T01:00:00Z"),
        },
      ]) as any,
      generateProposal: generateProposal as any,
      now: () => now,
    });

    expect(result.id).toBe(91);
    expect(result.priceAtProposal).toBe(53.8);
    expect(result.evidence).toEqual(
      expect.objectContaining({
        price: 53.8,
        rangeLow6m: 44,
        rangeHigh6m: 79,
        annualDividend: 0,
        newsCount: 1,
        fetchedNews: 2,
        analyzedNews: 1,
      })
    );
    expect(updateWatchItem).toHaveBeenCalledWith(
      1,
      7,
      expect.not.objectContaining({
        targetPrice: expect.anything(),
        plannedAmount: expect.anything(),
        watchReason: expect.anything(),
        buyConditions: expect.anything(),
      })
    );
    expect(generateProposal).toHaveBeenCalledWith(
      1,
      "PYPL",
      expect.objectContaining({
        watchItemId: 7,
        reviewStatus: "PENDING",
        priceAtProposal: 53.8,
        evidence: expect.objectContaining({ newsCount: 1 }),
      })
    );
  });
});
