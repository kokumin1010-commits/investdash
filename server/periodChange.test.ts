import { describe, expect, it } from "vitest";
import { computePeriodChange, DEFAULT_PERIOD_DAYS } from "./services/periodChange";

/**
 * 長期保有では前日比が判断材料にならないため「前回記録からの変化」を出す。
 *
 * 実運用で 2 つの不具合が出たため、その再発を防ぐテストを中心に置く。
 *   1. 記録が増えるほど比較先が近づき、毎回「1 日間」になっていた
 *   2. 為替で取得原価が動くだけで「売買があった」と誤判定していた
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
    const result = computePeriodChange([snap(0, 1200, 800), snap(7, 1000, 800)])!;
    expect(result.compositionChanged).toBe(false);
    expect(result.totalDelta).toBe(200);
    expect(result.costDelta).toBe(0);
    expect(result.gainDelta).toBe(200);
    expect(result.gainPct).toBeCloseTo(20, 5);
    expect(result.days).toBe(7);
  });

  it("銘柄が増えた期間は株価変動分を出さない", () => {
    /*
     * 追加した銘柄が元々含み益を持っていると、その含み益が
     * 「この期間に上がった分」として混入する。分離できないため null にする。
     */
    const result = computePeriodChange([snap(0, 3000, 2000, 20), snap(7, 1000, 800, 10)])!;
    expect(result.compositionChanged).toBe(true);
    expect(result.gainDelta).toBeNull();
    expect(result.gainPct).toBeNull();
    expect(result.countDelta).toBe(10);
    // 合計の増減自体は出す
    expect(result.totalDelta).toBe(2000);
  });

  it("為替で取得原価が動いても株価変動分を出す（実運用の不具合）", () => {
    /*
     * 取得原価は最新の為替で円換算しているため、売買していなくても
     * 為替が動くだけで変動する。実データでは 112 銘柄で一定なのに
     * 取得原価が 0.28% 動き、毎回「売買があった」と誤判定していた。
     *
     * 銘柄数が同じなら株価変動分を出す。
     */
    const result = computePeriodChange([
      snap(0, 849660301, 712461530, 112),
      snap(7, 811563777, 682982529, 112),
    ])!;
    expect(result.compositionChanged).toBe(false);
    expect(result.gainDelta).not.toBeNull();
    // 含み損益の差＝(849660301-712461530) - (811563777-682982529)
    expect(result.gainDelta).toBe(137198771 - 128581248);
  });

  it("記録が 1 日 2 回たまっていても 1 週間前と比べる（実運用の不具合）", () => {
    /*
     * 以前は「20 時間以上離れた最初の記録」を選んでいたため、
     * 1 日 2 回の記録があると必ず前日が選ばれ、
     * 何日経っても「1 日間」のままになっていた。
     */
    const now = Date.now();
    const at = (h: number) => new Date(now - h * 60 * 60 * 1000);
    const rows = [];
    // 7 日分・1 日 2 回（朝と夜）の記録を作る
    for (let d = 0; d <= 7; d += 1) {
      rows.push({
        totalValue: 1000 + d * 10,
        totalCost: 800,
        positionCount: 10,
        capturedAt: at(d * 24),
      });
      rows.push({
        totalValue: 1000 + d * 10 + 5,
        totalCost: 800,
        positionCount: 10,
        capturedAt: at(d * 24 + 9),
      });
    }
    const result = computePeriodChange(rows)!;
    expect(result.days).toBe(7);
    expect(result.fellShort).toBe(false);
  });

  it("狙った期間の記録がまだ無い場合は最古の記録を使い、その旨を示す", () => {
    const result = computePeriodChange([snap(0, 1200, 800), snap(2, 1000, 800)])!;
    expect(result.days).toBe(2);
    expect(result.targetDays).toBe(DEFAULT_PERIOD_DAYS);
    expect(result.fellShort).toBe(true);
  });

  it("狙った期間に近い記録があれば断りを入れない", () => {
    // 6 日前は 7 日の 8 割を超えるため fellShort にしない
    const result = computePeriodChange([snap(0, 1200, 800), snap(6, 1000, 800)])!;
    expect(result.days).toBe(6);
    expect(result.fellShort).toBe(false);
  });

  it("狙った時点に最も近い記録を選ぶ", () => {
    const result = computePeriodChange([
      snap(0, 1200, 800),
      snap(1, 1150, 800),
      snap(6, 1000, 800),
      snap(30, 500, 800),
    ])!;
    // 7 日を狙うので 6 日前（1 日前や 30 日前ではない）
    expect(result.days).toBe(6);
    expect(result.gainDelta).toBe(200);
  });

  it("比較する期間を指定できる", () => {
    const result = computePeriodChange(
      [snap(0, 1200, 800), snap(7, 1100, 800), snap(30, 1000, 800)],
      30
    )!;
    expect(result.days).toBe(30);
    expect(result.targetDays).toBe(30);
    expect(result.gainDelta).toBe(200);
  });

  it("入力の並び順に依存しない", () => {
    const asc = computePeriodChange([snap(7, 1000, 800), snap(0, 1200, 800)])!;
    const desc = computePeriodChange([snap(0, 1200, 800), snap(7, 1000, 800)])!;
    expect(asc.gainDelta).toBe(desc.gainDelta);
    expect(asc.days).toBe(desc.days);
  });

  it("評価額が減った場合も負の値で返す", () => {
    const result = computePeriodChange([snap(0, 900, 800), snap(7, 1000, 800)])!;
    expect(result.gainDelta).toBe(-100);
    expect(result.gainPct).toBeCloseTo(-10, 5);
  });

  it("前回評価額が 0 なら変化率を null にする", () => {
    const result = computePeriodChange([snap(0, 1000, 0), snap(7, 0, 0)])!;
    expect(result.gainPct).toBeNull();
  });

  it("同じ距離に 2 つ記録があれば古い側を選ぶ", () => {
    /*
     * 狙いより新しい側を採ると期間が短くなり、
     * 「1 週間の変化」と言いながら短い期間を見ることになる。
     */
    const result = computePeriodChange([
      snap(0, 1200, 800),
      snap(6, 1100, 800),
      snap(8, 1000, 800),
    ])!;
    expect(result.days).toBe(8);
  });

  it("狙った時点が登録作業中なら、銘柄数が揃った最古の記録と比べる", () => {
    /*
     * 実データでは 8/14〜8/16 に 75 → 103 → 107 → 112 と登録が進んでいた。
     * 1 週間前を狙うと必ず登録途中の記録に当たり、
     * 「値動きを分離できません」から抜け出せなかった。
     *
     * 登録作業は資産の増減ではないので、それが混じらない範囲で
     * 最も長く遡る方が「株価がいくら動いたか」に近い。
     */
    const result = computePeriodChange([
      snap(0, 1300, 800, 112),
      snap(2, 1250, 800, 112),
      snap(3, 1200, 800, 112),
      snap(6, 900, 700, 107),
      snap(7, 600, 500, 75),
    ])!;
    expect(result.usedSameCompositionFallback).toBe(true);
    expect(result.days).toBe(3);
    expect(result.compositionChanged).toBe(false);
    expect(result.gainDelta).toBe(100);
    // 狙いの 7 日より短いため断りを入れる
    expect(result.fellShort).toBe(true);
  });

  it("銘柄数が揃った記録が無ければ従来どおり分離しない", () => {
    const result = computePeriodChange([snap(0, 1300, 800, 112), snap(7, 600, 500, 75)])!;
    expect(result.usedSameCompositionFallback).toBe(false);
    expect(result.compositionChanged).toBe(true);
    expect(result.gainDelta).toBeNull();
  });

  it("狙った時点の銘柄数が今と同じなら遡り先を変えない", () => {
    const result = computePeriodChange([
      snap(0, 1300, 800, 112),
      snap(3, 1200, 800, 112),
      snap(7, 1000, 800, 112),
    ])!;
    expect(result.usedSameCompositionFallback).toBe(false);
    expect(result.days).toBe(7);
    expect(result.fellShort).toBe(false);
  });
});
