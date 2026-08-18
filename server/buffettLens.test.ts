import { describe, expect, it } from "vitest";
import { buildSignalPrompt, type SignalContext } from "./services/analysis";
import { computeLongTermReturns, type PriceBar } from "../shared/longTermReturn";

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;
const now = Date.UTC(2026, 7, 19);

function bars(months: number, priceAt: (i: number) => number): PriceBar[] {
  const out: PriceBar[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    out.push({ t: now - i * MONTH, c: priceAt(months - 1 - i) });
  }
  return out;
}

function baseCtx(over: Partial<SignalContext> = {}): SignalContext {
  return {
    name: "テスト社",
    symbol: "TEST",
    currency: "USD",
    quantity: 100,
    avgCost: 20,
    currentPrice: 103,
    pnlPct: 415,
    weightPct: 0.9,
    sector: "Technology",
    industry: "Semiconductors",
    fiftyTwoWeekHigh: 120,
    fiftyTwoWeekLow: 30,
    return1m: 5,
    return3m: 12,
    card: null,
    news: [],
    ...over,
  };
}

describe("buildSignalPrompt — バフェット式の判断材料", () => {
  it("長期の株価騰落を渡す（1 か月・3 か月だけでは価格と価値を比べられない）", () => {
    const longTerm = computeLongTermReturns(bars(61, i => 20 * Math.pow(1.03, i)));
    const text = buildSignalPrompt(baseCtx({ longTerm }));

    expect(text).toContain("長期の株価の伸び");
    expect(text).toContain("5 年の株価騰落");
    expect(text).toContain("年率換算");
  });

  it("長期データが無い場合は「判断材料にしないこと」と明記する（推測で埋めさせない）", () => {
    const text = buildSignalPrompt(baseCtx({ longTerm: null }));
    expect(text).toContain("長期の株価データは取得できていません");
    expect(text).toContain("判断材料にしないこと");
  });

  it("事業内容を渡す（企業の型を判断する材料）", () => {
    const text = buildSignalPrompt(
      baseCtx({ businessSummary: "Intel Corporation designs and manufactures semiconductors." })
    );
    expect(text).toContain("事業内容");
    expect(text).toContain("Intel Corporation designs");
    // 財務諸表が無いことを明示する
    expect(text).toContain("財務諸表の数値は与えられていない");
  });

  it("事業内容が長すぎる場合は切る（トークンを浪費しない）", () => {
    const long = "A".repeat(3000);
    const text = buildSignalPrompt(baseCtx({ businessSummary: long }));
    // 1,200 字に切られている
    expect(text).toContain("A".repeat(1200));
    expect(text).not.toContain("A".repeat(1201));
  });

  it("事業内容が無い場合も推測させない", () => {
    const text = buildSignalPrompt(baseCtx({ businessSummary: null }));
    expect(text).toContain("事業内容は取得できていません");
    expect(text).toContain("企業の型は判断材料にしないこと");
  });

  it("取得単価は渡すが、判定に使わないことがシステム指示側で担保される", () => {
    // 取得単価そのものは画面表示との整合のため渡し続ける。
    // 「判断に使わない」はシステムプロンプト側の指示で担保する。
    const text = buildSignalPrompt(baseCtx());
    expect(text).toContain("取得単価");
  });

  it("5 年に満たない銘柄は長期の伸びを使わせない", () => {
    // 2 年分しかない
    const longTerm = computeLongTermReturns(bars(25, i => 50 + i));
    const text = buildSignalPrompt(baseCtx({ longTerm }));

    expect(text).toContain("5 年の株価騰落: データ未取得");
    expect(text).toContain("5 年に満たないため長期の伸びは判断材料にしない");
  });
});
