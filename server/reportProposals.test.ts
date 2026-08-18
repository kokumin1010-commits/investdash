/**
 * 週次レポートに買い増し提案と実績が載ることのテスト。
 *
 * 提案は画面を開いて押さないと目に入らなかった。レポートに載せることで
 * 押さなくても届くようにしたが、載せ方を誤ると「金額を AI が作り直す」
 * 「見送りで紙面が埋まる」といった問題が起きる。そこを固定する。
 */
import { describe, expect, it } from "vitest";
import { buildWeeklyPrompt } from "./services/reportWriter";
import type { DigestInput } from "./services/weeklyDigest";

const BASE: DigestInput = {
  periodStart: new Date("2026-08-11T00:00:00Z"),
  periodEnd: new Date("2026-08-18T00:00:00Z"),
  overview: {
    stockValueJpy: 860_000_000,
    borrowedJpy: 227_000_000,
    netAssetsJpy: 632_000_000,
    leverage: 1.36,
    annualDividendJpy: 20_000_000,
    holdingsCount: 156,
    interestAssetsJpy: 88_610_000,
  },
  buyZoneCount: 19,
  topics: [],
  proposals: [],
  adviceRecord: null,
  quietReason: null,
};

/** 実測で出ていた提案（買う 1 件・待つ 1 件） */
const PROPOSALS: DigestInput["proposals"] = [
  {
    symbol: "4661.T",
    name: "オリエンタルランド",
    stance: "BUY",
    conclusion: "取得単価を下げ、構成比を適正化するため、目安額の範囲内で買い増しを実行する。",
    amountJpy: 11_826_450,
    shares: 4100,
    limitPrice: 2884.5,
    currency: "JPY",
    waitAmountJpy: null,
    waitShares: null,
    ageDays: 1,
  },
  {
    symbol: "GOOGL",
    name: "アルファベット",
    stance: "WAIT",
    conclusion: "取得単価をわずかに上回る水準であり、プラン通り取得単価以下への調整を待つべきです。",
    amountJpy: null,
    shares: null,
    limitPrice: 342.65,
    currency: "USD",
    waitAmountJpy: 11_931_912,
    waitShares: 218,
    ageDays: 1,
  },
];

describe("レポートへの買い増し提案の載せ方", () => {
  it("買う銘柄の金額・株数・指値をそのまま渡す", () => {
    const p = buildWeeklyPrompt({ ...BASE, proposals: PROPOSALS });
    expect(p).toContain("オリエンタルランド");
    expect(p).toContain("¥11,826,450");
    expect(p).toContain("4,100 株");
    expect(p).toContain("指値 JPY 2,884.5");
  });

  it("待つ銘柄は到達時の金額と株数を渡す", () => {
    const p = buildWeeklyPrompt({ ...BASE, proposals: PROPOSALS });
    expect(p).toContain("USD 342.65 まで待つ");
    expect(p).toContain("届いたら ¥11,931,912");
    expect(p).toContain("218 株");
  });

  it("金額を AI に作り直させない指示を入れる", () => {
    const p = buildWeeklyPrompt({ ...BASE, proposals: PROPOSALS });
    // 与えた数字をそのまま書かせる指示があること
    expect(p).toMatch(/そのまま書き|変更しない/);
  });

  it("提案がある週は行動を先に書かせる", () => {
    const p = buildWeeklyPrompt({ ...BASE, proposals: PROPOSALS });
    expect(p).toContain("今週の行動");
  });

  it("提案が無い週は従来どおりの書き方を指示する", () => {
    const p = buildWeeklyPrompt({ ...BASE, topics: [] });
    expect(p).not.toContain("今週の行動");
    expect(p).toContain("特筆すべき動きはなく");
  });

  it("提案があれば銘柄の材料が無くても「材料なし」にしない", () => {
    // 判定変化やニュースが無くても、提案があるなら書くべきことがある
    const p = buildWeeklyPrompt({ ...BASE, topics: [], proposals: PROPOSALS });
    expect(p).not.toContain("特筆すべき動きはなく");
  });
});

describe("レポートへの実績の載せ方", () => {
  it("判定済みがあれば勝敗と内訳を渡す", () => {
    const p = buildWeeklyPrompt({
      ...BASE,
      proposals: PROPOSALS,
      adviceRecord: {
        judged: 4,
        correct: 3,
        wrong: 1,
        byStance: [
          { stance: "BUY", correct: 3, wrong: 0 },
          { stance: "HOLD", correct: 0, wrong: 1 },
        ],
      },
    });
    expect(p).toContain("3 勝 1 敗");
    expect(p).toContain("買い 3 勝 0 敗");
    expect(p).toContain("静観 0 勝 1 敗");
  });

  it("判定済みが無ければ実績の節を出さない", () => {
    // 0 勝 0 敗と書くと「実績がないから判断できない」という逃げ道になる
    const p = buildWeeklyPrompt({ ...BASE, proposals: PROPOSALS, adviceRecord: null });
    expect(p).not.toContain("提案の当否");
  });

  it("提案・実績が未指定でも生成できる（後から追加した項目のため）", () => {
    const legacy = { ...BASE } as DigestInput;
    // @ts-expect-error 古い呼び出しを模す
    delete legacy.proposals;
    // @ts-expect-error 古い呼び出しを模す
    delete legacy.adviceRecord;
    expect(() => buildWeeklyPrompt(legacy)).not.toThrow();
  });
});
