import { describe, expect, it } from "vitest";
import { normalizePositionForTest } from "./services/ocr";

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
});
