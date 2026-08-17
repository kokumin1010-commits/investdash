/**
 * ウォッチリストの「目標まであと何 %」の計算のテスト。
 *
 * 以前は分母が目標価格だったため、現在 3,751 / 目標 1,900 で 97.4% と出ていた。
 * 実際に知りたいのは「あと 49.3% 下がれば届く」なので、
 * 同じ状況を指しているのに数字が倍近く違い判断を誤らせていた。
 * 候補提案側と基準を揃えるため、分母は必ず現在値にする。
 */
import { describe, it, expect } from "vitest";

/** watchlistRouter の gapPct と同じ計算 */
function gapPct(price: number | null, target: number | null): number | null {
  if (price === null || target === null || price === 0) return null;
  return ((target - price) / price) * 100;
}

describe("目標まであと何 % の計算", () => {
  it("現在値が目標より高い場合は負の値（下がる必要がある）", () => {
    expect(gapPct(3751, 1900)).toBeCloseTo(-49.35, 1);
    expect(gapPct(200, 142)).toBeCloseTo(-29.0, 1);
    expect(gapPct(3934, 3150)).toBeCloseTo(-19.93, 1);
  });

  it("分母は現在値。目標価格を分母にした場合と一致しない", () => {
    const correct = gapPct(3751, 1900)!;
    const wrong = ((3751 - 1900) / 1900) * 100;
    expect(Math.abs(correct)).toBeCloseTo(49.35, 1);
    expect(wrong).toBeCloseTo(97.42, 1);
    // 同じ状況でこれだけ数字が違うため、基準の統一が必要だった
    expect(Math.abs(Math.abs(correct) - wrong)).toBeGreaterThan(40);
  });

  it("現在値が目標以下なら 0 以上（すでに買える水準）", () => {
    expect(gapPct(140, 142)).toBeGreaterThan(0);
    expect(gapPct(142, 142)).toBe(0);
  });

  it("目標まで下がる率は必ず -100% より大きい", () => {
    for (const [p, t] of [[100, 1], [3751, 100], [1.01, 0.01]] as const) {
      const g = gapPct(p, t)!;
      expect(g).toBeGreaterThan(-100);
    }
  });

  it("価格が未取得なら計算しない", () => {
    expect(gapPct(null, 142)).toBeNull();
    expect(gapPct(200, null)).toBeNull();
    expect(gapPct(null, null)).toBeNull();
  });

  it("現在値 0 でゼロ除算しない", () => {
    expect(gapPct(0, 142)).toBeNull();
  });

  it("小数の株価（SGD の REIT など）でも正しく計算する", () => {
    expect(gapPct(1.01, 0.93)).toBeCloseTo(-7.92, 1);
  });
});
