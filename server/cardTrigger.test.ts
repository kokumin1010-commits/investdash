import { describe, expect, it } from "vitest";
import { CARD_NEWS_IMPACT, selectCardTargets, type CardCandidate } from "../shared/cardTrigger";

const base: CardCandidate = {
  symbol: "X",
  cardEmpty: true,
  valueJpy: 1_000_000,
  bandAction: null,
  hasEarningsNews: false,
  maxImpact: null,
};

describe("投資カードを作るべき銘柄の選別", () => {
  it("買い増し圏に入った銘柄を選ぶ", () => {
    const { targets } = selectCardTargets(
      [{ ...base, symbol: "NKE", bandAction: "ADD_SMALL" }],
      10
    );
    expect(targets).toHaveLength(1);
    expect(targets[0].reason).toBe("BAND");
  });

  it("減らす圏も対象にする（降りる条件がないまま売ると判断がぶれる）", () => {
    const { targets } = selectCardTargets([{ ...base, bandAction: "REDUCE" }], 10);
    expect(targets[0].reason).toBe("BAND");
  });

  it("静観のままの銘柄は選ばない（材料がなく一般論のカードになる）", () => {
    const { targets } = selectCardTargets([{ ...base, bandAction: "HOLD" }], 10);
    expect(targets).toHaveLength(0);
  });

  it("決算が出た銘柄を選ぶ", () => {
    const { targets } = selectCardTargets([{ ...base, hasEarningsNews: true }], 10);
    expect(targets[0].reason).toBe("EARNINGS");
  });

  it("影響度の高いニュースが出た銘柄を選ぶ", () => {
    const { targets } = selectCardTargets([{ ...base, maxImpact: CARD_NEWS_IMPACT }], 10);
    expect(targets[0].reason).toBe("NEWS");
  });

  it("影響度が基準未満のニュースだけでは選ばない", () => {
    const { targets } = selectCardTargets([{ ...base, maxImpact: CARD_NEWS_IMPACT - 1 }], 10);
    expect(targets).toHaveLength(0);
  });

  it("既に書かれているカードは作り直さない（手で直した内容が消える）", () => {
    const { targets } = selectCardTargets(
      [{ ...base, cardEmpty: false, bandAction: "ADD_MAIN", hasEarningsNews: true }],
      10
    );
    expect(targets).toHaveLength(0);
  });

  it("買い増し圏を決算・ニュースより先に処理する", () => {
    const { targets } = selectCardTargets(
      [
        { ...base, symbol: "NEWS_ONE", maxImpact: 95, valueJpy: 100_000_000 },
        { ...base, symbol: "EARN_ONE", hasEarningsNews: true, valueJpy: 90_000_000 },
        { ...base, symbol: "BAND_ONE", bandAction: "ADD_SMALL", valueJpy: 1_000 },
      ],
      10
    );
    expect(targets.map(t => t.symbol)).toEqual(["BAND_ONE", "EARN_ONE", "NEWS_ONE"]);
  });

  it("同じ理由なら評価額の大きい順（誤ったときの影響が大きい）", () => {
    const { targets } = selectCardTargets(
      [
        { ...base, symbol: "SMALL", bandAction: "ADD_SMALL", valueJpy: 1_000_000 },
        { ...base, symbol: "BIG", bandAction: "ADD_SMALL", valueJpy: 50_000_000 },
      ],
      10
    );
    expect(targets[0].symbol).toBe("BIG");
  });

  it("上限を超えた分は残り件数として返す（隠すと押しても増えないと誤解される）", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      symbol: `S${i}`,
      bandAction: "ADD_SMALL",
      valueJpy: i,
    }));
    const { targets, remaining } = selectCardTargets(many, 2);
    expect(targets).toHaveLength(2);
    expect(remaining).toBe(3);
  });

  it("対象がないときは空で返す", () => {
    const { targets, remaining } = selectCardTargets([], 10);
    expect(targets).toHaveLength(0);
    expect(remaining).toBe(0);
  });
});
