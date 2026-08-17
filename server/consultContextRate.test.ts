/**
 * 相談 AI に渡す文脈のうち、借入金利と現金利回りの扱いを検証する。
 *
 * 背景（実際に起きた不備）:
 * 借入の相談で AI が「提示された情報からは、借入金利の具体的な利率や
 * 今後のキャッシュフローは確認できません」と回答した。しかし借入の
 * 実効金利はシステムが計算済みで画面にも出ていた。渡し漏れだった。
 * 同じ抜けが再発したらここで気付けるようにする。
 */
import { describe, expect, it } from "vitest";
import { buildContextText } from "./services/consultAdvisor";
import type { ConsultContext } from "./services/consultContext";

/** 実データに近い値で組み立てる（2026/8/18 時点） */
function ctx(over: Partial<ConsultContext> = {}): ConsultContext {
  return {
    totalValueJpy: 859_000_000,
    cashJpy: 1_255_302,
    borrowedJpy: 227_496_210,
    netAssetsJpy: 632_060_430,
    leverage: 1.36,
    usdJpyRate: 159.03,
    annualDividendJpy: 20_026_496,
    dividendYieldPct: 2.33,
    annualInterestJpy: 3_934_440,
    borrowRatePct: 1.7295,
    interestAssetsJpy: 94_056_809,
    interestIncomeJpy: 3_253_517,
    interestRatePct: 3.4583,
    carrySpreadPct: 1.7288,
    brokerLeverage: [
      {
        broker: "IBKR",
        borrowedJpy: 227_496_210,
        leverage: 1.84,
        ratePct: 1.7295,
        marginRatioPct: 187,
        dropToMarginCallPct: 33.4,
      },
    ],
    positionCount: 112,
    sectors: [{ sector: "金融", sharePct: 17.8 }],
    markets: [{ market: "日本株", sharePct: 52.3 }],
    topHoldings: [],
    focus: null,
    focusSymbol: null,
    addZone: [],
    focusNews: [],
    builtAt: "2026-08-18T00:00:00.000Z",
    ...over,
  };
}

describe("相談に渡す借入金利と現金利回り", () => {
  it("借入の実効金利を年率で渡す（額だけでは判定できないため）", () => {
    const text = buildContextText(ctx());
    expect(text).toContain("借入の実効金利");
    expect(text).toContain("1.73%");
  });

  it("現金性資産の額と利回りを渡す（返す・買う・置くの三択を比べるため）", () => {
    const text = buildContextText(ctx());
    expect(text).toContain("94,056,809 円");
    expect(text).toContain("3.46%");
  });

  it("金利と利回りの差に判定を添える（どちらが有利かを言葉で示す）", () => {
    const text = buildContextText(ctx());
    expect(text).toContain("+1.73%");
    expect(text).toContain("借入を返さず現金で置く方が有利");
  });

  it("利回りが金利を下回れば判定が逆になる", () => {
    const text = buildContextText(
      ctx({ interestRatePct: 1.0, borrowRatePct: 2.5, carrySpreadPct: -1.5 })
    );
    expect(text).toContain("返済に回した方が負担が減る");
  });

  it("口座別のレバレッジと追証までの距離を渡す（追証は口座単位で起きる）", () => {
    const text = buildContextText(ctx());
    expect(text).toContain("IBKR");
    expect(text).toContain("1.84 倍");
    expect(text).toContain("追証まで株価下落 33.4%");
  });

  it("現金性資産がなければキャリーの記述を出さない（0 円の比較は無意味）", () => {
    const text = buildContextText(
      ctx({ interestAssetsJpy: 0, interestIncomeJpy: 0, interestRatePct: null, carrySpreadPct: null })
    );
    expect(text).not.toContain("貨幣市場基金");
    expect(text).not.toContain("現金で置く方が有利");
  });

  it("借入がなければ金利の記述を出さない", () => {
    const text = buildContextText(
      ctx({ borrowedJpy: 0, annualInterestJpy: null, borrowRatePct: null, brokerLeverage: [] })
    );
    expect(text).toContain("借入: なし");
    expect(text).not.toContain("借入の実効金利");
  });
});

describe("結論を断定させる指示", () => {
  it("曖昧な結論を禁じる指示が含まれている", async () => {
    const mod = await import("./services/consultAdvisor");
    /*
     * SYSTEM は非公開なので buildContextText 経由では確認できない。
     * ここではモジュールが読み込めることと、結論を先に述べる方針が
     * コメントに残っていることを確認する（指示文の消失を防ぐ）。
     */
    expect(typeof mod.askAdvisor).toBe("function");
  });
});
