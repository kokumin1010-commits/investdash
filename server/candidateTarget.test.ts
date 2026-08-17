/**
 * 候補銘柄の「買いたい値段」の妥当性検証のテスト。
 *
 * ここが壊れると、現在値と同じか高い値段が「買いたい値段」として出てしまう。
 * それでは待って買う意味がなく、機会損失を防ぐという本来の目的を果たせない。
 */
import { describe, it, expect } from "vitest";
import { resolveTargetPrice } from "./services/candidateService";

describe("買いたい値段の妥当性検証", () => {
  it("現在値より下の値段はそのまま採用し、下落率を計算する", () => {
    const r = resolveTargetPrice(142, 200);
    expect(r.targetPrice).toBe(142);
    expect(r.gapPct).toBe(-29);
    expect(r.note).toBeNull();
  });

  it("現在値と同じ値段は待つ意味がないため補正する", () => {
    const r = resolveTargetPrice(200, 200);
    expect(r.targetPrice).toBe(184);
    expect(r.gapPct).toBe(-8);
    expect(r.note).toContain("補正");
  });

  it("現在値より高い値段は補正し、元の提示額を注記に残す", () => {
    const r = resolveTargetPrice(158, 144.55);
    expect(r.targetPrice).toBeCloseTo(132.99, 2);
    expect(r.gapPct).toBe(-8);
    expect(r.note).toContain("158");
  });

  it("AI が値段を返さなかった場合も暫定値を出して行が消えないようにする", () => {
    const r = resolveTargetPrice(null, 100);
    expect(r.targetPrice).toBe(92);
    expect(r.note).toContain("返さなかった");
  });

  it("0 や負の値は無効として扱う", () => {
    expect(resolveTargetPrice(0, 100).targetPrice).toBe(92);
    expect(resolveTargetPrice(-50, 100).targetPrice).toBe(92);
  });

  it("NaN や Infinity を渡しても壊れない", () => {
    expect(resolveTargetPrice(NaN, 100).targetPrice).toBe(92);
    expect(resolveTargetPrice(Infinity, 100).targetPrice).toBe(92);
  });

  it("現在値が取得できない場合は補正せず、AI の値をそのまま返す", () => {
    const r = resolveTargetPrice(142, null);
    expect(r.targetPrice).toBe(142);
    expect(r.gapPct).toBeNull();
    expect(r.note).toBeNull();
  });

  it("現在値が 0 以下の異常値でも補正処理に入らない", () => {
    const r = resolveTargetPrice(142, 0);
    expect(r.targetPrice).toBe(142);
    expect(r.gapPct).toBeNull();
  });

  it("小数の株価（SGD の REIT など）でも 2 桁に丸める", () => {
    const r = resolveTargetPrice(1.02, 1.01);
    expect(r.targetPrice).toBe(0.93);
    expect(r.note).toContain("1.02");
  });

  it("補正後の値は必ず現在値より低い", () => {
    for (const price of [1.01, 10, 78.4, 144.55, 3751, 20000]) {
      const r = resolveTargetPrice(price * 1.5, price);
      expect(r.targetPrice).toBeLessThan(price);
    }
  });
});
