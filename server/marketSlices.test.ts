import { describe, expect, it } from "vitest";
import { buildMarketSlices } from "./services/marketSlices";
import { parseMarketFilter } from "../shared/investing";

/**
 * 米国株の損益は円換算後だけを見ると為替の影響が混ざる。
 * 現地通貨ベースの損益も併記できることを保証する。
 */
describe("buildMarketSlices", () => {
  const jp = {
    market: "JP" as const,
    currency: "JPY",
    marketValueBase: 1_000_000,
    costValueBase: 800_000,
    marketValue: 1_000_000,
    costValue: 800_000,
  };
  const us = {
    market: "US" as const,
    currency: "USD",
    marketValueBase: 300_000,
    costValueBase: 200_000,
    marketValue: 2_000,
    costValue: 1_500,
  };

  it("市場ごとに評価額と銘柄数を集計する", () => {
    const slices = buildMarketSlices([jp, jp, us], 2_300_000);
    const jpSlice = slices.find(s => s.key === "JP")!;
    const usSlice = slices.find(s => s.key === "US")!;

    expect(jpSlice.count).toBe(2);
    expect(jpSlice.value).toBe(2_000_000);
    expect(usSlice.count).toBe(1);
    expect(usSlice.value).toBe(300_000);
  });

  it("日本株を先頭に、その他を末尾に並べる", () => {
    const other = { ...jp, market: "OTHER" as const };
    const slices = buildMarketSlices([other, us, jp], 1_000_000);
    expect(slices.map(s => s.key)).toEqual(["JP", "US", "OTHER"]);
  });

  it("円換算と現地通貨の損益をそれぞれ計算する", () => {
    const [, usSlice] = buildMarketSlices([jp, us], 1_300_000);
    // 円換算: 300,000 − 200,000
    expect(usSlice.pnl).toBe(100_000);
    expect(usSlice.pnlPct).toBeCloseTo(50, 5);
    // 現地通貨: 2,000 − 1,500
    expect(usSlice.localPnl).toBe(500);
    expect(usSlice.localPnlPct).toBeCloseTo(33.333, 2);
  });

  it("外貨建てかどうかを判定する", () => {
    const slices = buildMarketSlices([jp, us], 1_300_000);
    expect(slices.find(s => s.key === "JP")!.isForeign).toBe(false);
    expect(slices.find(s => s.key === "US")!.isForeign).toBe(true);
  });

  it("構成比は総評価額を分母にする", () => {
    const slices = buildMarketSlices([jp, us], 1_300_000);
    expect(slices.find(s => s.key === "JP")!.pct).toBeCloseTo(76.923, 2);
    expect(slices.find(s => s.key === "US")!.pct).toBeCloseTo(23.077, 2);
  });

  it("株価未取得（null）を 0 として扱い落ちない", () => {
    const noPrice = { ...jp, marketValueBase: null, marketValue: null };
    const slices = buildMarketSlices([noPrice], 0);
    expect(slices[0].value).toBe(0);
    expect(slices[0].pct).toBe(0);
  });

  it("取得原価が 0 なら損益率を null にする", () => {
    const zeroCost = { ...jp, costValueBase: 0, costValue: 0 };
    const slices = buildMarketSlices([zeroCost], 1_000_000);
    expect(slices[0].pnlPct).toBeNull();
    expect(slices[0].localPnlPct).toBeNull();
  });
});

describe("parseMarketFilter", () => {
  it("有効な市場コードを受け付ける", () => {
    expect(parseMarketFilter("JP")).toBe("JP");
    expect(parseMarketFilter("US")).toBe("US");
    expect(parseMarketFilter("OTHER")).toBe("OTHER");
  });

  it("小文字でも受け付ける", () => {
    expect(parseMarketFilter("jp")).toBe("JP");
  });

  it("未指定や不正な値は null（すべて表示）にする", () => {
    expect(parseMarketFilter(null)).toBeNull();
    expect(parseMarketFilter("")).toBeNull();
    expect(parseMarketFilter("TW")).toBeNull();
    expect(parseMarketFilter("../../etc")).toBeNull();
  });
});
