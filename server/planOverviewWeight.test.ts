import { describe, expect, it } from "vitest";
import { computeOverviewStats } from "./services/priceBandService";

/**
 * 買い増しプラン一覧に出す「構成比」の検証。
 *
 * この数字を出す狙いは、買い増し圏に複数の銘柄が並んだときに
 * どれを優先すべきかを判断できるようにすること。
 * 実測（2026/8/18）では買い増し圏 5 銘柄のうち
 * 伊藤忠商事が 1.69%（上位 10 平均 2.94% に近い）で、
 * ナイキ 0.60% / OLC 0.10% は 112 銘柄平均 0.89% 以下だった。
 * つまり「伊藤忠は既に十分持っている、ナイキと OLC はまだ小さい」
 * という判断ができる。この比較の土台が壊れないことを確かめる。
 */
describe("構成比の目安", () => {
  it("全銘柄平均と上位 10 銘柄平均をそれぞれ出す", () => {
    // 上位が偏った分布。平均だけ見ると小さく見えるが上位は大きい
    const rows = Array.from({ length: 20 }, (_, i) => ({
      weightPct: i < 3 ? 10 : 1,
    }));
    const stats = computeOverviewStats(rows as never);
    // 3 銘柄 × 10% + 17 銘柄 × 1% = 47% を 20 で割る
    expect(stats.avgWeightPct).toBeCloseTo(2.35, 2);
    // 上位 10 は 10,10,10,1,1,1,1,1,1,1 = 37 を 10 で割る
    expect(stats.topAvgWeightPct).toBeCloseTo(3.7, 2);
    // 上位平均が全体平均より大きいことが「偏りがある」証拠になる
    expect(stats.topAvgWeightPct).toBeGreaterThan(stats.avgWeightPct);
  });

  it("構成比が取れない銘柄は平均の計算から外す", () => {
    // 株価が未取得だと構成比が出せない。これを 0 として混ぜると
    // 平均が実態より低くなり「まだ小さい」と誤判断させてしまう
    const rows = [{ weightPct: 2 }, { weightPct: null }, { weightPct: 4 }];
    const stats = computeOverviewStats(rows as never);
    expect(stats.avgWeightPct).toBeCloseTo(3, 5);
    expect(stats.symbolCount).toBe(2);
  });

  it("構成比が 1 件も取れないときは 0 ではなく null を返す", () => {
    // 0% と「分からない」は意味が違う。0 を返すと画面に「平均 0.0%」と
    // 出てしまい、実際には計算できていないことが伝わらない
    const stats = computeOverviewStats([{ weightPct: null }] as never);
    expect(stats.avgWeightPct).toBeNull();
    expect(stats.topAvgWeightPct).toBeNull();
    expect(stats.symbolCount).toBe(0);
  });
});
