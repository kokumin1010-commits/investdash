import { describe, expect, it } from "vitest";
import { groupPositionsBySymbol } from "./services/groupPositions";
import type { PositionView } from "./services/portfolio";

/**
 * テスト用のポジションを作る。
 * 実データ（ヤクルトを moomoo 400 株 / 楽天 1,800 株で保有）を題材にしている。
 */
function pos(over: Partial<PositionView> & { symbol: string }): PositionView {
  const quantity = over.quantity ?? 100;
  const avgCost = over.avgCost ?? 1000;
  const currentPrice = over.currentPrice === undefined ? 1200 : over.currentPrice;
  const marketValue = currentPrice === null ? null : currentPrice * quantity;
  const costValue = avgCost * quantity;
  return {
    id: over.id ?? 1,
    symbol: over.symbol,
    tickerCode: over.tickerCode ?? over.symbol.replace(".T", ""),
    name: over.name ?? "テスト銘柄",
    market: over.market ?? "JP",
    currency: over.currency ?? "JPY",
    broker: over.broker ?? "moomoo_jp",
    quantity,
    avgCost,
    currentPrice,
    previousClose: over.previousClose ?? null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    sector: over.sector ?? null,
    industry: over.industry ?? null,
    website: null,
    businessSummary: null,
    marketValue,
    costValue,
    pnl: marketValue === null ? null : marketValue - costValue,
    pnlPct:
      marketValue === null || costValue === 0 ? null : ((marketValue - costValue) / costValue) * 100,
    dayChangePct: over.dayChangePct ?? null,
    marketValueBase: marketValue,
    costValueBase: costValue,
    weightPct: null,
    priceUpdatedAt: over.priceUpdatedAt ?? null,
    holdingDuration: over.holdingDuration ?? {
      startDate: new Date("2026-08-25T00:00:00+09:00"),
      days: 2,
      confidence: "AT_LEAST",
      source: "MONTHLY_SNAPSHOT",
    },
    hasCard: over.hasCard ?? false,
    signal: over.signal ?? null,
    newsCount: over.newsCount ?? 0,
    negativeNewsCount: over.negativeNewsCount ?? 0,
  };
}

describe("groupPositionsBySymbol", () => {
  it("同一銘柄を複数口座で保有していると 1 グループにまとまる", () => {
    // ヤクルト: moomoo 400株@3092 / 楽天 1800株@2394.5、現在値 2881.5
    const groups = groupPositionsBySymbol(
      [
        pos({
          id: 1,
          symbol: "2267.T",
          name: "ヤクルト本社",
          broker: "moomoo_jp",
          quantity: 400,
          avgCost: 3092,
          currentPrice: 2881.5,
        }),
        pos({
          id: 2,
          symbol: "2267.T",
          name: "ヤクルト本社",
          broker: "rakuten_ispeed",
          quantity: 1800,
          avgCost: 2394.5,
          currentPrice: 2881.5,
        }),
      ],
      10_000_000
    );

    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.isSplit).toBe(true);
    expect(g.entries).toHaveLength(2);
    // 合計株数
    expect(g.quantity).toBe(2200);
    // 加重平均取得単価: (400×3092 + 1800×2394.5) ÷ 2200
    expect(g.avgCost).toBeCloseTo((400 * 3092 + 1800 * 2394.5) / 2200, 6);
    // 合計評価額
    expect(g.marketValue).toBe(2200 * 2881.5);
  });

  it("内訳は評価額の大きい口座から並ぶ", () => {
    const groups = groupPositionsBySymbol(
      [
        pos({ id: 1, symbol: "2267.T", broker: "moomoo_jp", quantity: 400, currentPrice: 2881.5 }),
        pos({
          id: 2,
          symbol: "2267.T",
          broker: "rakuten_ispeed",
          quantity: 1800,
          currentPrice: 2881.5,
        }),
      ],
      10_000_000
    );

    // 1800 株の楽天が先に来る
    expect(groups[0].entries.map(e => e.broker)).toEqual(["rakuten_ispeed", "moomoo_jp"]);
    expect(groups[0].brokers).toEqual(["rakuten_ispeed", "moomoo_jp"]);
  });

  it("1 口座のみの銘柄は isSplit が false", () => {
    const groups = groupPositionsBySymbol(
      [pos({ id: 1, symbol: "6920.T", name: "レーザーテック", broker: "moomoo_jp" })],
      1_000_000
    );
    expect(groups[0].isSplit).toBe(false);
    expect(groups[0].entries).toHaveLength(1);
  });

  it("口座ごとの損益は内訳に保持される", () => {
    // moomoo は含み損（3092 → 2881.5）、楽天は含み益（2394.5 → 2881.5）
    const groups = groupPositionsBySymbol(
      [
        pos({
          id: 1,
          symbol: "2267.T",
          broker: "moomoo_jp",
          quantity: 400,
          avgCost: 3092,
          currentPrice: 2881.5,
        }),
        pos({
          id: 2,
          symbol: "2267.T",
          broker: "rakuten_ispeed",
          quantity: 1800,
          avgCost: 2394.5,
          currentPrice: 2881.5,
        }),
      ],
      10_000_000
    );

    const [rakuten, moomoo] = groups[0].entries;
    expect(moomoo.pnl).toBeLessThan(0);
    expect(rakuten.pnl).toBeGreaterThan(0);
    // 合計では含み益（楽天の益が moomoo の損を上回る）
    expect(groups[0].pnl).toBeGreaterThan(0);
  });

  it("構成比は合計評価額に対して計算される", () => {
    // 合計 200 万円 ÷ 全体 1000 万円 = 20%
    const groups = groupPositionsBySymbol(
      [
        pos({ id: 1, symbol: "A.T", broker: "moomoo_jp", quantity: 1000, currentPrice: 1000 }),
        pos({ id: 2, symbol: "A.T", broker: "rakuten_ispeed", quantity: 1000, currentPrice: 1000 }),
      ],
      10_000_000
    );
    expect(groups[0].weightPct).toBeCloseTo(20, 6);
  });

  it("グループは合計評価額の降順に並ぶ", () => {
    const groups = groupPositionsBySymbol(
      [
        pos({ id: 1, symbol: "SMALL.T", quantity: 10, currentPrice: 100 }),
        pos({ id: 2, symbol: "BIG.T", quantity: 1000, currentPrice: 1000 }),
        pos({ id: 3, symbol: "MID.T", quantity: 100, currentPrice: 1000 }),
      ],
      10_000_000
    );
    expect(groups.map(g => g.symbol)).toEqual(["BIG.T", "MID.T", "SMALL.T"]);
  });

  it("株価が未取得なら評価額は null になり 0 として扱われない", () => {
    const groups = groupPositionsBySymbol(
      [pos({ id: 1, symbol: "X.T", currentPrice: null, quantity: 100, avgCost: 500 })],
      1_000_000
    );
    expect(groups[0].marketValue).toBeNull();
    expect(groups[0].pnl).toBeNull();
    // 取得原価は株価に依存しないので計算できる
    expect(groups[0].costValue).toBe(50_000);
  });

  it("一方の口座だけ株価が取れている場合は取れている分で合算する", () => {
    const groups = groupPositionsBySymbol(
      [
        pos({ id: 1, symbol: "Y.T", broker: "moomoo_jp", quantity: 100, currentPrice: 1000 }),
        pos({ id: 2, symbol: "Y.T", broker: "rakuten_ispeed", quantity: 100, currentPrice: null }),
      ],
      1_000_000
    );
    // 片方しか取れていないので 100×1000 のみ
    expect(groups[0].marketValue).toBe(100_000);
    // 現在値は取れている方を代表値にする
    expect(groups[0].currentPrice).toBe(1000);
  });

  it("シグナルと投資カードは銘柄単位なのでどちらの口座にあっても拾う", () => {
    const signal = {
      action: "ADD" as const,
      confidence: 70,
      rationale: "テスト",
      createdAt: new Date("2026-08-16T00:00:00Z"),
    };
    const groups = groupPositionsBySymbol(
      [
        pos({ id: 1, symbol: "Z.T", broker: "moomoo_jp", signal: null, hasCard: false }),
        pos({ id: 2, symbol: "Z.T", broker: "rakuten_ispeed", signal, hasCard: true }),
      ],
      1_000_000
    );
    expect(groups[0].signal?.action).toBe("ADD");
    expect(groups[0].hasCard).toBe(true);
  });

  it("ニュース件数は重複計上せず最大値を採用する", () => {
    // 同じ銘柄のニュースが両方の行に紐づくため、足すと二重計上になる
    const groups = groupPositionsBySymbol(
      [
        pos({ id: 1, symbol: "W.T", broker: "moomoo_jp", newsCount: 12, negativeNewsCount: 3 }),
        pos({ id: 2, symbol: "W.T", broker: "rakuten_ispeed", newsCount: 12, negativeNewsCount: 3 }),
      ],
      1_000_000
    );
    expect(groups[0].newsCount).toBe(12);
    expect(groups[0].negativeNewsCount).toBe(3);
  });

  it("セクターは登録されている行から拾う", () => {
    const groups = groupPositionsBySymbol(
      [
        pos({ id: 1, symbol: "V.T", broker: "moomoo_jp", sector: null }),
        pos({ id: 2, symbol: "V.T", broker: "rakuten_ispeed", sector: "Consumer Defensive" }),
      ],
      1_000_000
    );
    expect(groups[0].sector).toBe("Consumer Defensive");
  });

  it("空配列を渡しても落ちない", () => {
    expect(groupPositionsBySymbol([], 0)).toEqual([]);
  });
});
