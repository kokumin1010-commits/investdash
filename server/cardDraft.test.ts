import { describe, expect, it } from "vitest";
import { buildCardPrompt, type CardDraftContext } from "./services/cardDrafter";
import { isCardEmpty } from "./services/cardService";

const ctx = (o: Partial<CardDraftContext> = {}): CardDraftContext => ({
  symbol: "8058.T",
  name: "三菱商事",
  market: "JP",
  currency: "JPY",
  sector: "Industrials",
  industry: "Conglomerates",
  businessSummary: "総合商社。エネルギー、金属資源、機械などを扱う。",
  quantity: 1000,
  avgCost: 3593.32,
  currentPrice: 4714,
  fiftyTwoWeekHigh: 6012,
  fiftyTwoWeekLow: 3176,
  dividendYieldPct: 2.33,
  annualDividendLocal: 110,
  pnlPct: 31.19,
  weightPct: 2.5,
  news: [],
  ...o,
});

describe("投資カードの下書き用プロンプト", () => {
  it("保有と価格の情報を渡す", () => {
    const p = buildCardPrompt(ctx());
    expect(p).toContain("三菱商事");
    expect(p).toContain("3,593.32");
    expect(p).toContain("4,714");
    expect(p).toContain("2.33%");
  });

  it("ニュースが無いことを明示する", () => {
    /*
     * 明示しないと AI が一般論で埋めてしまい、
     * 根拠のない記述がカードに混ざる。
     */
    const p = buildCardPrompt(ctx({ news: [] }));
    expect(p).toContain("ニュースは取得できていません");
    expect(p).toContain("推測で補わないこと");
  });

  it("ニュースがあれば影響度付きで渡す", () => {
    const p = buildCardPrompt(
      ctx({
        news: [{ title: "最終利益が47%増", summary: "資源価格の上昇が寄与", impactScore: 75 }],
      })
    );
    expect(p).toContain("最終利益が47%増");
    expect(p).toContain("影響度 75");
  });

  it("未取得の値は「未取得」と書く（0 と混同しない）", () => {
    // 株価未取得を 0 と書くと「株価が 0 になった」と誤解される
    const p = buildCardPrompt(ctx({ currentPrice: null, dividendYieldPct: null }));
    expect(p).toContain("現在値: JPY 未取得");
    expect(p).toContain("無配または未取得");
  });

  it("事業概要が長すぎる場合は切る", () => {
    const p = buildCardPrompt(ctx({ businessSummary: "あ".repeat(3000) }));
    // 900 文字で切っている
    expect(p).not.toContain("あ".repeat(1000));
    expect(p).toContain("あ".repeat(500));
  });

  it("撤退条件を確認できる形で書くよう指示する", () => {
    const p = buildCardPrompt(ctx());
    expect(p).toContain("確認できる形");
  });
});

describe("カードが空かどうかの判定", () => {
  const base = {
    buyReason: null,
    coreThesis: null,
    valuationAssumption: null,
    exitConditions: null,
    risks: null,
  };

  it("カードが存在しなければ空", () => {
    expect(isCardEmpty(null)).toBe(true);
  });

  it("すべて未記入なら空", () => {
    expect(isCardEmpty(base)).toBe(true);
  });

  it("空白だけの記入は空として扱う", () => {
    // 空文字や空白を「記入済み」と見なすと下書きが走らなくなる
    expect(isCardEmpty({ ...base, buyReason: "   " })).toBe(true);
    expect(isCardEmpty({ ...base, coreThesis: "\n\n" })).toBe(true);
  });

  it("1 つでも記入があれば空ではない（手書きを上書きしない）", () => {
    expect(isCardEmpty({ ...base, exitConditions: "配当が減配されたら" })).toBe(false);
  });
});
