import { describe, it, expect } from "vitest";

/**
 * 借入の実効金利（加重平均）の計算。
 *
 * ダッシュボードの borrowingRatePct と同じ計算をここで検証する。
 * 現金性資産（現金宝）の利回りと比べて「借入を返すべきか、現金で置いておくべきか」を
 * 判断するために使うので、間違えると逆の結論になる。
 */
function weightedBorrowingRatePct(
  entries: { effectiveRatePct: number; borrowed: number }[],
): number | null {
  let weighted = 0;
  let borrowed = 0;
  for (const e of entries) {
    if (e.borrowed <= 0) continue;
    weighted += e.effectiveRatePct * e.borrowed;
    borrowed += e.borrowed;
  }
  return borrowed > 0 ? weighted / borrowed : null;
}

describe("借入の実効金利（加重平均）", () => {
  it("借入が 1 口座だけならその金利をそのまま返す", () => {
    // IBKR のみ借入がある実際の構成
    const r = weightedBorrowingRatePct([
      { effectiveRatePct: 1.7295, borrowed: 227_353_764 },
    ]);
    expect(r).toBeCloseTo(1.7295, 4);
  });

  it("借入がなければ null（0 で割らない）", () => {
    expect(weightedBorrowingRatePct([])).toBeNull();
    expect(weightedBorrowingRatePct([{ effectiveRatePct: 5, borrowed: 0 }])).toBeNull();
  });

  /*
   * 単純平均だと少額の借入の高金利が過大に効いてしまう。
   * 例: 2.3 億円を 1.73% + 100 万円を 8% で借りている場合、
   * 単純平均は 4.865% だが実態は 1.758%。3 倍近くずれる。
   */
  it("金額で重み付けする（単純平均だと少額の高金利が過大に効く）", () => {
    const entries = [
      { effectiveRatePct: 1.73, borrowed: 227_000_000 },
      { effectiveRatePct: 8.0, borrowed: 1_000_000 },
    ];
    const weighted = weightedBorrowingRatePct(entries)!;
    const naive = (1.73 + 8.0) / 2;

    expect(weighted).toBeCloseTo(1.7575, 3);
    expect(naive).toBeCloseTo(4.865, 3);
    // 単純平均は実態の 2.7 倍以上になってしまう
    expect(naive / weighted).toBeGreaterThan(2.7);
  });

  it("金額が同じなら単純平均と一致する", () => {
    const r = weightedBorrowingRatePct([
      { effectiveRatePct: 2.0, borrowed: 1_000_000 },
      { effectiveRatePct: 4.0, borrowed: 1_000_000 },
    ]);
    expect(r).toBeCloseTo(3.0, 6);
  });

  it("マイナスの借入額（データ不整合）は無視する", () => {
    const r = weightedBorrowingRatePct([
      { effectiveRatePct: 1.73, borrowed: 227_000_000 },
      { effectiveRatePct: 99, borrowed: -5_000_000 },
    ]);
    expect(r).toBeCloseTo(1.73, 4);
  });
});

describe("現金性資産の利回りと借入金利の比較", () => {
  /**
   * どちらが有利かの判定。
   * 現金性資産の利回りが借入金利以上なら、借入を返さず現金で置いておく方が得。
   */
  function shouldKeepCash(interestRatePct: number, borrowingRatePct: number): boolean {
    return interestRatePct >= borrowingRatePct;
  }

  it("実際の構成では現金で置いておく方が有利（3.46% > 1.73%）", () => {
    expect(shouldKeepCash(3.4583, 1.7295)).toBe(true);
  });

  it("借入金利が上回れば返済に回す方が有利", () => {
    expect(shouldKeepCash(1.5, 3.0)).toBe(false);
  });

  it("同率なら現金で置いておく側に倒す（返済すると再度借りる手間が生じるため）", () => {
    expect(shouldKeepCash(2.0, 2.0)).toBe(true);
  });

  /*
   * 差額がいくらになるかも出せるようにする。
   * 5.91 億円の現金性資産のうち借入 2.27 億円に相当する部分は、
   * 金利差 1.73 ポイント分だけ得をしている。
   */
  it("金利差から年間の得失額を計算できる", () => {
    const cash = 94_078_579; // 現金性資産（円）
    const spreadPct = 3.4583 - 1.7295;
    const gain = cash * (spreadPct / 100);
    // 年間 約 163 万円 の差
    expect(Math.round(gain)).toBe(1_626_430);
    expect(gain).toBeGreaterThan(0);
  });
});
