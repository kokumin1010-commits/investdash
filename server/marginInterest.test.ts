import { describe, expect, it } from "vitest";
import {
  computeMarginInterest,
  evaluateCarry,
  IBKR_MARGIN_TIERS,
} from "./services/marginInterest";

describe("computeMarginInterest", () => {
  it("実際の借入 2.287 億円で階層別の加重平均を計算する", () => {
    /*
     * 実データ（2026-08-16 の IBKR 残高画面）: JPY -228,720,494.5
     * 手計算:
     *   1,100 万 × 2.330% = 256,300
     *   1 億 300 万 × 1.830% = 1,884,900
     *   1 億 1,472 万 0,494.5 × 1.580% = 1,812,583.8
     *   合計 3,953,783.8 → 加重平均 1.7286%
     */
    const r = computeMarginInterest(228_720_494.5, "JPY");
    expect(r).not.toBeNull();
    expect(r!.annualInterest).toBeCloseTo(3_953_783.8, 0);
    expect(r!.effectiveRatePct).toBeCloseTo(1.7286, 3);
    expect(r!.breakdown).toHaveLength(3);
    expect(r!.breakdown[0].amount).toBe(11_000_000);
    expect(r!.breakdown[1].amount).toBe(103_000_000);
    expect(r!.breakdown[2].amount).toBeCloseTo(114_720_494.5, 1);
  });

  it("最上位の利率で全額計算した場合より大きくなる（累進方式であることの確認）", () => {
    const r = computeMarginInterest(228_720_494.5, "JPY")!;
    // 全額を最下層の 1.580% で計算した場合
    const flat = 228_720_494.5 * 0.0158;
    expect(r.annualInterest).toBeGreaterThan(flat);
    // 差は約 34 万円。無視できない額であることを確認する
    expect(r.annualInterest - flat).toBeGreaterThan(300_000);
  });

  it("第 1 階層に収まる借入は単一の利率になる", () => {
    const r = computeMarginInterest(5_000_000, "JPY")!;
    expect(r.annualInterest).toBeCloseTo(5_000_000 * 0.0233, 2);
    expect(r.effectiveRatePct).toBeCloseTo(2.33, 6);
    expect(r.breakdown).toHaveLength(1);
  });

  it("階層の境界ぴったりでも重複や欠落が起きない", () => {
    const r = computeMarginInterest(11_000_000, "JPY")!;
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].amount).toBe(11_000_000);

    const r2 = computeMarginInterest(114_000_000, "JPY")!;
    const sum = r2.breakdown.reduce((s, b) => s + b.amount, 0);
    expect(sum).toBe(114_000_000);
  });

  it("借入額の合計が階層内訳の合計と必ず一致する", () => {
    for (const amount of [1, 10_999_999, 11_000_001, 113_999_999, 228_720_494.5, 6_000_000_000]) {
      const r = computeMarginInterest(amount, "JPY")!;
      const sum = r.breakdown.reduce((s, b) => s + b.amount, 0);
      expect(sum).toBeCloseTo(amount, 6);
    }
  });

  it("借入が無い・不正な値なら利息 0 を返す", () => {
    expect(computeMarginInterest(0, "JPY")!.annualInterest).toBe(0);
    expect(computeMarginInterest(-100, "JPY")!.annualInterest).toBe(0);
    expect(computeMarginInterest(NaN, "JPY")!.annualInterest).toBe(0);
  });

  it("階層定義が無い通貨は null（推測で計算しない）", () => {
    expect(computeMarginInterest(1_000_000, "EUR")).toBeNull();
    expect(computeMarginInterest(1_000_000, "HKD")).toBeNull();
  });

  it("通貨コードの大文字小文字と空白を許容する", () => {
    const a = computeMarginInterest(50_000_000, "jpy")!;
    const b = computeMarginInterest(50_000_000, " JPY ")!;
    expect(a.annualInterest).toBeCloseTo(b.annualInterest, 6);
  });

  it("階層テーブルは上限が昇順で欠けがない", () => {
    for (const [currency, tiers] of Object.entries(IBKR_MARGIN_TIERS)) {
      let prev = 0;
      for (const t of tiers) {
        if (t.upTo === null) continue;
        expect(t.upTo, `${currency} の階層が昇順でない`).toBeGreaterThan(prev);
        prev = t.upTo;
      }
      // 最後の階層は上限なし（借入額に制限を設けない）
      expect(tiers[tiers.length - 1].upTo, `${currency} に上限なしの階層がない`).toBeNull();
    }
  });
});

describe("evaluateCarry", () => {
  it("配当が金利を 1.2 倍以上上回れば POSITIVE", () => {
    const r = evaluateCarry(5_000_000, 4_000_000);
    expect(r.verdict).toBe("POSITIVE");
    expect(r.netCarryBase).toBe(1_000_000);
    expect(r.coverageRatio).toBeCloseTo(1.25, 6);
  });

  it("賄えているが余裕が小さければ THIN", () => {
    const r = evaluateCarry(4_200_000, 4_000_000);
    expect(r.verdict).toBe("THIN");
    expect(r.coverageRatio).toBeCloseTo(1.05, 6);
  });

  it("配当が金利に届かなければ NEGATIVE", () => {
    const r = evaluateCarry(3_000_000, 4_000_000);
    expect(r.verdict).toBe("NEGATIVE");
    expect(r.netCarryBase).toBe(-1_000_000);
    expect(r.coverageRatio).toBeCloseTo(0.75, 6);
  });

  it("借入が無ければ金利 0 で POSITIVE、比率は null", () => {
    const r = evaluateCarry(1_000_000, 0);
    expect(r.verdict).toBe("POSITIVE");
    expect(r.coverageRatio).toBeNull();
    expect(r.netCarryBase).toBe(1_000_000);
  });

  it("境界値 1.0 倍ちょうどは THIN（下回っていないため NEGATIVE にしない）", () => {
    const r = evaluateCarry(4_000_000, 4_000_000);
    expect(r.verdict).toBe("THIN");
    expect(r.netCarryBase).toBe(0);
  });

  it("境界値 1.2 倍ちょうどは POSITIVE", () => {
    const r = evaluateCarry(4_800_000, 4_000_000);
    expect(r.verdict).toBe("POSITIVE");
  });
});
