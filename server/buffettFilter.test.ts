import { describe, expect, it } from "vitest";
import {
  BUFFETT_FILTERS,
  countBuffettBreakdown,
  countUnjudged,
  matchesBuffettFilter,
  parseBuffettFilter,
} from "../shared/buffettFilter";

/**
 * 判定は全銘柄に入っているが、一覧で探せないと使えない。
 * 特に「今からは買わない」「株価が中身より速い」を取り違えると
 * 買い増しの判断を誤る方向に働くため、区分の正確さを固める。
 */
describe("matchesBuffettFilter", () => {
  const item = (buy: string | null, pv: string | null) => ({
    wouldBuyNow: buy,
    priceVsValue: pv,
  });

  it("ALL はすべて通す（判定が無い銘柄も含む）", () => {
    expect(matchesBuffettFilter(item(null, null), "ALL")).toBe(true);
    expect(matchesBuffettFilter(item("YES", "VALUE_AHEAD"), "ALL")).toBe(true);
  });

  it("今からは買わないを抽出する", () => {
    expect(matchesBuffettFilter(item("NO", "PRICE_AHEAD"), "NOT_BUY_NOW")).toBe(true);
    expect(matchesBuffettFilter(item("NO", "IN_LINE"), "NOT_BUY_NOW")).toBe(true);
    expect(matchesBuffettFilter(item("YES", "PRICE_AHEAD"), "NOT_BUY_NOW")).toBe(false);
    expect(matchesBuffettFilter(item("UNCLEAR", "PRICE_AHEAD"), "NOT_BUY_NOW")).toBe(false);
  });

  it("株価が中身より速い銘柄を抽出する", () => {
    expect(matchesBuffettFilter(item("YES", "PRICE_AHEAD"), "PRICE_AHEAD")).toBe(true);
    expect(matchesBuffettFilter(item("NO", "VALUE_AHEAD"), "PRICE_AHEAD")).toBe(false);
  });

  it("買わない かつ 株価先行の組み合わせを抽出する", () => {
    /*
     * この 2 つが同時に成り立つ銘柄が最も注意すべき対象。
     * 借入がある状態で、中身が伴わないまま上がった株を持ち続けている。
     */
    expect(matchesBuffettFilter(item("NO", "PRICE_AHEAD"), "OVERHEATED")).toBe(true);
    expect(matchesBuffettFilter(item("NO", "IN_LINE"), "OVERHEATED")).toBe(false);
    expect(matchesBuffettFilter(item("YES", "PRICE_AHEAD"), "OVERHEATED")).toBe(false);
  });

  it("判断材料が足りない銘柄はどちらの軸でも拾う", () => {
    expect(matchesBuffettFilter(item("UNCLEAR", "IN_LINE"), "UNCLEAR")).toBe(true);
    expect(matchesBuffettFilter(item("YES", "UNKNOWN"), "UNCLEAR")).toBe(true);
    expect(matchesBuffettFilter(item("YES", "VALUE_AHEAD"), "UNCLEAR")).toBe(false);
  });

  it("判定が入っていない銘柄は ALL 以外では除外する", () => {
    /*
     * null を UNCLEAR に混ぜると「AI が材料不足と答えた銘柄」の
     * 実数が分からなくなる。まだ判定していないのと、
     * 判定した結果分からなかったのは別の状態。
     */
    for (const f of BUFFETT_FILTERS) {
      if (f === "ALL") continue;
      expect(matchesBuffettFilter(item(null, null), f)).toBe(false);
    }
  });

  it("片方だけ判定がある場合も正しく扱う", () => {
    expect(matchesBuffettFilter(item("NO", null), "NOT_BUY_NOW")).toBe(true);
    expect(matchesBuffettFilter(item(null, "PRICE_AHEAD"), "PRICE_AHEAD")).toBe(true);
    // 組み合わせ条件は両方揃っていないと成立しない
    expect(matchesBuffettFilter(item("NO", null), "OVERHEATED")).toBe(false);
  });
});

describe("parseBuffettFilter", () => {
  it("正しい値を読み取る", () => {
    expect(parseBuffettFilter("?lens=PRICE_AHEAD")).toBe("PRICE_AHEAD");
    expect(parseBuffettFilter("?lens=OVERHEATED")).toBe("OVERHEATED");
  });

  it("不正な値や未指定は null にする", () => {
    expect(parseBuffettFilter("")).toBeNull();
    expect(parseBuffettFilter("?lens=")).toBeNull();
    expect(parseBuffettFilter("?lens=NOT_A_FILTER")).toBeNull();
    expect(parseBuffettFilter("?broker=ibkr")).toBeNull();
  });
});

describe("countBuffettBreakdown", () => {
  it("区分ごとの件数を数える", () => {
    const items = [
      { wouldBuyNow: "NO", priceVsValue: "PRICE_AHEAD" },
      { wouldBuyNow: "NO", priceVsValue: "IN_LINE" },
      { wouldBuyNow: "YES", priceVsValue: "VALUE_AHEAD" },
      { wouldBuyNow: "UNCLEAR", priceVsValue: "UNKNOWN" },
      { wouldBuyNow: null, priceVsValue: null },
    ];
    const map = new Map(countBuffettBreakdown(items).map(r => [r.filter, r.count]));
    expect(map.get("NOT_BUY_NOW")).toBe(2);
    expect(map.get("PRICE_AHEAD")).toBe(1);
    expect(map.get("OVERHEATED")).toBe(1);
    expect(map.get("BUY_NOW")).toBe(1);
    expect(map.get("VALUE_AHEAD")).toBe(1);
    expect(map.get("UNCLEAR")).toBe(1);
    // ALL は内訳に含めない（全件と同じで情報にならない）
    expect(map.has("ALL")).toBe(false);
  });

  it("実データの分布を再現できる", () => {
    /*
     * 実測: 今から買う 65 / 判断できない 35 / 買わない 12。
     * 合計 112 になることを確かめる（取りこぼしがあると内訳が信用できない）。
     */
    const items = [
      ...Array(65).fill({ wouldBuyNow: "YES", priceVsValue: "VALUE_AHEAD" }),
      ...Array(35).fill({ wouldBuyNow: "UNCLEAR", priceVsValue: "IN_LINE" }),
      ...Array(12).fill({ wouldBuyNow: "NO", priceVsValue: "PRICE_AHEAD" }),
    ];
    const map = new Map(countBuffettBreakdown(items).map(r => [r.filter, r.count]));
    expect(map.get("BUY_NOW")! + map.get("UNCLEAR")! + map.get("NOT_BUY_NOW")!).toBe(112);
  });
});

describe("countUnjudged", () => {
  it("判定がまったく入っていない銘柄を数える", () => {
    expect(
      countUnjudged([
        { wouldBuyNow: null, priceVsValue: null },
        { wouldBuyNow: "YES", priceVsValue: null },
        { wouldBuyNow: null, priceVsValue: "IN_LINE" },
      ])
    ).toBe(1);
  });

  it("実データでは 0 件になる", () => {
    const items = Array(112).fill({ wouldBuyNow: "YES", priceVsValue: "VALUE_AHEAD" });
    expect(countUnjudged(items)).toBe(0);
  });
});
