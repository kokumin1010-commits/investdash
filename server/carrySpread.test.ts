import { describe, expect, it } from "vitest";
import { computeCarrySpread } from "../shared/carrySpread";

/**
 * 借入金利と現金利回りの差の判定。
 *
 * 有利・不利が逆に出ても数字を見ただけでは気付きにくいため、
 * 実データの値（借入 1.73% / 現金 3.46% / 5.9 億円相当）で検証する。
 */

describe("借入金利と現金利回りの比較", () => {
  it("現金の利回りが金利を上回るなら有利と判定する", () => {
    const r = computeCarrySpread(1.73, 3.46, 94_225_718)!;

    expect(r.favorable).toBe(true);
    expect(r.spreadPct).toBeCloseTo(1.73, 10);
    // 94,225,718 × 1.73% = 1,630,105 円ほどの得
    expect(r.spreadAmountBase).toBeCloseTo(1_630_104.92, 0);
  });

  it("金利が利回りを上回るなら不利と判定し、金額も負になる", () => {
    const r = computeCarrySpread(5.0, 3.46, 94_225_718)!;

    expect(r.favorable).toBe(false);
    expect(r.spreadPct).toBeCloseTo(-1.54, 10);
    expect(r.spreadAmountBase).toBeLessThan(0);
  });

  it("同率のときは有利側に含める", () => {
    /*
     * 返済には手間と機会損失（現金の柔軟性を失う）が伴うため、
     * 損得が同じなら現金のまま置く判断が妥当。
     */
    const r = computeCarrySpread(3.46, 3.46, 100_000_000)!;

    expect(r.favorable).toBe(true);
    expect(r.spreadPct).toBe(0);
    expect(r.spreadAmountBase).toBe(0);
  });

  it("現金が無い場合は差の金額が 0 になる（率は保つ）", () => {
    const r = computeCarrySpread(1.73, 3.46, 0)!;

    // 率としては有利だが、置いている現金が無いので得られる額は 0
    expect(r.favorable).toBe(true);
    expect(r.spreadPct).toBeCloseTo(1.73, 10);
    expect(r.spreadAmountBase).toBe(0);
  });

  it("数値でない入力には null を返す（0 と混同しない）", () => {
    expect(computeCarrySpread(Number.NaN, 3.46, 100)).toBeNull();
    expect(computeCarrySpread(1.73, Number.NaN, 100)).toBeNull();
    expect(computeCarrySpread(1.73, 3.46, Number.NaN)).toBeNull();
  });

  it("借入金利が 0 でも計算できる（無利子の借入）", () => {
    const r = computeCarrySpread(0, 3.46, 10_000_000)!;

    expect(r.favorable).toBe(true);
    expect(r.spreadPct).toBeCloseTo(3.46, 10);
    expect(r.spreadAmountBase).toBeCloseTo(346_000, 0);
  });
});

