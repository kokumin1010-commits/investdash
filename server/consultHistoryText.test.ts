/**
 * 過去の判断（投資カード・過去の相談）を相談 AI に渡す部分を検証する。
 *
 * ここが壊れると、同じ銘柄について毎回ゼロから判断することになり、
 * 同じ質問に違う答えが返る。蓄積が効かなくなるので回帰を検知する。
 */
import { describe, expect, it } from "vitest";
import { buildHistoryText } from "./services/consultAdvisor";
import type { ConsultContext } from "./services/consultContext";

function ctx(over: Partial<ConsultContext> = {}): ConsultContext {
  return {
    totalValueJpy: 0,
    cashJpy: 0,
    borrowedJpy: 0,
    netAssetsJpy: 0,
    leverage: null,
    usdJpyRate: null,
    annualDividendJpy: 0,
    dividendYieldPct: null,
    annualInterestJpy: null,
    borrowRatePct: null,
    interestAssetsJpy: 0,
    interestIncomeJpy: 0,
    interestRatePct: null,
    carrySpreadPct: null,
    brokerLeverage: [],
    positionCount: 0,
    sectors: [],
    markets: [],
    topHoldings: [],
    focus: null,
    focusSymbol: "8058.T",
    addZone: [],
    focusNews: [],
    pastConsults: [],
    focusCard: null,
    builtAt: "2026-08-18T00:00:00.000Z",
    ...over,
  };
}

describe("過去の判断を渡す", () => {
  it("記録が何もなければ渡さない（空の見出しだけ渡すと記載ありと誤解される）", () => {
    expect(buildHistoryText(ctx())).toBeNull();
  });

  it("投資カードの降りる条件を渡す", () => {
    const text = buildHistoryText(
      ctx({
        focusCard: {
          coreThesis: "資源価格と円安の恩恵",
          exitConditions: "年間配当が 110 円を下回る減配が決定された場合",
          risks: null,
          valuationAssumption: null,
        },
      })
    );
    expect(text).toContain("降りる条件");
    expect(text).toContain("110 円を下回る減配");
  });

  it("過去の相談は日付付きで渡す（いつの判断か分からないと比べられない）", () => {
    const text = buildHistoryText(
      ctx({
        pastConsults: [
          {
            askedAt: "2026-08-17",
            question: "[8058.T] 三菱商事を今から買い増してよいか",
            answerHead: "結論：現時点では「静観」が基本方針です",
          },
        ],
      })
    );
    expect(text).toContain("2026-08-17");
    expect(text).toContain("静観");
  });

  it("当時の株価と現在値を混同させないための注意を含む", () => {
    const text = buildHistoryText(
      ctx({
        pastConsults: [
          { askedAt: "2026-08-17", question: "買い増してよいか", answerHead: "4,714 円" },
        ],
      })
    );
    expect(text).toContain("古い株価が含まれる");
  });

  it("カードと相談の両方があれば両方渡す", () => {
    const text = buildHistoryText(
      ctx({
        focusCard: {
          coreThesis: "資源価格の恩恵",
          exitConditions: null,
          risks: "資源価格の下落",
          valuationAssumption: null,
        },
        pastConsults: [
          { askedAt: "2026-08-17", question: "買い増してよいか", answerHead: "静観" },
        ],
      })
    );
    expect(text).toContain("投資カード");
    expect(text).toContain("過去にした相談");
    expect(text).toContain("資源価格の下落");
  });
});
