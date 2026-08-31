import { describe, expect, it } from "vitest";
import {
  filterWatchlistRows,
  sortWatchlistRows,
} from "../shared/watchlistSort";

const rows = [
  {
    id: 1,
    symbol: "ALPHA",
    tickerCode: "ALP",
    name: "Alpha Holdings",
    priority: "HIGH" as const,
    gapPct: -20,
    reachedTarget: false,
    createdAt: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    symbol: "BRAVO",
    tickerCode: "BRV",
    name: "Beta Utilities",
    priority: "LOW" as const,
    gapPct: 4,
    reachedTarget: true,
    createdAt: "2026-02-01T00:00:00Z",
  },
  {
    id: 3,
    symbol: "CHARLIE",
    tickerCode: "285A",
    name: "Charlie Corp",
    priority: "MEDIUM" as const,
    gapPct: -2,
    reachedTarget: false,
    createdAt: "2026-03-01T00:00:00Z",
  },
  {
    id: 4,
    symbol: "DELTA",
    tickerCode: "DLT",
    name: "Delta Corp",
    priority: "HIGH" as const,
    gapPct: null,
    reachedTarget: false,
    createdAt: "2026-03-01T00:00:00Z",
  },
];

describe("watchlist sort", () => {
  it("matches name, normalized symbol and ticker code without case or outer-space sensitivity", () => {
    expect(filterWatchlistRows(rows, "  alpha  ").map(row => row.id)).toEqual([
      1,
    ]);
    expect(filterWatchlistRows(rows, "bravo").map(row => row.id)).toEqual([2]);
    expect(filterWatchlistRows(rows, "２８５ａ").map(row => row.id)).toEqual([3]);
    expect(filterWatchlistRows(rows, "   ").map(row => row.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("sorts by real added date in both directions with stable id tie-breaking", () => {
    expect(sortWatchlistRows(rows, "NEWEST").map(row => row.id)).toEqual([
      4, 3, 2, 1,
    ]);
    expect(sortWatchlistRows(rows, "OLDEST").map(row => row.id)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("sorts priorities high to low and preserves deterministic newest-first ties", () => {
    expect(sortWatchlistRows(rows, "PRIORITY").map(row => row.id)).toEqual([
      4, 1, 3, 2,
    ]);
  });

  it("puts reached and nearest targets first while keeping missing targets last", () => {
    expect(
      sortWatchlistRows(rows, "TARGET_NEAREST").map(row => row.id)
    ).toEqual([2, 3, 1, 4]);
  });

  it("never mutates the server response order", () => {
    const original = rows.map(row => row.id);
    sortWatchlistRows(rows, "OLDEST");
    expect(rows.map(row => row.id)).toEqual(original);
  });
});
