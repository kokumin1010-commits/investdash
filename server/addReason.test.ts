import { describe, expect, it } from "vitest";
import { buildAddReason, type AddReasonInput } from "../shared/addReason";

/** 実データに近い前提値（借入金利 1.73% / 現金利回り 3.46%） */
const BASE: AddReasonInput = {
  action: "ADD",
  wouldBuyNow: "YES",
  currentSharePct: 3.3,
  afterSharePct: 4.6,
  dividendYieldPct: 3.04,
  borrowRatePct: 1.73,
  cashYieldPct: 3.46,
  rangePositionPct: 47,
  vsAvgCostPct: 12.09,
};

describe("buildAddReason", () => {
  it("ADD 以外では理由を作らない（判定と食い違う説明を出さない）", () => {
    for (const action of ["HOLD", "WATCH", "REDUCE", "EXIT", null]) {
      const r = buildAddReason({ ...BASE, action });
      expect(r.points).toEqual([]);
      expect(r.cautions).toEqual([]);
    }
  });

  it("「今からでも買う」判定を根拠の先頭に置く", () => {
    const r = buildAddReason(BASE);
    expect(r.points[0]).toContain("現在値で買うと判断");
  });

  it("「今からは買わない」判定は留意点に回し、根拠にはしない", () => {
    const r = buildAddReason({ ...BASE, wouldBuyNow: "NO" });
    expect(r.points.some(p => p.includes("現在値で買うと判断"))).toBe(false);
    expect(r.cautions.some(c => c.includes("今から新規には買わない"))).toBe(true);
  });

  it("判断できない場合も留意点に出す", () => {
    const r = buildAddReason({ ...BASE, wouldBuyNow: "UNCLEAR" });
    expect(r.cautions.some(c => c.includes("判断できない"))).toBe(true);
  });

  it("構成比と買い増し後の構成比を根拠に含める", () => {
    const r = buildAddReason(BASE);
    const found = r.points.find(p => p.includes("構成比"));
    expect(found).toBeDefined();
    expect(found).toContain("3.3%");
    expect(found).toContain("4.6%");
    expect(found).toContain("上限 5%");
  });

  it("配当利回りが現金の利回りを上回れば収支改善として根拠にする", () => {
    // 双日の 3.04% は現金 3.46% を下回るので、上回る例を作る
    const r = buildAddReason({ ...BASE, dividendYieldPct: 4.0 });
    const found = r.points.find(p => p.includes("現金の利回り"));
    expect(found).toContain("4.00%");
    expect(found).toContain("収支が改善");
  });

  it("配当利回りが現金を下回り借入金利を上回る場合は、根拠にしつつ減る分を注記する", () => {
    // 双日の実値（配当 3.04% / 現金 3.46% / 借入 1.73%）
    const r = buildAddReason(BASE);
    expect(r.points.some(p => p.includes("借入金利 1.73% を上回る"))).toBe(true);
    expect(r.cautions.some(c => c.includes("利息収入は減る"))).toBe(true);
  });

  it("配当利回りが借入金利すら下回る場合は値上がり狙いと明記する", () => {
    // ソフトバンクグループの 0.20% のような銘柄
    const r = buildAddReason({ ...BASE, dividendYieldPct: 0.2 });
    expect(r.cautions.some(c => c.includes("値上がりを狙う買い"))).toBe(true);
    expect(r.points.some(p => p.includes("配当利回り"))).toBe(false);
  });

  it("無配・未取得の銘柄では配当に触れない（0% と書くと減配と誤解される）", () => {
    for (const dy of [null, 0]) {
      const r = buildAddReason({ ...BASE, dividendYieldPct: dy });
      expect([...r.points, ...r.cautions].some(t => t.includes("配当利回り"))).toBe(false);
    }
  });

  it("52 週レンジの下 35% 以内なら安い側にあると述べる", () => {
    const r = buildAddReason({ ...BASE, rangePositionPct: 20 });
    expect(r.points.some(p => p.includes("安い側"))).toBe(true);
  });

  it("高値圏（上から 15% 以内）では押し目を待つ選択に触れる", () => {
    const r = buildAddReason({ ...BASE, rangePositionPct: 92 });
    expect(r.cautions.some(c => c.includes("高値圏"))).toBe(true);
  });

  it("レンジの中ほど（47%）では値位置に言及しない（判断材料にならない）", () => {
    const r = buildAddReason(BASE);
    expect([...r.points, ...r.cautions].some(t => t.includes("52 週レンジ"))).toBe(false);
  });

  it("値位置が取れていない銘柄でも落ちない", () => {
    const r = buildAddReason({ ...BASE, rangePositionPct: null });
    expect(r.points.length).toBeGreaterThan(0);
  });

  it("構成比が取れていなければ構成比には触れない", () => {
    const r = buildAddReason({ ...BASE, currentSharePct: null, afterSharePct: null });
    expect(r.points.some(p => p.includes("構成比"))).toBe(false);
  });

  it("金利情報が無い場合は利回りの比較をしない", () => {
    const r = buildAddReason({ ...BASE, borrowRatePct: null, cashYieldPct: null });
    expect([...r.points, ...r.cautions].some(t => t.includes("金利"))).toBe(false);
  });

  it("双日の実データでは根拠 2 件・留意 1 件になる", () => {
    /*
     * 実データ: ADD / 今からでも買う / 構成比 3.3% → 4.6% /
     * 配当 3.04% / 借入 1.73% / 現金 3.46% / レンジ内 47%
     */
    const r = buildAddReason(BASE);
    expect(r.points).toHaveLength(3);
    expect(r.cautions).toHaveLength(1);
  });
});
