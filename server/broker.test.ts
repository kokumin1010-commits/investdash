import { describe, expect, it } from "vitest";
import {
  BROKERS,
  BROKER_LABELS,
  brokerFromFormatId,
  brokerHex,
  brokerLabel,
  brokerShort,
  brokerStyle,
} from "../shared/investing";

describe("証券プラットフォームの表示ユーティリティ", () => {
  it("すべての口座にラベル・短縮名・色が定義されている", () => {
    for (const b of BROKERS) {
      expect(BROKER_LABELS[b]).toBeTruthy();
      expect(brokerShort(b)).toBeTruthy();
      expect(brokerStyle(b)).toBeTruthy();
      expect(brokerHex(b)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("口座ごとに異なる色が割り当てられている", () => {
    const colors = BROKERS.map(b => brokerHex(b));
    expect(new Set(colors).size).toBe(BROKERS.length);
  });

  it("moomoo 日本版のラベルが正しい", () => {
    expect(brokerLabel("moomoo_jp")).toBe("moomoo 日本版");
    expect(brokerShort("moomoo_jp")).toBe("moomoo");
  });

  it("未設定や未知の値は「その他」として扱う", () => {
    expect(brokerLabel(null)).toBe("その他");
    expect(brokerLabel(undefined)).toBe("その他");
    expect(brokerLabel("unknown_broker")).toBe("その他");
    expect(brokerShort("")).toBe("その他");
    expect(brokerHex("unknown_broker")).toBe(brokerHex("other"));
  });

  it("OCR のフォーマット ID から口座を判定できる", () => {
    expect(brokerFromFormatId("moomoo_jp")).toBe("moomoo_jp");
    expect(brokerFromFormatId("rakuten_ispeed")).toBe("rakuten_ispeed");
    expect(brokerFromFormatId("futu")).toBe("futu");
  });

  it("汎用フォーマットや未指定は「その他」になる", () => {
    expect(brokerFromFormatId("generic")).toBe("other");
    expect(brokerFromFormatId(undefined)).toBe("other");
    expect(brokerFromFormatId(null)).toBe("other");
  });
});
