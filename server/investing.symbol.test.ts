import { describe, expect, it } from "vitest";
import {
  formatMoney,
  formatPercent,
  impactLabel,
  marketLabel,
  normalizeBrokerImportSymbol,
  normalizeSymbol,
  resolveScreenshotAverageCost,
  resolveScreenshotQuantity,
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

describe("normalizeBrokerImportSymbol", () => {
  it("Standard Chartered の裸SGXコードに .SI を付与する", () => {
    expect(normalizeBrokerImportSymbol("D05", "sc_sg")).toEqual({
      symbol: "D05.SI",
      tickerCode: "D05",
      market: "SG",
    });
    expect(normalizeBrokerImportSymbol("C38U.SG", "sc_sg")).toEqual({
      symbol: "C38U.SI",
      tickerCode: "C38U",
      market: "SG",
    });
  });

  it("Standard Chartered の日本株コードを .T に変換する", () => {
    expect(normalizeBrokerImportSymbol("7270.JP", "sc_sg")).toEqual({
      symbol: "7270.T",
      tickerCode: "7270",
      market: "JP",
    });
    expect(normalizeBrokerImportSymbol("9449", "sc_sg").symbol).toBe("9449.T");
  });

  it("他形式の裸英数字コードは従来どおり米国株として扱う", () => {
    expect(normalizeBrokerImportSymbol("D05", "generic").market).toBe("US");
  });

  it("IBKRは画面の取引所コードからSGXと米国株を分ける", () => {
    expect(normalizeBrokerImportSymbol("D05", "ibkr", "SGX")).toEqual({
      symbol: "D05.SI",
      tickerCode: "D05",
      market: "SG",
    });
    expect(normalizeBrokerImportSymbol("ORCL", "ibkr", "NYSE")).toEqual({
      symbol: "ORCL",
      tickerCode: "ORCL",
      market: "US",
    });
  });
});

describe("resolveScreenshotQuantity", () => {
  it("IBKRのK丸め表示に既存の正確な数量が収まるなら既存値を保持する", () => {
    expect(
      resolveScreenshotQuantity({
        formatId: "ibkr",
        parsedQuantity: 1_100,
        quantityDisplay: "1.10K",
        quantityIsRounded: true,
        existingQuantity: 1_103,
      })
    ).toBe(1_103);
  });

  it("表示範囲外の既存値はスクショ数量へ更新する", () => {
    expect(
      resolveScreenshotQuantity({
        formatId: "ibkr",
        parsedQuantity: 1_100,
        quantityDisplay: "1.10K",
        quantityIsRounded: true,
        existingQuantity: 1_250,
      })
    ).toBe(1_100);
  });
});

describe("resolveScreenshotAverageCost", () => {
  it("楽天の同一口座・同一数量は複数建玉の確認済み加重平均を保持する", () => {
    expect(
      resolveScreenshotAverageCost({
        formatId: "rakuten_ispeed",
        market: "JP",
        quantity: 8100,
        parsedAvgCost: 2613.89,
        marketValue: null,
        pnl: null,
        pnlPct: null,
        existingQuantity: 8100,
        existingAvgCost: 2581.16,
      })
    ).toBe(2581.16);
  });

  it("同一口座・同一数量なら丸め値から再計算せず既存取得単価を保持する", () => {
    expect(
      resolveScreenshotAverageCost({
        formatId: "sc_sg",
        market: "SG",
        quantity: 300,
        parsedAvgCost: 46.06,
        marketValue: 23_058,
        pnl: 9_071.68,
        pnlPct: 65.1,
        existingQuantity: 300,
        existingAvgCost: 46.6211,
      })
    ).toBe(46.6211);
  });

  it("新規SGX銘柄は損益と損益率から取得単価を算出する", () => {
    expect(
      resolveScreenshotAverageCost({
        formatId: "sc_sg",
        market: "SG",
        quantity: 2_300,
        parsedAvgCost: 16.65,
        marketValue: 37_950,
        pnl: -351.44,
        pnlPct: -0.92,
        existingQuantity: null,
        existingAvgCost: null,
      })
    ).toBe(16.6087);
  });

  it("新規日本株も丸められたM表記を使わず損益率から取得単価を算出する", () => {
    expect(
      resolveScreenshotAverageCost({
        formatId: "sc_sg",
        market: "JP",
        quantity: 300,
        parsedAvgCost: 7_344.76,
        marketValue: 2_650_000,
        pnl: 395_126.61,
        pnlPct: 17.6,
        existingQuantity: null,
        existingAvgCost: null,
      })
    ).toBe(7_483.4585);
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
