import { describe, expect, it } from "vitest";
import {
  computeLongTermReturns,
  formatLongTermReturns,
  type PriceBar,
} from "../shared/longTermReturn";

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;

/** 月足を作る。now を最終月として months 本さかのぼる */
function makeBars(now: number, months: number, priceAt: (i: number) => number): PriceBar[] {
  const bars: PriceBar[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    bars.push({ t: now - i * MONTH, c: priceAt(months - 1 - i) });
  }
  return bars;
}

describe("computeLongTermReturns", () => {
  const now = Date.UTC(2026, 7, 19);

  it("5 年分の月足から 1 年・3 年・5 年の騰落率を出す", () => {
    // 61 か月分。$50 から毎月 1% ずつ上げる
    const bars = makeBars(now, 61, i => 50 * Math.pow(1.01, i));
    const r = computeLongTermReturns(bars);

    expect(r.pct1y).not.toBeNull();
    expect(r.pct3y).not.toBeNull();
    expect(r.pct5y).not.toBeNull();
    // 5 年 > 3 年 > 1 年の順で伸びが大きい
    expect(r.pct5y!).toBeGreaterThan(r.pct3y!);
    expect(r.pct3y!).toBeGreaterThan(r.pct1y!);
  });

  it("年率換算は 5 年が揃っているときだけ出す", () => {
    // 5 年で 2 倍になった場合、年率は約 14.9%
    const bars = makeBars(now, 61, i => 50 * Math.pow(2, i / 60));
    const r = computeLongTermReturns(bars);
    expect(r.cagr5y).not.toBeNull();
    expect(r.cagr5y!).toBeGreaterThan(13);
    expect(r.cagr5y!).toBeLessThan(17);
  });

  it("2 年分しかない銘柄では 3 年・5 年を出さない（短い期間を長期の実績と誤読させない）", () => {
    const bars = makeBars(now, 25, i => 100 + i);
    const r = computeLongTermReturns(bars);

    expect(r.pct1y).not.toBeNull();
    expect(r.pct3y).toBeNull();
    expect(r.pct5y).toBeNull();
    expect(r.cagr5y).toBeNull();
  });

  it("株価が下がった銘柄はマイナスで出す", () => {
    // リンク・リートの実測に近い形（5 年で -40%）
    const bars = makeBars(now, 61, i => 64.87 - (64.87 - 38.64) * (i / 60));
    const r = computeLongTermReturns(bars);

    expect(r.pct5y).not.toBeNull();
    expect(r.pct5y!).toBeLessThan(-35);
    expect(r.pct5y!).toBeGreaterThan(-45);
    // 下落銘柄の年率もマイナス
    expect(r.cagr5y!).toBeLessThan(0);
  });

  it("データが 1 本以下なら全て null", () => {
    expect(computeLongTermReturns([]).pct1y).toBeNull();
    expect(computeLongTermReturns([{ t: now, c: 100 }]).pct5y).toBeNull();
  });

  it("0 や NaN の終値は除く（欠損が混ざっても計算を壊さない）", () => {
    const bars: PriceBar[] = [
      { t: now - 60 * MONTH, c: 100 },
      { t: now - 30 * MONTH, c: 0 },
      { t: now - 15 * MONTH, c: Number.NaN },
      { t: now, c: 150 },
    ];
    const r = computeLongTermReturns(bars);
    expect(r.pct5y).not.toBeNull();
    expect(r.pct5y!).toBeCloseTo(50, 0);
  });
});

describe("formatLongTermReturns", () => {
  const now = Date.UTC(2026, 7, 19);

  it("取得できなかった期間は「データ未取得」と明記する", () => {
    const bars = makeBars(now, 25, i => 100 + i);
    const text = formatLongTermReturns(computeLongTermReturns(bars));

    expect(text).toContain("3 年の株価騰落: データ未取得");
    expect(text).toContain("5 年の株価騰落: データ未取得");
    // 5 年に満たないことを明示する
    expect(text).toContain("5 年に満たない");
  });

  it("上昇はプラス記号付きで書く", () => {
    const bars = makeBars(now, 61, i => 50 * Math.pow(1.01, i));
    const text = formatLongTermReturns(computeLongTermReturns(bars));
    expect(text).toMatch(/5 年の株価騰落: \+\d/);
    expect(text).toContain("年率換算");
  });
});
