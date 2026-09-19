import { describe, expect, it } from "vitest";
import {
  normalizePositionForTest,
  sanitizePositionsForFormatForTest,
} from "./services/ocr";

describe("OCR 抽出結果の正規化", () => {
  it("逆算で生じた長い小数の取得単価を小数第 2 位に丸める", () => {
    const res = normalizePositionForTest({
      name: "SUBARU",
      tickerCode: "7270",
      quantity: 1900,
      avgCost: 3389.315789473684,
      currentPrice: 2557.5,
      marketValue: 4859250,
      pnl: -1580450,
      pnlPct: -24.56,
      confidence: 80,
    });
    expect(res.avgCost).toBe(3389.32);
  });

  it("数量は整数に丸める", () => {
    const res = normalizePositionForTest({
      name: "テスト",
      tickerCode: "1234",
      quantity: 100.4,
      avgCost: 1000,
      currentPrice: 1100,
      marketValue: 110000,
      pnl: 10000,
      pnlPct: 10,
      confidence: 90,
    });
    expect(res.quantity).toBe(100);
  });

  it("null はそのまま null を返す", () => {
    const res = normalizePositionForTest({
      name: "テスト",
      tickerCode: "1234",
      quantity: null,
      avgCost: null,
      currentPrice: null,
      marketValue: null,
      pnl: null,
      pnlPct: null,
      confidence: 40,
    });
    expect(res.quantity).toBeNull();
    expect(res.avgCost).toBeNull();
    expect(res.pnl).toBeNull();
  });

  it("マイナスの損益の符号を保持する", () => {
    const res = normalizePositionForTest({
      name: "テスト",
      tickerCode: "1234",
      quantity: 200,
      avgCost: 961.1,
      currentPrice: 761.4,
      marketValue: 152280,
      pnl: -39940.006,
      pnlPct: -20.78,
      confidence: 85,
    });
    expect(res.pnl).toBe(-39940.01);
  });

  it("正常な値は変更しない", () => {
    const res = normalizePositionForTest({
      name: "キヤノン",
      tickerCode: "7751",
      quantity: 400,
      avgCost: 4732,
      currentPrice: 4575,
      marketValue: 1830000,
      pnl: -62800,
      pnlPct: -3.32,
      confidence: 95,
    });
    expect(res).toMatchObject({
      quantity: 400,
      avgCost: 4732,
      currentPrice: 4575,
      marketValue: 1830000,
      pnl: -62800,
    });
  });

  it("Standard Chartered はSGXの小数第4位を保持する", () => {
    const res = normalizePositionForTest(
      {
        name: "NETLINK NBN TRUST UNT",
        tickerCode: "CJLU",
        quantity: 32000,
        avgCost: 0.8730634375,
        currentPrice: 0.955,
        marketValue: 30560,
        pnl: 2591.97,
        pnlPct: 9.29,
        confidence: 95,
      },
      "sc_sg"
    );
    expect(res.avgCost).toBe(0.8731);
    expect(res.currentPrice).toBe(0.955);
    expect(res.pnlPct).toBe(9.29);
  });

  it("富途香港は端株と小数第4位の取得単価を保持する", () => {
    const res = normalizePositionForTest(
      {
        name: "英偉達",
        tickerCode: "NVDA",
        quantityDisplay: "0.5",
        quantityIsRounded: false,
        quantity: 0.5,
        avgCost: 132.99,
        currentPrice: 222.53,
        marketValue: 111.265,
        pnl: 44.77,
        pnlPct: null,
        confidence: 95,
      },
      "futu_hk"
    );
    expect(res.quantity).toBe(0.5);
    expect(res.avgCost).toBe(132.99);
    expect(res.currentPrice).toBe(222.53);

    const amd = normalizePositionForTest(
      {
        name: "美國超微公司",
        tickerCode: "AMD",
        quantity: 150,
        avgCost: -38.4877,
        currentPrice: 557.5,
        marketValue: 83_625,
        pnl: 89_398.15,
        pnlPct: null,
        confidence: 95,
      },
      "futu_hk"
    );
    expect(amd.avgCost).toBe(-38.4877);
  });

  it("楽天iSPEEDのMy Page行情は数量・取得単価がなければ保有候補から除外する", () => {
    const held = normalizePositionForTest(
      {
        name: "ヤクルト",
        tickerCode: "2267",
        quantity: 1800,
        avgCost: 2394.5,
        currentPrice: 2815.5,
        marketValue: null,
        pnl: null,
        pnlPct: null,
        confidence: 95,
      },
      "rakuten_ispeed"
    );
    const quoteOnly = normalizePositionForTest(
      {
        name: "テスラ",
        tickerCode: "TSLA",
        quantity: 400,
        avgCost: null,
        currentPrice: 362.505,
        marketValue: null,
        pnl: null,
        pnlPct: null,
        confidence: 80,
      },
      "rakuten_ispeed"
    );

    expect(
      sanitizePositionsForFormatForTest([held, quoteOnly], "rakuten_ispeed")
    ).toEqual([held]);
  });
});
