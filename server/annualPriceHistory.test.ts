import { describe, expect, it } from "vitest";
import {
  aggregateAnnualPrices,
  summarizeAnnualPrices,
} from "../shared/annualPriceHistory";

const point = (year: number, month: number, price: number) => ({
  t: Date.UTC(year, month - 1, 1),
  price,
});

describe("annualPriceHistory", () => {
  it("月次の拆股调整价格を年次の终值・高值・低值・收益率に集约する", () => {
    const bars = aggregateAnnualPrices(
      [point(2024, 1, 80), point(2024, 12, 100), point(2025, 1, 90), point(2025, 12, 120)],
      "MAX"
    );
    expect(bars).toEqual([
      expect.objectContaining({ year: 2024, close: 100, yearHigh: 100, yearLow: 80, returnPct: null }),
      expect.objectContaining({ year: 2025, close: 120, yearHigh: 120, yearLow: 90, returnPct: 20 }),
    ]);
  });

  it("10年和20年选择只保留最新年份からの指定区间", () => {
    const points = Array.from({ length: 25 }, (_, index) => point(2001 + index, 12, index + 1));
    expect(aggregateAnnualPrices(points, "10Y")).toHaveLength(10);
    expect(aggregateAnnualPrices(points, "20Y")).toHaveLength(20);
    expect(aggregateAnnualPrices(points, "MAX")).toHaveLength(25);
  });

  it("无效点不伪造，汇总返回高点回撤和空数据状态", () => {
    const bars = aggregateAnnualPrices(
      [point(2024, 12, 100), { t: Number.NaN, price: 999 }, point(2025, 12, 75)],
      "MAX"
    );
    expect(summarizeAnnualPrices(bars)).toEqual({
      latestClose: 75,
      peakClose: 100,
      drawdownFromPeakPct: -25,
      startYear: 2024,
      endYear: 2025,
    });
    expect(summarizeAnnualPrices([]).latestClose).toBeNull();
  });
});
