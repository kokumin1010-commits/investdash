import { describe, expect, it } from "vitest";
import { buildMarketSlices } from "./services/marketSlices";

/**
 * 月別配当の集計テスト。
 *
 * 「年間いくら」だけでは資金計画に使えない。日本株は 3 月・9 月に
 * 集中するため、月別に分けたときの合計が年間と一致することと、
 * 市場別に分けても総額が保たれることを検証する。
 */

function makeItem(
  market: "JP" | "US" | "SG",
  currency: string,
  value: number,
  annual: number,
  monthly: number[] | null
) {
  return {
    market,
    currency,
    marketValueBase: value,
    costValueBase: value * 0.8,
    marketValue: value,
    costValue: value * 0.8,
    dividend: { annualIncomeBase: annual, monthlyIncomeBase: monthly },
  };
}

/** 3 月と 9 月に半分ずつ払う日本株の典型パターン */
function jpPattern(annual: number): number[] {
  const m = Array<number>(12).fill(0);
  m[2] = annual / 2;
  m[8] = annual / 2;
  return m;
}

/** 四半期ごとに均等に払う米国株の典型パターン（3・6・9・12 月） */
function usPattern(annual: number): number[] {
  const m = Array<number>(12).fill(0);
  for (const i of [2, 5, 8, 11]) m[i] = annual / 4;
  return m;
}

describe("市場別の月別配当集計", () => {
  it("市場別の月別合計が年間配当と一致する", () => {
    const items = [
      makeItem("JP", "JPY", 10_000_000, 300_000, jpPattern(300_000)),
      makeItem("JP", "JPY", 5_000_000, 100_000, jpPattern(100_000)),
      makeItem("US", "USD", 8_000_000, 160_000, usPattern(160_000)),
    ];
    const slices = buildMarketSlices(items, 23_000_000);

    for (const s of slices) {
      const sum = s.dividendMonthlyBase.reduce((a, b) => a + b, 0);
      expect(sum, `${s.key} の月別合計が年間と一致しない`).toBeCloseTo(
        s.dividendIncomeBase,
        6
      );
    }
  });

  it("全市場の月別合計が総配当と一致する", () => {
    const items = [
      makeItem("JP", "JPY", 10_000_000, 300_000, jpPattern(300_000)),
      makeItem("US", "USD", 8_000_000, 160_000, usPattern(160_000)),
      makeItem("SG", "SGD", 5_000_000, 200_000, [0, 50_000, 0, 60_000, 0, 0, 0, 40_000, 0, 0, 50_000, 0]),
    ];
    const slices = buildMarketSlices(items, 23_000_000);
    const total = slices.reduce(
      (acc, s) => acc + s.dividendMonthlyBase.reduce((a, b) => a + b, 0),
      0
    );
    expect(total).toBeCloseTo(300_000 + 160_000 + 200_000, 6);
  });

  it("日本株は 3 月と 9 月に集中する形で集計される", () => {
    const items = [makeItem("JP", "JPY", 10_000_000, 400_000, jpPattern(400_000))];
    const jp = buildMarketSlices(items, 10_000_000)[0];
    expect(jp.dividendMonthlyBase[2]).toBeCloseTo(200_000, 6);
    expect(jp.dividendMonthlyBase[8]).toBeCloseTo(200_000, 6);
    // 他の月は 0
    const others = jp.dividendMonthlyBase.filter((_, i) => i !== 2 && i !== 8);
    expect(others.every(v => v === 0)).toBe(true);
  });

  it("配当の月別データが無い銘柄があっても他の銘柄の集計が壊れない", () => {
    const items = [
      makeItem("JP", "JPY", 10_000_000, 300_000, jpPattern(300_000)),
      // 月別が取得できていない銘柄（年間だけ判明）
      makeItem("JP", "JPY", 5_000_000, 100_000, null),
    ];
    const jp = buildMarketSlices(items, 15_000_000)[0];
    // 年間は両方の合計
    expect(jp.dividendIncomeBase).toBeCloseTo(400_000, 6);
    // 月別は取得できた分だけ（月別合計 < 年間になる。過大計上しないことが重要）
    const sum = jp.dividendMonthlyBase.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(300_000, 6);
    expect(sum).toBeLessThan(jp.dividendIncomeBase);
  });

  it("長さが 12 でない不正な月別データは加算しない", () => {
    const items = [
      {
        market: "JP" as const,
        currency: "JPY",
        marketValueBase: 1_000_000,
        costValueBase: 800_000,
        marketValue: 1_000_000,
        costValue: 800_000,
        // 壊れたデータ（長さ 5）
        dividend: { annualIncomeBase: 50_000, monthlyIncomeBase: [1, 2, 3, 4, 5] },
      },
    ];
    const jp = buildMarketSlices(items, 1_000_000)[0];
    expect(jp.dividendMonthlyBase).toHaveLength(12);
    expect(jp.dividendMonthlyBase.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("無配銘柄のみの市場は月別すべて 0 になる", () => {
    const items = [makeItem("US", "USD", 5_000_000, 0, Array<number>(12).fill(0))];
    const us = buildMarketSlices(items, 5_000_000)[0];
    expect(us.dividendMonthlyBase).toHaveLength(12);
    expect(us.dividendMonthlyBase.every(v => v === 0)).toBe(true);
  });
});
