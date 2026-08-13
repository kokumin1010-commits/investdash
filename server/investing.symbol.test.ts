import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatPercent,
  impactLabel,
  marketLabel,
  normalizeSymbol,
  sectorJa,
  sentimentLabel,
} from "../shared/investing";

describe("normalizeSymbol", () => {
  it("日本株の4桁コードに .T を付与する", () => {
    expect(normalizeSymbol("7270")).toEqual({
      symbol: "7270.T",
      tickerCode: "7270",
      market: "JP",
    });
  });

  it("末尾がアルファベットの日本株コードも日本株として扱う", () => {
    expect(normalizeSymbol("130A")).toEqual({
      symbol: "130A.T",
      tickerCode: "130A",
      market: "JP",
    });
  });

  it("すでに .T が付いているシンボルはそのまま扱う", () => {
    expect(normalizeSymbol("9023.T")).toEqual({
      symbol: "9023.T",
      tickerCode: "9023",
      market: "JP",
    });
  });

  it("米国株ティッカーは米国株として扱う", () => {
    expect(normalizeSymbol("msft")).toEqual({
      symbol: "MSFT",
      tickerCode: "MSFT",
      market: "US",
    });
  });

  it("前後の空白を除去する", () => {
    expect(normalizeSymbol("  7203  ").symbol).toBe("7203.T");
  });

  it("空文字は空のシンボルを返す", () => {
    expect(normalizeSymbol("   ").symbol).toBe("");
  });
});

describe("formatMoney", () => {
  it("円は小数点なしで整形する", () => {
    expect(formatMoney(4859250, "JPY")).toBe("￥4,859,250");
  });

  it("ドルは小数点 2 桁で整形する", () => {
    expect(formatMoney(123.456, "USD")).toBe("$123.46");
  });

  it("null は — を返す", () => {
    expect(formatMoney(null)).toBe("—");
  });

  it("マイナス値も整形できる", () => {
    expect(formatMoney(-1580450, "JPY")).toContain("1,580,450");
  });
});

describe("formatPercent", () => {
  it("プラスには + を付ける", () => {
    expect(formatPercent(12.345)).toBe("+12.35%");
  });

  it("マイナスはそのまま表示する", () => {
    expect(formatPercent(-24.56)).toBe("-24.56%");
  });

  it("null は — を返す", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("表示ラベル", () => {
  it("市場名を日本語で返す", () => {
    expect(marketLabel("JP")).toBe("日本株");
    expect(marketLabel("US")).toBe("米国株");
    expect(marketLabel("OTHER")).toBe("その他");
  });

  it("既知のセクターを日本語化する", () => {
    expect(sectorJa("Technology")).toBe("情報技術");
    expect(sectorJa("Consumer Cyclical")).toBe("一般消費財");
  });

  it("未知のセクターはそのまま返す", () => {
    expect(sectorJa("Unknown Sector")).toBe("Unknown Sector");
  });

  it("セクター未設定は未分類とする", () => {
    expect(sectorJa(null)).toBe("未分類");
  });

  it("センチメントを日本語化する", () => {
    expect(sentimentLabel("POSITIVE")).toBe("ポジティブ");
    expect(sentimentLabel("NEGATIVE")).toBe("ネガティブ");
    expect(sentimentLabel(null)).toBe("未分析");
  });

  it("影響度スコアを区分ラベルに変換する", () => {
    expect(impactLabel(90)).toBe("非常に高い");
    expect(impactLabel(60)).toBe("高い");
    expect(impactLabel(30)).toBe("中程度");
    expect(impactLabel(5)).toBe("低い");
    expect(impactLabel(null)).toBe("—");
  });
});
