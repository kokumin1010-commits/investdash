import { describe, it, expect } from "vitest";
import { normalizeBands, type PlannedBand } from "./services/priceBandPlanner";
import { evaluateBands, type BandInput } from "../shared/priceBands";

/**
 * AI が返した段組みを整える処理の検証。
 *
 * AI は段が重なった状態や順序が崩れた状態を返すことがある。
 * 重なったままだと「同じ株価で 2 つの行動が出る」ことになり判断できないので、
 * 保存前に必ず整える。
 */

function band(over: Partial<PlannedBand>): PlannedBand {
  return {
    lowerPrice: null,
    upperPrice: null,
    action: "HOLD",
    actionLabel: "様子見",
    reason: "テスト",
    checkItems: [],
    ...over,
  };
}

describe("価格帯の正規化", () => {
  it("高い順に並べ替える", () => {
    const result = normalizeBands([
      band({ lowerPrice: 125, upperPrice: 138 }),
      band({ lowerPrice: 160, upperPrice: 170 }),
      band({ lowerPrice: 145, upperPrice: 152 }),
    ]);
    expect(result.map(b => b.upperPrice)).toEqual([170, 152, 138]);
  });

  it("下限と上限が逆になっていたら入れ替える", () => {
    const result = normalizeBands([band({ lowerPrice: 170, upperPrice: 160 })]);
    expect(result[0].lowerPrice).toBe(160);
    expect(result[0].upperPrice).toBe(170);
  });

  /*
   * 重なりの解消。150〜170 と 140〜160 が返ってきた場合、
   * 155 では 2 つの帯に該当してしまう。下側の帯の上限を切り下げる。
   */
  it("段が重なっていたら下側の上限を切り下げる", () => {
    const result = normalizeBands([
      band({ lowerPrice: 150, upperPrice: 170 }),
      band({ lowerPrice: 140, upperPrice: 160 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].lowerPrice).toBe(150);
    expect(result[1].upperPrice).toBeCloseTo(149.99, 2);

    // 重なりが解消され、どの価格でも該当する帯は 1 つ以下になる
    const inputs: BandInput[] = result.map((b, i) => ({
      id: i,
      lowerPrice: b.lowerPrice,
      upperPrice: b.upperPrice,
      action: b.action,
      actionLabel: b.actionLabel,
      reason: b.reason,
      checkItems: b.checkItems,
      plannedAmount: null,
      sortOrder: i,
    }));
    for (const price of [139, 145, 149.99, 150, 155, 170, 171]) {
      const hits = inputs.filter(
        b =>
          (b.lowerPrice === null || price >= b.lowerPrice) &&
          (b.upperPrice === null || price <= b.upperPrice)
      );
      expect(hits.length).toBeLessThanOrEqual(1);
    }
  });

  it("切り下げても下限を上回るなら段は残す", () => {
    // 150〜170 と 148〜165 なら、下側の上限は 149.99 に切り下がる。
    // 下限 148 をまだ上回っているので 148〜149.99 の段として成立する。
    const result = normalizeBands([
      band({ lowerPrice: 150, upperPrice: 170 }),
      band({ lowerPrice: 148, upperPrice: 165 }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].lowerPrice).toBe(148);
    expect(result[1].upperPrice).toBeCloseTo(149.99, 2);
  });

  it("切り下げると下限を割ってしまう段は捨てる", () => {
    // 150〜170 と 150.5〜165 なら、下側の上限は 149.99 になり下限 150.5 を割る。
    // 成立しない段なので保存しない。
    const result = normalizeBands([
      band({ lowerPrice: 150, upperPrice: 170 }),
      band({ lowerPrice: 150.5, upperPrice: 165 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].lowerPrice).toBe(150);
  });

  it("隙間のある段はそのまま保つ（飛び飛びの水準は現実的な指定）", () => {
    const result = normalizeBands([
      band({ lowerPrice: 160, upperPrice: 170 }),
      band({ lowerPrice: 145, upperPrice: 152 }),
      band({ lowerPrice: 125, upperPrice: 138 }),
    ]);
    expect(result.map(b => [b.lowerPrice, b.upperPrice])).toEqual([
      [160, 170],
      [145, 152],
      [125, 138],
    ]);
  });

  it("下限なしの段（〜以下）を最下段として保つ", () => {
    const result = normalizeBands([
      band({ lowerPrice: 125, upperPrice: 138 }),
      band({ lowerPrice: null, upperPrice: 110, action: "VERIFY" }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[1].lowerPrice).toBeNull();
    expect(result[1].upperPrice).toBe(110);
    expect(result[1].action).toBe("VERIFY");
  });

  it("上限なしの段（〜以上）を最上段に置く", () => {
    const result = normalizeBands([
      band({ lowerPrice: 160, upperPrice: 170 }),
      band({ lowerPrice: 250, upperPrice: null, action: "REDUCE" }),
    ]);
    expect(result[0].action).toBe("REDUCE");
    expect(result[0].upperPrice).toBeNull();
  });

  it("空配列を渡しても落ちない", () => {
    expect(normalizeBands([])).toEqual([]);
  });
});

describe("正規化した段が判定ロジックと整合する", () => {
  it("Marvell のプランで現在値 222 が帯の外と判定される", () => {
    const normalized = normalizeBands([
      band({ lowerPrice: 160, upperPrice: 170, actionLabel: "持有" }),
      band({ lowerPrice: 145, upperPrice: 152, action: "ADD_SMALL", actionLabel: "小幅追加" }),
      band({ lowerPrice: 125, upperPrice: 138, action: "ADD_MAIN", actionLabel: "主力で買い増す" }),
      band({
        lowerPrice: null,
        upperPrice: 110,
        action: "VERIFY",
        actionLabel: "条件を確認",
        checkItems: ["大口顧客の喪失", "AI 受注の悪化"],
      }),
    ]);

    const inputs: BandInput[] = normalized.map((b, i) => ({
      id: i + 1,
      lowerPrice: b.lowerPrice,
      upperPrice: b.upperPrice,
      action: b.action,
      actionLabel: b.actionLabel,
      reason: b.reason,
      checkItems: b.checkItems,
      plannedAmount: null,
      sortOrder: i,
    }));

    const r = evaluateBands(222.02, inputs);
    expect(r.currentBand).toBeNull();
    expect(r.abovePlan).toBe(true);
    expect(r.nextBandPrice).toBe(170);
  });
});
