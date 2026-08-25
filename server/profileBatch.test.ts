import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listHoldings: vi.fn(),
  listWatchlist: vi.fn(),
  updateHoldingBySymbol: vi.fn(),
  updateWatchItem: vi.fn(),
  fetchCompanyProfile: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listHoldings: mocks.listHoldings,
    listWatchlist: mocks.listWatchlist,
    updateHoldingBySymbol: mocks.updateHoldingBySymbol,
    updateWatchItem: mocks.updateWatchItem,
  };
});

vi.mock("./services/marketData", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/marketData")>();
  return { ...actual, fetchCompanyProfile: mocks.fetchCompanyProfile };
});

import { enrichProfileBatch } from "./services/portfolio";

const holding = (id: number, symbol: string, sector: string | null = null) =>
  ({ id, symbol, sector, profileUpdatedAt: null }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listHoldings.mockResolvedValue([
    holding(1, "7203.T"),
    holding(2, "7203.T"),
    holding(3, "NVDA"),
  ]);
  mocks.listWatchlist.mockResolvedValue([
    { id: 10, symbol: "7203.T", sector: null },
  ]);
  mocks.fetchCompanyProfile.mockImplementation(async (symbol: string) => ({
    sector: symbol === "7203.T" ? "Consumer Cyclical" : "Technology",
    industry: symbol === "7203.T" ? "Auto Manufacturers" : "Semiconductors",
    country: null,
    website: null,
    businessSummary: null,
  }));
});

describe("enrichProfileBatch", () => {
  it("deduplicates broker rows and updates every account by symbol", async () => {
    const result = await enrichProfileBatch(1, { offset: 0, batchSize: 1 });

    expect(result).toMatchObject({
      total: 2,
      processed: 1,
      updated: 1,
      nextOffset: 1,
    });
    expect(mocks.fetchCompanyProfile).toHaveBeenCalledTimes(1);
    expect(mocks.fetchCompanyProfile).toHaveBeenCalledWith("7203.T");
    expect(mocks.updateHoldingBySymbol).toHaveBeenCalledTimes(1);
    expect(mocks.updateHoldingBySymbol.mock.calls[0]?.[1]).toBe("7203.T");
    expect(mocks.updateWatchItem).toHaveBeenCalledWith(
      1,
      10,
      expect.objectContaining({ sector: "Consumer Cyclical" })
    );
  });

  it("continues from offset without fetching the first symbol again", async () => {
    const result = await enrichProfileBatch(1, { offset: 1, batchSize: 1 });

    expect(result.nextOffset).toBeNull();
    expect(mocks.fetchCompanyProfile).toHaveBeenCalledOnce();
    expect(mocks.fetchCompanyProfile).toHaveBeenCalledWith("NVDA");
    expect(mocks.updateHoldingBySymbol.mock.calls[0]?.[1]).toBe("NVDA");
  });

  it("reports unresolved Yahoo profiles without writing a fake sector", async () => {
    mocks.fetchCompanyProfile.mockResolvedValueOnce(null);

    const result = await enrichProfileBatch(1, { offset: 0, batchSize: 1 });

    expect(result.updated).toBe(0);
    expect(result.failed[0]).toMatchObject({ symbol: "7203.T" });
    expect(mocks.updateHoldingBySymbol).not.toHaveBeenCalled();
    expect(mocks.updateWatchItem).not.toHaveBeenCalled();
  });
});
