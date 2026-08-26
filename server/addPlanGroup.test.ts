import { describe, expect, it } from "vitest";
import { groupPositionsBySymbol } from "./services/groupPositions";
import type { PositionView } from "./services/portfolio";

/** 保有 1 件を組み立てる。金額の検証に必要な項目だけ埋める */
function pos(over: Partial<PositionView> = {}): PositionView {
  return {
    id: 1,
    symbol: "8058.T",
    tickerCode: "8058",
    name: "三菱商事",
    market: "JP",
    currency: "JPY",
    broker: "rakuten",
    sector: "Industrials",
    industry: "Conglomerates",
    quantity: 4_000,
    avgCost: 3_593,
    currentPrice: 4_775,
    previousClose: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    marketValue: 19_100_000,
    costValue: 14_372_000,
    pnl: 4_728_000,
    pnlPct: 32.9,
    dayChangePct: null,
    marketValueBase: 19_100_000,
    costValueBase: 14_372_000,
    pnlBase: 4_728_000,
    weightPct: null,
    signal: { action: "ADD", confidence: 4, rationale: "", createdAt: new Date() },
    hasCard: false,
    newsCount: 0,
    negativeNewsCount: 0,
    priceUpdatedAt: new Date(),
    holdingDuration: {
      startDate: new Date("2026-08-25T00:00:00+09:00"),
      days: 2,
      confidence: "AT_LEAST",
      source: "MONTHLY_SNAPSHOT",
    },
    dividend: null,
    ...over,
  } as unknown as PositionView;
}

const TOTAL = 857_000_000;
/** 現金性資産 8,861 万円・預り金 0 円。半分（4,430 万円）を 4 段に割ると 1 段 1,108 万円 */
const CASH = { interestAssetsBase: 88_610_000, cashBase: 0 };

describe("ADD 銘柄の買い増し金額", () => {
  it("ADD の銘柄に金額と株数が付く", () => {
    const [g] = groupPositionsBySymbol([pos()], TOTAL, CASH);
    expect(g.addPlan).not.toBeNull();
    expect(g.addPlan!.shares).toBeGreaterThan(0);
    // 日本株なので 100 株単位になっている
    expect(g.addPlan!.shares! % 100).toBe(0);
  });

  it("金額と株数の掛け算が一致する（表示の整合）", () => {
    const [g] = groupPositionsBySymbol([pos()], TOTAL, CASH);
    const p = g.addPlan!;
    expect(p.amountLocal).toBeCloseTo(p.shares! * 4_775, 0);
  });

  it("ADD 以外の銘柄には金額を出さない（買ってよいと誤解させない）", () => {
    const hold = pos({
      signal: { action: "HOLD", confidence: 3, rationale: "", createdAt: new Date() },
    } as Partial<PositionView>);
    const [g] = groupPositionsBySymbol([hold], TOTAL, CASH);
    expect(g.addPlan).toBeNull();
  });

  it("原資が渡されない呼び出しでは金額を出さない（根拠のない数字を出さない）", () => {
    const [g] = groupPositionsBySymbol([pos()], TOTAL);
    expect(g.addPlan).toBeNull();
  });

  it("構成比の上限（5%）に達している銘柄は 0 円・0 株で返す", () => {
    // トヨタは 4,825 万円で構成比 5.63%。既に上限を超えている
    const toyota = pos({
      symbol: "7203.T",
      name: "トヨタ自動車",
      marketValue: 48_256_000,
      marketValueBase: 48_256_000,
      currentPrice: 3_016,
    } as Partial<PositionView>);
    const [g] = groupPositionsBySymbol([toyota], 857_000_000, CASH);
    const p = g.addPlan!;
    expect(p.atCap).toBe(true);
    expect(p.amountBase).toBe(0);
    // 株数を null にすると「取得できていない」と読めるため 0 を返す
    expect(p.shares).toBe(0);
  });

  it("外貨建ての銘柄は現地通貨の金額で株数を出す", () => {
    // ブロードコム 1 株 392.43 USD、評価額 1,504 万円 = 38,325 USD 相当
    const avgo = pos({
      symbol: "AVGO",
      name: "ブロードコム",
      market: "US",
      currency: "USD",
      currentPrice: 392.43,
      quantity: 96,
      marketValue: 37_673,
      marketValueBase: 6_002_000,
      costValue: 20_000,
      costValueBase: 3_000_000,
    } as Partial<PositionView>);
    const [g] = groupPositionsBySymbol([avgo], TOTAL, CASH);
    const p = g.addPlan!;
    // 現地通貨の金額は円の金額より小さい（USD 建てのため）
    expect(p.amountLocal!).toBeLessThan(p.amountBase);
    expect(p.amountLocal).toBeCloseTo(p.shares! * 392.43, 0);
  });

  it("買い増し後の構成比は分母の増加も含めて出す", () => {
    const [g] = groupPositionsBySymbol([pos()], TOTAL, CASH);
    const p = g.addPlan!;
    // (19,100,000 + x) / (857,000,000 + x) を満たす値であること
    const expected = ((19_100_000 + p.amountBase) / (TOTAL + p.amountBase)) * 100;
    expect(p.afterSharePct).toBeCloseTo(expected, 4);
    // 現在の構成比（2.23%）より大きい
    expect(p.afterSharePct!).toBeGreaterThan(2.2);
  });
});
