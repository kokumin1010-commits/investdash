import { describe, expect, it } from "vitest";
import {
  buildTargetRevisePrompt,
  clampRevisedTarget,
  type TargetReviseContext,
} from "./services/targetReviser";

const BASE: TargetReviseContext = {
  symbol: "1605.T",
  name: "Inpex Corporation",
  currency: "JPY",
  sector: "Energy",
  industry: "Oil & Gas E&P",
  currentPrice: 3765,
  previousTarget: 1900,
  rangeHigh: 3980,
  rangeLow: 2410,
  return1mPct: 4.2,
  return3mPct: 18.6,
  annualDividend: 120,
  watchReason: "エネルギーセクターを補強し、累進配当で長期保有に適する",
  news: [],
};

describe("買いたい値段の丸め込み", () => {
  it("範囲内の値はそのまま使う（小数 2 桁に丸める）", () => {
    const r = clampRevisedTarget(3200.456, 3765);
    expect(r.targetPrice).toBe(3200.46);
    expect(r.adjustedNote).toBeNull();
  });

  it("現在値に近すぎる値は 2% 下へ寄せ、寄せたことを残す", () => {
    const r = clampRevisedTarget(3760, 3765);
    expect(r.targetPrice).toBeCloseTo(3689.7, 1);
    expect(r.adjustedNote).toContain("近すぎ");
  });

  it("現在値以上の値も 2% 下へ寄せる（待つ意味がなくなるため）", () => {
    const r = clampRevisedTarget(4200, 3765);
    expect(r.targetPrice).toBeLessThan(3765);
    expect(r.adjustedNote).toContain("4200");
  });

  it("離れすぎた値は 25% 下までに留める（遠すぎる状態に戻さない）", () => {
    const r = clampRevisedTarget(1900, 3765);
    expect(r.targetPrice).toBeCloseTo(2823.75, 2);
    expect(r.adjustedNote).toContain("離れすぎ");
  });

  it("25% 下ちょうどは丸めずそのまま通す", () => {
    const r = clampRevisedTarget(75, 100);
    expect(r.targetPrice).toBe(75);
    expect(r.adjustedNote).toBeNull();
  });

  it("無効な値は暫定値に置き換え、暫定であることを残す", () => {
    const zero = clampRevisedTarget(0, 3765);
    expect(zero.targetPrice).toBeCloseTo(3463.8, 1);
    expect(zero.adjustedNote).toContain("暫定");

    expect(clampRevisedTarget(Number.NaN, 100).targetPrice).toBe(92);
    expect(clampRevisedTarget(-50, 100).adjustedNote).toContain("暫定");
  });
});

describe("買いたい値段のプロンプト", () => {
  it("以前の目標が離れすぎている事実を渡す", () => {
    const p = buildTargetRevisePrompt(BASE);
    expect(p).toContain("1,900");
    expect(p).toContain("-49.5%"); // 小数 1 桁に揃えて渡す
    expect(p).toContain("離れすぎ");
  });

  it("現在値と直近レンジを渡す", () => {
    const p = buildTargetRevisePrompt(BASE);
    expect(p).toContain("3,765");
    expect(p).toContain("3,980");
    expect(p).toContain("2,410");
  });

  it("配当があれば現在値での利回りも計算して渡す", () => {
    const p = buildTargetRevisePrompt(BASE);
    // 120 / 3765 = 3.19%
    expect(p).toContain("3.19%");
  });

  it("無配なら利回りを根拠にしないよう明示する", () => {
    const p = buildTargetRevisePrompt({ ...BASE, annualDividend: null });
    expect(p).toContain("無配または未取得");
    expect(p).toContain("利回りを根拠にしないこと");
  });

  it("ニュースが無いことを明示して推測での補完を防ぐ", () => {
    const p = buildTargetRevisePrompt(BASE);
    expect(p).toContain("推測で補わないこと");
  });

  it("ニュースがあれば影響度付きで渡す", () => {
    const p = buildTargetRevisePrompt({
      ...BASE,
      news: [{ title: "原油価格が上昇", summary: "OPEC の減産", impactScore: 72 }],
    });
    expect(p).toContain("原油価格が上昇");
    expect(p).toContain("影響度 72");
  });

  it("目標が未設定の場合もその旨を渡す", () => {
    const p = buildTargetRevisePrompt({ ...BASE, previousTarget: null });
    expect(p).toContain("買いたい値段は未設定");
    expect(p).not.toContain("離れすぎ");
  });

  it("下限を超えないよう現在値を指示に含める", () => {
    const p = buildTargetRevisePrompt(BASE);
    expect(p).toContain("25% 以上は離さない");
  });
});
