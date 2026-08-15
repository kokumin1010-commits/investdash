import { describe, expect, it } from "vitest";
import { computePeriodChange } from "./services/periodChange";

/**
 * 長期保有では前日比が判断材料にならないため「前回記録からの変化」を出す。
 * 最も重要なのは、銘柄を追加しただけの増加を「儲け」と誤認しないこと。
 */
describe("computePeriodChange", () => {
  const snap = (daysAgo: number, value: number, cost: number, count = 10) => ({
    totalValue: value,
    totalCost: cost,
    positionCount: count,
    capturedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  });

  it("記録が 1 件以下なら null を返す", () => {
    expect(computePeriodChange([])).toBeNull();
    expect(computePeriodChange([snap(0, 100, 80)])).toBeNull();
  });

  it("構成が変わっていなければ株価変動分を算出する", () => {
    // 30 日前: 評価 1,000 / 原価 800 → 今: 評価 1,200 / 原価 800
    const result = computePeriodChange([snap(0, 1200, 800), snap(30, 1000, 800)])!;
    expect(result.compositionChanged).toBe(false);
    expect(result.totalDelta).toBe(200);
    expect(result.costDelta).toBe(0);
    expect(result.gainDelta).toBe(200);
    expect(result.gainPct).toBeCloseTo(20, 5);
    expect(result.days).toBe(30);
  });

  it("銘柄が増えた期間は株価変動分を出さない", () => {
    /*
     * 追加した銘柄が元々含み益を持っていると、その含み益が
     * 「この期間に上がった分」として混入する。分離できないため null にする。
     */
    const result = computePeriodChange([
      snap(0, 3000, 2000, 20),
      snap(30, 1000, 800, 10),
    ])!;
    expect(result.compositionChanged).toBe(true);
    expect(result.gainDelta).toBeNull();
    expect(result.gainPct).toBeNull();
    expect(result.countDelta).toBe(10);
    // 合計の増減自体は出す
    expect(result.totalDelta).toBe(2000);
  });

  it("銘柄数が同じでも買い増しがあれば株価変動分を出さない", () => {
    const result = computePeriodChange([snap(0, 1500, 1000, 10), snap(30, 1000, 800, 10)])!;
    expect(result.compositionChanged).toBe(true);
    expect(result.gainDelta).toBeNull();
  });

  it("わずかな計算誤差は構成変化とみなさない", () => {
    // 為替換算や小数株で生じる程度の差（0.01%未満）は無視する
    const result = computePeriodChange([snap(0, 1200, 800.05), snap(30, 1000, 800)])!;
    expect(result.compositionChanged).toBe(false);
    expect(result.gainDelta).not.toBeNull();
  });

  it("直近と近すぎる記録は比較対象にしない", () => {
    /*
     * 株価更新は 1 日に複数回走る。直前の記録と比べると「数分前との差」になり
     * 意味がないため、既定 20 時間以上離れた記録を選ぶ。
     */
    const now = Date.now();
    const at = (h: number) => new Date(now - h * 60 * 60 * 1000);
    const result = computePeriodChange([
      { totalValue: 1200, totalCost: 800, positionCount: 10, capturedAt: at(0) },
      { totalValue: 1190, totalCost: 800, positionCount: 10, capturedAt: at(1) },
      { totalValue: 1000, totalCost: 800, positionCount: 10, capturedAt: at(720) },
    ])!;
    // 1 時間前ではなく 720 時間（30日）前と比較する
    expect(result.gainDelta).toBe(200);
    expect(result.days).toBe(30);
  });

  it("すべて同日中の記録なら最も古いものと比較する", () => {
    const now = Date.now();
    const at = (h: number) => new Date(now - h * 60 * 60 * 1000);
    const result = computePeriodChange([
      { totalValue: 1200, totalCost: 800, positionCount: 10, capturedAt: at(0) },
      { totalValue: 1000, totalCost: 800, positionCount: 10, capturedAt: at(3) },
    ])!;
    expect(result.gainDelta).toBe(200);
    expect(result.days).toBe(0);
  });

  it("入力の並び順に依存しない", () => {
    const asc = computePeriodChange([snap(30, 1000, 800), snap(0, 1200, 800)])!;
    const desc = computePeriodChange([snap(0, 1200, 800), snap(30, 1000, 800)])!;
    expect(asc.gainDelta).toBe(desc.gainDelta);
    expect(asc.days).toBe(desc.days);
  });

  it("評価額が減った場合も負の値で返す", () => {
    const result = computePeriodChange([snap(0, 900, 800), snap(30, 1000, 800)])!;
    expect(result.gainDelta).toBe(-100);
    expect(result.gainPct).toBeCloseTo(-10, 5);
  });

  it("前回評価額が 0 なら変化率を null にする", () => {
    const result = computePeriodChange([snap(0, 1000, 0), snap(30, 0, 0)])!;
    expect(result.gainPct).toBeNull();
  });
});
