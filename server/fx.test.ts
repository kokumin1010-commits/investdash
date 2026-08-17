import { describe, expect, it } from "vitest";
import { convertToJpy, convertToJpyOrSelf, isPlausibleRate, FX_FALLBACK } from "./services/fx";

const rates = { usdJpy: 159.31, sgdJpy: 124.56, hkdJpy: 20.3064 };

describe("convertToJpy", () => {
  it("円はそのまま返す", () => {
    expect(convertToJpy(1000, "JPY", rates)).toBe(1000);
  });

  it("米ドルを USD/JPY で換算する", () => {
    expect(convertToJpy(100, "USD", rates)).toBeCloseTo(15931, 2);
  });

  it("シンガポールドルを SGD/JPY で換算する", () => {
    expect(convertToJpy(100, "SGD", rates)).toBeCloseTo(12456, 2);
  });

  /*
   * 富途香港の港股（滙豐・領展・中海油・中國平安）と港元貨幣基金が HKD 建てのため、
   * HKD を換算対象に追加した。以前は未対応通貨として null を返していた。
   */
  it("香港ドルを HKD/JPY で換算する", () => {
    expect(convertToJpy(100, "HKD", rates)).toBeCloseTo(2030.64, 2);
  });

  it("港股の実データで換算できる（滙豐控股 129 株 @162.80 HKD）", () => {
    // 21,001.20 HKD × 20.3064 = 426,458.77 円
    expect(convertToJpy(129 * 162.8, "HKD", rates)).toBeCloseTo(426458.77, 0);
  });

  it("通貨コードの大文字小文字と空白を許容する", () => {
    expect(convertToJpy(100, " sgd ", rates)).toBeCloseTo(12456, 2);
  });

  it("null はそのまま null（株価未取得の銘柄を 0 円と扱わない）", () => {
    expect(convertToJpy(null, "USD", rates)).toBeNull();
  });

  it("未対応通貨は null を返し、レート 1 で混ぜない", () => {
    expect(convertToJpy(100, "EUR", rates)).toBeNull();
    expect(convertToJpy(100, "KRW", rates)).toBeNull();
  });

  it("NaN や Infinity は null にする", () => {
    expect(convertToJpy(Number.NaN, "USD", rates)).toBeNull();
    expect(convertToJpy(Number.POSITIVE_INFINITY, "JPY", rates)).toBeNull();
  });
});

describe("convertToJpyOrSelf", () => {
  it("未対応通貨は現地通貨の数値をそのまま使う", () => {
    expect(convertToJpyOrSelf(100, "EUR", rates)).toBe(100);
  });

  it("対応通貨は換算値を返す", () => {
    expect(convertToJpyOrSelf(100, "SGD", rates)).toBeCloseTo(12456, 2);
  });
});

describe("isPlausibleRate", () => {
  it("想定範囲内なら true", () => {
    expect(isPlausibleRate(159.31, 50, 500)).toBe(true);
    expect(isPlausibleRate(124.56, 40, 400)).toBe(true);
  });

  it("範囲外・null・非数値は false（API 仕様変更で 0 が来ても採用しない）", () => {
    expect(isPlausibleRate(0, 50, 500)).toBe(false);
    expect(isPlausibleRate(1200, 50, 500)).toBe(false);
    expect(isPlausibleRate(null, 50, 500)).toBe(false);
    expect(isPlausibleRate(Number.NaN, 50, 500)).toBe(false);
  });

  it("境界値は採用する", () => {
    expect(isPlausibleRate(50, 50, 500)).toBe(true);
    expect(isPlausibleRate(500, 50, 500)).toBe(true);
  });
});

describe("FX_FALLBACK", () => {
  it("レート未取得時の既定値が妥当な範囲にある", () => {
    expect(isPlausibleRate(FX_FALLBACK.usdJpy, 50, 500)).toBe(true);
    expect(isPlausibleRate(FX_FALLBACK.sgdJpy, 40, 400)).toBe(true);
  });
});
