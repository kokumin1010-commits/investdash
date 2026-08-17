import { describe, it, expect } from "vitest";
import {
  bandRangeText,
  evaluateBands,
  isPriceInBand,
  sortBandsDesc,
  type BandInput,
} from "../shared/priceBands";

/**
 * Marvell の実際のプラン。ユーザーが AI に相談して作った段組み。
 *   160〜170 → 持有、急いで買い増さない
 *   145〜152 → 小幅追加
 *   125〜138 → 基本面未変時に主力で買い増す
 *   110 以下 → 大口顧客の喪失や AI 受注の悪化を確認してから判断
 */
function marvellBands(): BandInput[] {
  return [
    {
      id: 1,
      lowerPrice: 160,
      upperPrice: 170,
      action: "HOLD",
      actionLabel: "持有、急いで買い増さない",
      reason: null,
      checkItems: null,
      plannedAmount: null,
      sortOrder: 0,
    },
    {
      id: 2,
      lowerPrice: 145,
      upperPrice: 152,
      action: "ADD_SMALL",
      actionLabel: "小幅追加",
      reason: null,
      checkItems: null,
      plannedAmount: null,
      sortOrder: 1,
    },
    {
      id: 3,
      lowerPrice: 125,
      upperPrice: 138,
      action: "ADD_MAIN",
      actionLabel: "基本面未変時に主力で買い増す",
      reason: null,
      checkItems: null,
      plannedAmount: null,
      sortOrder: 2,
    },
    {
      id: 4,
      lowerPrice: null,
      upperPrice: 110,
      action: "VERIFY",
      actionLabel: "大口顧客の喪失や AI 受注の悪化を確認してから判断",
      reason: null,
      checkItems: ["大口顧客の喪失", "AI 受注の悪化"],
      plannedAmount: null,
      sortOrder: 3,
    },
  ];
}

describe("帯の中にあるかの判定", () => {
  const band = { lowerPrice: 145, upperPrice: 152 };

  it("範囲内なら true", () => {
    expect(isPriceInBand(148, band)).toBe(true);
  });

  it("境界はどちらも含む（以上・以下）", () => {
    expect(isPriceInBand(145, band)).toBe(true);
    expect(isPriceInBand(152, band)).toBe(true);
  });

  it("範囲外なら false", () => {
    expect(isPriceInBand(144.99, band)).toBe(false);
    expect(isPriceInBand(152.01, band)).toBe(false);
  });

  it("上限なし（〜以上）の帯を扱える", () => {
    const open = { lowerPrice: 200, upperPrice: null };
    expect(isPriceInBand(500, open)).toBe(true);
    expect(isPriceInBand(199, open)).toBe(false);
  });

  it("下限なし（〜以下）の帯を扱える", () => {
    // 「110 ドル以下」のように片側しか決まっていない段が実際に存在する
    const open = { lowerPrice: null, upperPrice: 110 };
    expect(isPriceInBand(50, open)).toBe(true);
    expect(isPriceInBand(110, open)).toBe(true);
    expect(isPriceInBand(110.01, open)).toBe(false);
  });
});

describe("帯の並び順", () => {
  it("高い順に並ぶ（表示は上が高値）", () => {
    const sorted = sortBandsDesc(marvellBands());
    expect(sorted.map(b => b.id)).toEqual([1, 2, 3, 4]);
  });

  it("入力の順番が崩れていても正しく並べ直す", () => {
    const shuffled = [marvellBands()[2], marvellBands()[0], marvellBands()[3], marvellBands()[1]];
    expect(sortBandsDesc(shuffled).map(b => b.id)).toEqual([1, 2, 3, 4]);
  });

  it("上限なしの帯は最上段に置く", () => {
    const bands: BandInput[] = [
      { ...marvellBands()[0] },
      {
        ...marvellBands()[0],
        id: 99,
        lowerPrice: 250,
        upperPrice: null,
        actionLabel: "高すぎるので売る候補",
      },
    ];
    expect(sortBandsDesc(bands)[0].id).toBe(99);
  });
});

describe("現在値の評価（Marvell の実データ）", () => {
  /*
   * 現在値 $222.02。プランの最上段（160〜170）より 30% ほど高い。
   * この状態で「持有、急いで買い増さない」を出すと誤解を生むので、
   * 帯の外にいることを明示しなければならない。
   */
  it("全ての帯より上にいる場合は帯を当てはめず abovePlan を返す", () => {
    const r = evaluateBands(222.02, marvellBands());
    expect(r.currentBand).toBeNull();
    expect(r.abovePlan).toBe(true);
    expect(r.belowPlan).toBe(false);
  });

  it("帯の外にいても次に入る帯と下落率を出せる", () => {
    const r = evaluateBands(222.02, marvellBands());
    // 一番上の帯（160〜170）に入るには 170 まで下がる必要がある
    expect(r.nextBand?.id).toBe(1);
    expect(r.nextBandPrice).toBe(170);
    // (170 - 222.02) / 222.02 = -23.4%
    expect(r.gapToNextPct).toBeCloseTo(-23.43, 1);
  });

  it("帯の中にいればその帯の行動を返す", () => {
    const r = evaluateBands(148, marvellBands());
    expect(r.currentBand?.id).toBe(2);
    expect(r.currentBand?.actionLabel).toBe("小幅追加");
    expect(r.abovePlan).toBe(false);
  });

  it("帯の中にいる場合の次の段は一つ下の帯", () => {
    const r = evaluateBands(148, marvellBands());
    // 148 の下にある帯で一番上は 125〜138
    expect(r.nextBand?.id).toBe(3);
    expect(r.nextBandPrice).toBe(138);
    expect(r.gapToNextPct).toBeCloseTo(-6.76, 1);
  });

  /*
   * 帯の隙間（152〜160、138〜145）に入ることは実際に起こる。
   * ユーザーが飛び飛びの価格帯を書いているため。
   * この場合も無理に近い帯を当てはめない。
   */
  it("帯の隙間にいる場合はどの帯にも当てはめない", () => {
    const r = evaluateBands(155, marvellBands());
    expect(r.currentBand).toBeNull();
    // 最上段より下なので abovePlan ではない
    expect(r.abovePlan).toBe(false);
    expect(r.belowPlan).toBe(false);
    // 次は 145〜152 の帯
    expect(r.nextBand?.id).toBe(2);
    expect(r.nextBandPrice).toBe(152);
  });

  it("下限なしの最下段に入っていれば確認項目つきの帯を返す", () => {
    const r = evaluateBands(95, marvellBands());
    expect(r.currentBand?.id).toBe(4);
    expect(r.currentBand?.checkItems).toEqual(["大口顧客の喪失", "AI 受注の悪化"]);
    // 最下段より下の帯はない
    expect(r.nextBand).toBeNull();
    expect(r.gapToNextPct).toBeNull();
  });

  it("株価が未取得なら何も判定しない", () => {
    const r = evaluateBands(null, marvellBands());
    expect(r.currentBand).toBeNull();
    expect(r.abovePlan).toBe(false);
    expect(r.nextBand).toBeNull();
  });

  it("帯が空なら何も判定しない", () => {
    const r = evaluateBands(222, []);
    expect(r.currentBand).toBeNull();
    expect(r.nextBand).toBeNull();
  });

  it("全ての帯より下にいる場合は belowPlan を返す", () => {
    // 最下段の下限が決まっているプランで検証する
    const bands = marvellBands().map(b =>
      b.id === 4 ? { ...b, lowerPrice: 100 } : b
    );
    const r = evaluateBands(80, bands);
    expect(r.currentBand).toBeNull();
    expect(r.belowPlan).toBe(true);
    expect(r.abovePlan).toBe(false);
  });
});

describe("帯の表示文字列", () => {
  it("上下ともある場合", () => {
    expect(bandRangeText({ lowerPrice: 145, upperPrice: 152 })).toBe("145 〜 152");
  });

  it("上限のみの場合は「以下」", () => {
    expect(bandRangeText({ lowerPrice: null, upperPrice: 110 })).toBe("110 以下");
  });

  it("下限のみの場合は「以上」", () => {
    expect(bandRangeText({ lowerPrice: 250, upperPrice: null })).toBe("250 以上");
  });

  it("小数のある価格でも桁が崩れない", () => {
    expect(bandRangeText({ lowerPrice: 1936.5, upperPrice: 2130.25 })).toBe("1,936.5 〜 2,130.25");
  });

  it("どちらもない場合", () => {
    expect(bandRangeText({ lowerPrice: null, upperPrice: null })).toBe("価格の指定なし");
  });
});
