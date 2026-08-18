/**
 * 候補提案の目標価格の補正のテスト。
 *
 * 実測で AMAT に現在値 $505.99 に対し $165（-67.4%）が返り、
 * そのまま登録すると「待っている」つもりで実質「買わない」状態になった。
 * 入り口で補正されることを確かめる。
 */
import { describe, expect, it } from "vitest";
import { resolveTargetPrice } from "../server/services/candidateService";

describe("resolveTargetPrice", () => {
  it("現実的な範囲の目標価格はそのまま通す", () => {
    // O（リアルティ・インカム）実測: $62.31 → $54（-13.3%）
    const r = resolveTargetPrice(54, 62.31);
    expect(r.targetPrice).toBe(54);
    expect(r.gapPct).toBeCloseTo(-13.34, 1);
    expect(r.note).toBeNull();
  });

  it("-30% 手前は補正しない", () => {
    /*
     * -20% 台の調整は数年単位で見れば実際に起きる。
     * 機械的に書き換えると意図した慎重さを壊す。
     */
    const r = resolveTargetPrice(72, 100);
    expect(r.targetPrice).toBe(72);
    expect(r.note).toBeNull();
  });

  it("遠すぎる目標価格は現在値の 25% 下に引き上げる", () => {
    // AMAT 実測: $505.99 に対し $165（-67.4%）
    const r = resolveTargetPrice(165, 505.99);
    expect(r.targetPrice).toBeCloseTo(379.49, 1);
    expect(r.gapPct).toBe(-25);
    expect(r.note).toContain("67.4%");
    expect(r.note).toContain("25% 下");
  });

  it("補正したことを必ず説明に残す", () => {
    /*
     * 黙って書き換えると、後から見たときに AI が出した値段なのか
     * システムが直した値段なのか分からず、数字を信用できなくなる。
     */
    const r = resolveTargetPrice(13.5, 30.95);
    expect(r.note).not.toBeNull();
    expect(r.note).toContain("56.4%");
  });

  it("ちょうど -30% は補正の対象にする", () => {
    /*
     * 境目は「遠すぎる」に含める。-30% は待つには遠すぎるという
     * 判断がウォッチリスト側と揃っている必要がある。
     */
    const r = resolveTargetPrice(70, 100);
    expect(r.targetPrice).toBe(75);
    expect(r.gapPct).toBe(-25);
  });

  it("現在値以上の目標は 8% 下に補正する（従来の挙動を維持）", () => {
    const r = resolveTargetPrice(120, 100);
    expect(r.targetPrice).toBe(92);
    expect(r.gapPct).toBe(-8);
    expect(r.note).toContain("現在値以上");
  });

  it("目標価格が無い場合は 8% 下を暫定値にする（従来の挙動を維持）", () => {
    const r = resolveTargetPrice(null, 100);
    expect(r.targetPrice).toBe(92);
    expect(r.note).toContain("暫定");
  });

  it("現在値が取れない場合は補正しない", () => {
    /*
     * 現在値がなければ距離が測れない。推測で書き換えるより
     * AI の値をそのまま残して本人に判断させる。
     */
    const r = resolveTargetPrice(165, null);
    expect(r.targetPrice).toBe(165);
    expect(r.gapPct).toBeNull();
    expect(r.note).toBeNull();
  });
});
