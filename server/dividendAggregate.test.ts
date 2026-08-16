import { describe, expect, it } from "vitest";
import { buildMarketSlices } from "./services/marketSlices";
import { isImplausibleYield, IMPLAUSIBLE_YIELD_PCT } from "./services/dividend";

/**
 * 配当の集計が「全体 = 市場別の合計」になることを検証する。
 *
 * 実データ（2026-08-16 時点）では次の値になっており、
 * 市場別の合計は全体と誤差 0 円で一致していた。
 *   全体 ¥20,033,968 = 日本株 ¥12,245,378 + 米国株 ¥4,437,759 + SG 株 ¥3,350,831
 */
describe("配当の市場別集計", () => {
  const items = [
    {
      market: "JP" as const,
      currency: "JPY",
      marketValueBase: 442_934_420,
      costValueBase: 362_334_420,
      marketValue: 442_934_420,
      costValue: 362_334_420,
      dividend: { annualIncomeBase: 12_245_378 },
    },
    {
      market: "US" as const,
      currency: "USD",
      marketValueBase: 289_710_216,
      costValueBase: 251_491_216,
      marketValue: 1_818_000,
      costValue: 1_578_090,
      dividend: { annualIncomeBase: 4_437_759 },
    },
    {
      market: "SG" as const,
      currency: "SGD",
      marketValueBase: 78_919_142,
      costValueBase: 69_156_401,
      marketValue: 633_600,
      costValue: 555_225,
      dividend: { annualIncomeBase: 3_350_831 },
    },
  ];
  const total = items.reduce((s, i) => s + (i.marketValueBase ?? 0), 0);

  it("市場別の配当合計が全体と一致する", () => {
    const slices = buildMarketSlices(items, total);
    const sum = slices.reduce((s, x) => s + x.dividendIncomeBase, 0);
    expect(sum).toBe(12_245_378 + 4_437_759 + 3_350_831);
  });

  it("市場ごとの配当利回りを評価額から算出する", () => {
    const slices = buildMarketSlices(items, total);
    const jp = slices.find(s => s.key === "JP")!;
    const sg = slices.find(s => s.key === "SG")!;
    // 日本株 12,245,378 / 442,934,420 = 2.76%
    expect(jp.dividendYieldPct).toBeCloseTo(2.76, 1);
    // シンガポール株は REIT が多く利回りが高い 3,350,831 / 78,919,142 = 4.25%
    expect(sg.dividendYieldPct).toBeCloseTo(4.25, 1);
  });

  it("配当が未取得の市場は 0 円・利回り 0% になる（null にしない）", () => {
    const noDiv = [{ ...items[0], dividend: null }];
    const slices = buildMarketSlices(noDiv, items[0].marketValueBase);
    expect(slices[0].dividendIncomeBase).toBe(0);
    expect(slices[0].dividendYieldPct).toBe(0);
  });

  it("評価額が 0 の市場では利回りを null にする（0 除算を避ける）", () => {
    const zero = [{ ...items[0], marketValueBase: 0, marketValue: 0 }];
    const slices = buildMarketSlices(zero, 0);
    expect(slices[0].dividendYieldPct).toBeNull();
  });
});

describe("isImplausibleYield", () => {
  it("日本製鉄のケース（10.65%）を要確認と判定する", () => {
    // 年 2 回配当のため特別配当を検出できないケースの安全網
    expect(isImplausibleYield(10.65)).toBe(true);
  });

  it("実在する高配当銘柄は誤って警告しない", () => {
    // ファイザー 6.42% / UPS 6.28% / 産業ファンド投資法人 6.21% はいずれも実勢
    expect(isImplausibleYield(6.42)).toBe(false);
    expect(isImplausibleYield(6.28)).toBe(false);
    expect(isImplausibleYield(6.21)).toBe(false);
  });

  it("しきい値ちょうどは警告しない", () => {
    expect(isImplausibleYield(IMPLAUSIBLE_YIELD_PCT)).toBe(false);
    expect(isImplausibleYield(IMPLAUSIBLE_YIELD_PCT + 0.01)).toBe(true);
  });

  it("利回りが未取得なら警告しない", () => {
    expect(isImplausibleYield(null)).toBe(false);
  });
});
