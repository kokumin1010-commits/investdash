import { describe, expect, it } from "vitest";
import { buildSignalHistory, changePointsOnly } from "../shared/signalHistory";

/**
 * 実データ（双日 2768.T）で履歴の畳み込みと変化点の抽出を検証する。
 *
 * DB から返る 12 件をそのまま並べると、同じ判定が同じ分に 2 件入っている行が
 * 3 組あり「判断が何度も変わった」ように見える。畳み込み後に何件残り、
 * どこが変化点になるかを実データで固定する。
 */
const REAL_ROWS = [
  { id: 12, action: "ADD", price: 5423, at: "2026-08-19T19:49:00" },
  { id: 11, action: "ADD", price: 5655, at: "2026-08-18T22:46:10" },
  { id: 10, action: "ADD", price: 5655, at: "2026-08-18T22:46:40" },
  { id: 9, action: "HOLD", price: 5600, at: "2026-08-17T22:37:00" },
  { id: 8, action: "HOLD", price: 5600, at: "2026-08-17T22:36:00" },
  { id: 7, action: "HOLD", price: 5684, at: "2026-08-16T22:24:00" },
  { id: 6, action: "HOLD", price: 5684, at: "2026-08-16T22:23:00" },
  { id: 5, action: "HOLD", price: 5684, at: "2026-08-16T10:51:00" },
  { id: 4, action: "HOLD", price: 5684, at: "2026-08-15T22:21:00" },
  { id: 3, action: "HOLD", price: 5684, at: "2026-08-15T16:43:00" },
  { id: 2, action: "HOLD", price: 5684, at: "2026-08-15T16:25:00" },
  { id: 1, action: "WATCH", price: 5684, at: "2026-08-15T16:16:00" },
].map(r => ({
  id: r.id,
  action: r.action,
  confidence: 70,
  rationale: "実データの理由文",
  priceAtSignal: String(r.price),
  createdAt: new Date(r.at),
}));

/** 実際の現在値 */
const CURRENT = 5423;

describe("双日の実データでの履歴表示", () => {
  it("同じ分・同じ判定の重複だけが畳まれ、11 件になる", () => {
    /*
     * 8/18 22:46 の ADD 2 件は分が同じなので 1 件に畳まれる。
     * 8/17 の 22:37 と 22:36、8/16 の 22:24 と 22:23 は分が違うため残る。
     */
    const rows = buildSignalHistory(REAL_ROWS, CURRENT);
    expect(rows).toHaveLength(11);
  });

  it("変化点は 8/19 の ADD と 8/17 の HOLD の 2 件だけになる", () => {
    const points = changePointsOnly(buildSignalHistory(REAL_ROWS, CURRENT));
    expect(points.map(p => p.action)).toEqual(["ADD", "HOLD"]);
    // 何から変わったかも読めること
    expect(points[0].prevAction).toBe("HOLD");
    expect(points[1].prevAction).toBe("WATCH");
  });

  it("最新の判定は当時株価と現在値が同じなので値動き 0%", () => {
    const rows = buildSignalHistory(REAL_ROWS, CURRENT);
    expect(rows[0].priceChangePct).toBeCloseTo(0, 6);
  });

  it("8/18 の ADD は当時 5,655 円なので現在まで下落している", () => {
    const rows = buildSignalHistory(REAL_ROWS, CURRENT);
    const aug18 = rows.find(r => new Date(r.createdAt).getDate() === 18)!;
    expect(aug18.priceChangePct).toBeLessThan(0);
    expect(aug18.priceChangePct).toBeCloseTo(((5423 - 5655) / 5655) * 100, 6);
  });

  it("最古の WATCH は変化点にならない（比較対象がない）", () => {
    const rows = buildSignalHistory(REAL_ROWS, CURRENT);
    const oldest = rows[rows.length - 1];
    expect(oldest.action).toBe("WATCH");
    expect(oldest.changed).toBe(false);
    expect(oldest.prevAction).toBeNull();
  });

  it("並びは新しい順のまま保たれる", () => {
    const rows = buildSignalHistory(REAL_ROWS, CURRENT);
    for (let i = 1; i < rows.length; i++) {
      expect(new Date(rows[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(rows[i].createdAt).getTime()
      );
    }
  });
});
