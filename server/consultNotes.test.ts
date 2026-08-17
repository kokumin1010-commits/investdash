/**
 * 相談 AI が銘柄の経緯（メモ）を踏まえて答えるための受け渡しを検証する。
 *
 * 渡し漏れは実際に起きた（借入金利・現金利回りを渡しておらず、AI が
 * 「提示された情報からは確認できません」と答えていた）。同じ種類の
 * 抜けを防ぐため、プロンプトに現れることをテストで固定する。
 */
import { describe, expect, it } from "vitest";
import { buildHistoryText } from "./services/consultAdvisor";
import type { ConsultContext } from "./services/consultContext";

function baseCtx(overrides: Partial<ConsultContext> = {}): ConsultContext {
  return {
    totalValueJpy: 860_000_000,
    cashJpy: 94_000_000,
    borrowedJpy: 227_000_000,
    netAssetsJpy: 632_000_000,
    leverage: 1.36,
    usdJpyRate: 159.31,
    annualDividendJpy: 20_033_968,
    dividendYieldPct: 2.4,
    annualInterestJpy: 3_934_238,
    borrowRatePct: 1.73,
    interestAssetsJpy: 88_610_000,
    interestIncomeJpy: 3_060_000,
    interestRatePct: 3.46,
    carrySpreadPct: 1.73,
    brokerLeverage: [],
    positionCount: 112,
    sectors: [],
    markets: [],
    topHoldings: [],
    focus: null,
    focusSymbol: "8058.T",
    addZone: [],
    focusNews: [],
    pastConsults: [],
    focusNotes: [],
    focusCard: null,
    adviceRecord: { judged: 0, correct: 0, wrong: 0, byStance: [], symbolHistory: [] },
    builtAt: new Date("2026-08-18T00:00:00Z").toISOString(),
    ...overrides,
  } as ConsultContext;
}

describe("相談 AI への経緯の受け渡し", () => {
  it("決算・ニュース・判定変化を種類付きで渡す", () => {
    const text = buildHistoryText(
      baseCtx({
        focusNotes: [
          {
            occurredAt: "2026-08-03T00:00:00Z",
            kind: "EARNINGS",
            headline: "三菱商事、4─6月期純利益47％増 上方修正の余地探る",
            detail: "第1四半期の純利益が前年同期比47％増",
            importance: 75,
          },
          {
            occurredAt: "2026-08-17T00:00:00Z",
            kind: "BAND",
            headline: "買い増しプランの判定が「記録なし」から「現水準では静観」に変わった",
            detail: "そのときの株価: 4,714",
            importance: 40,
          },
        ],
      })
    );
    expect(text).not.toBeNull();
    expect(text).toContain("【決算】");
    expect(text).toContain("47％増");
    expect(text).toContain("【買い増し判定の変化】");
    // 日付を添えないと、当時の話か今の話か区別できない
    expect(text).toContain("2026-08-03");
  });

  it("事実の変化と株価が動いただけの出来事を区別させる指示を入れる", () => {
    const text = buildHistoryText(
      baseCtx({
        focusNotes: [
          {
            occurredAt: "2026-08-03T00:00:00Z",
            kind: "EARNINGS",
            headline: "決算の見出し",
            detail: null,
            importance: 70,
          },
        ],
      })
    );
    expect(text).toContain("区別して判断");
  });

  it("経緯が無い銘柄では経緯の節を作らない（空の節を根拠にされる）", () => {
    const text = buildHistoryText(baseCtx({ focusNotes: [] }));
    expect(text === null || !text.includes("起きてきたこと")).toBe(true);
  });

  it("投資カード・過去の相談と併記しても互いを壊さない", () => {
    const text = buildHistoryText(
      baseCtx({
        focusCard: {
          coreThesis: "資源と非資源の両輪",
          exitConditions: "配当 110 円割れ",
          risks: "資源価格の下落",
          valuationAssumption: "取得単価 3,593 円",
        },
        pastConsults: [
          {
            askedAt: "2026/8/17",
            question: "今から買い増してよいか",
            answerHead: "結論：静観が基本です",
          },
        ],
        focusNotes: [
          {
            occurredAt: "2026-08-03T00:00:00Z",
            kind: "EARNINGS",
            headline: "純利益47％増",
            detail: null,
            importance: 75,
          },
        ],
      })
    );
    expect(text).toContain("投資カード");
    expect(text).toContain("過去にした相談");
    expect(text).toContain("起きてきたこと");
  });
});
