import { describe, it, expect } from "vitest";
import { evaluateBands, type BandInput } from "../shared/priceBands";

/**
 * 価格帯を手で直したときの挙動。
 *
 * 手直しで帯の範囲が変わると判定も変わる。ここで確かめたいのは
 * 「編集後の範囲で正しく判定されるか」と「不正な範囲を作れないか」。
 */
describe("価格帯の手動編集", () => {
  const band = (
    id: number,
    lower: number | null,
    upper: number | null,
    label: string
  ): BandInput => ({
    id,
    lowerPrice: lower,
    upperPrice: upper,
    action: "HOLD",
    actionLabel: label,
    reason: null,
    checkItems: null,
    plannedAmount: null,
    sortOrder: id,
  });

  it("上限を下げると、それまで帯の中にいた価格が帯の外に出る", () => {
    const before = [band(1, 195, 309.99, "静観")];
    expect(evaluateBands(222.02, before).currentBand?.actionLabel).toBe("静観");

    // 上限を 210 に下げると 222.02 は範囲外になる
    const after = [band(1, 195, 210, "静観")];
    const r = evaluateBands(222.02, after);
    expect(r.currentBand).toBeNull();
    expect(r.abovePlan).toBe(true);
  });

  it("下限を上げると、それまで帯の中にいた価格が下に外れる", () => {
    const after = [band(1, 230, 309.99, "静観")];
    const r = evaluateBands(222.02, after);
    expect(r.currentBand).toBeNull();
    expect(r.belowPlan).toBe(true);
  });

  it("空欄（null）にすれば上限なし・下限なしとして扱われる", () => {
    // 上限なしにすると、いくら高くても帯の中に入る
    const noUpper = [band(1, 195, null, "静観")];
    expect(evaluateBands(9999, noUpper).currentBand?.actionLabel).toBe("静観");

    // 下限なしにすると、いくら安くても帯の中に入る
    const noLower = [band(1, null, 309.99, "静観")];
    expect(evaluateBands(0.01, noLower).currentBand?.actionLabel).toBe("静観");
  });

  it("隙間が残ると判定不能になる（だから保存時に埋める必要がある）", () => {
    /*
     * 195〜309.99 の下限を 250 に上げると 210〜250 が空白になる。
     * この状態は「どの段にも当てはまらない」ため画面で判断が出せない。
     * サーバーの updateBand は保存後に隣接段を詰めてこの状態を解消する。
     * ここでは「埋めなければ判定できない」ことを明示しておく。
     */
    const bands = [band(1, 250, 309.99, "静観"), band(2, 150, 210, "打診買い")];
    const r = evaluateBands(222.02, bands);
    expect(r.currentBand).toBeNull();
    expect(r.abovePlan).toBe(false);
    expect(r.belowPlan).toBe(false);
  });

  it("隙間を埋めた形なら、境界のすぐ下の価格でも下の段で判定できる", () => {
    // 下の段の上限を上の段の下限の直下（249.99）まで引き上げた状態
    const bands = [band(1, 250, 309.99, "静観"), band(2, 150, 249.99, "打診買い")];
    expect(evaluateBands(222.02, bands).currentBand?.actionLabel).toBe("打診買い");
    // 境界そのもの
    expect(evaluateBands(250, bands).currentBand?.actionLabel).toBe("静観");
    expect(evaluateBands(249.99, bands).currentBand?.actionLabel).toBe("打診買い");
  });

  it("重なりが残ると高い段が優先され、意図しない判定になる", () => {
    /*
     * 上限を上げすぎて重なった場合（250〜309.99 と 150〜260）、
     * 255 は両方に当てはまる。高い順に評価するため「静観」が勝つ。
     * 重なりも保存時に解消する必要がある理由。
     */
    const bands = [band(1, 250, 309.99, "静観"), band(2, 150, 260, "打診買い")];
    expect(evaluateBands(255, bands).currentBand?.actionLabel).toBe("静観");
  });
});
