/**
 * 利息で増える現金性資産（貨幣市場基金・現金宝）の集計。
 *
 * 富途香港の実データで検証する:
 *   美元基金 USD 586,653.54（易方達 145,297.62 / 平安 370,671.26 / 華夏 70,684.66）
 *   港元基金 HKD 37,556.86（高騰微財）
 *   年約 3.4%・毎日付利・複利
 */
import { describe, expect, it } from "vitest";
import type { InterestAsset } from "../drizzle/schema";
import {
  buildInterestAssetViews,
  impliedAnnualRate,
  projectAnnualIncome,
  summarizeInterestAssets,
} from "./services/interestAssets";

const fx = { usdJpy: 159.31, sgdJpy: 124.56, hkdJpy: 20.3064 };

function asset(over: Partial<InterestAsset>): InterestAsset {
  return {
    id: 1,
    userId: 1,
    broker: "futu_hk",
    name: "テスト基金",
    currency: "USD",
    amount: "100000.00",
    annualRatePct: "3.4000",
    dailyIncome: null,
    cumulativeIncome: null,
    compounding: true,
    capturedAt: new Date("2026-08-17T02:14:00Z"),
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as InterestAsset;
}

describe("projectAnnualIncome", () => {
  it("複利は単利より多くなる（日次で元本に組み入れられるため）", () => {
    const simple = projectAnnualIncome(100000, 3.4, false);
    const compound = projectAnnualIncome(100000, 3.4, true);
    expect(simple).toBeCloseTo(3400, 2);
    expect(compound).not.toBeNull();
    expect(compound!).toBeGreaterThan(simple!);
    // 3.4% を日次複利で回すと実質 3.4585%
    expect(compound!).toBeCloseTo(3458.5, 0);
  });

  it("実データ: 美元基金 586,653.54 ドルを年 3.4% 複利で 1 年", () => {
    const income = projectAnnualIncome(586653.54, 3.4, true);
    expect(income).not.toBeNull();
    // 約 20,290 ドル
    expect(income!).toBeCloseTo(20290, -1);
  });

  it("利率が未記録なら見込みを出さない（0 と混同させない）", () => {
    expect(projectAnnualIncome(100000, null, true)).toBeNull();
  });

  it("元本が 0 以下なら見込みを出さない", () => {
    expect(projectAnnualIncome(0, 3.4, true)).toBeNull();
    expect(projectAnnualIncome(-1000, 3.4, true)).toBeNull();
  });
});

describe("impliedAnnualRate", () => {
  it("前日利息から年利を逆算する（易方達 145,297.62 ドルで +8.66 ドル）", () => {
    const rate = impliedAnnualRate(145297.62, 8.66);
    expect(rate).not.toBeNull();
    // 8.66 / 145,297.62 × 365 = 2.175%
    expect(rate!).toBeCloseTo(2.175, 2);
  });

  it("平安貨幣基金 370,671.26 ドルで +37.88 ドル", () => {
    const rate = impliedAnnualRate(370671.26, 37.88);
    expect(rate).not.toBeNull();
    // 3.73% で、表示利率 3.4% に近い
    expect(rate!).toBeCloseTo(3.73, 1);
  });

  it("前日利息が無ければ逆算しない", () => {
    expect(impliedAnnualRate(100000, null)).toBeNull();
  });
});

describe("buildInterestAssetViews", () => {
  it("USD の評価額を円換算する", () => {
    const [v] = buildInterestAssetViews([asset({ amount: "586653.54" })], fx);
    expect(v.amountBase).toBeCloseTo(586653.54 * 159.31, 0);
  });

  it("HKD の評価額も円換算する（港元基金 37,556.86）", () => {
    const [v] = buildInterestAssetViews(
      [asset({ currency: "HKD", amount: "37556.86" })],
      fx
    );
    expect(v.amountBase).toBeCloseTo(37556.86 * 20.3064, 0);
  });

  it("レートが無い通貨は null にして 1 円で混ぜない", () => {
    const [v] = buildInterestAssetViews([asset({ currency: "EUR", amount: "1000" })], fx);
    expect(v.amountBase).toBeNull();
  });

  it("累計収益も円換算する（易方達 +697.62 ドル）", () => {
    const [v] = buildInterestAssetViews(
      [asset({ amount: "145297.62", cumulativeIncome: "697.62" })],
      fx
    );
    expect(v.cumulativeIncomeBase).toBeCloseTo(697.62 * 159.31, 0);
  });
});

describe("summarizeInterestAssets", () => {
  /** 富途香港の 4 本の基金（実データ） */
  const rows = [
    asset({ id: 1, name: "易方達(香港)美元貨幣市場基金", currency: "USD", amount: "145297.62", dailyIncome: "8.66", cumulativeIncome: "697.62" }),
    asset({ id: 2, name: "平安貨幣基金", currency: "USD", amount: "370671.26", dailyIncome: "37.88", cumulativeIncome: "2308.49" }),
    asset({ id: 3, name: "華夏精選美元貨幣基金", currency: "USD", amount: "70684.66", dailyIncome: "6.73", cumulativeIncome: "571.81" }),
    asset({ id: 4, name: "高騰微財貨幣基金", currency: "HKD", amount: "37556.86", dailyIncome: "2.19", cumulativeIncome: "839.74" }),
  ];

  it("合計が画面の資産淨值に近い（¥94,347,006 に対し為替差のみ）", () => {
    const s = summarizeInterestAssets(buildInterestAssetViews(rows, fx));
    // 美元 586,653.54 × 159.31 + 港元 37,556.86 × 20.3064
    const expected = 586653.54 * 159.31 + 37556.86 * 20.3064;
    expect(s.totalBase).toBeCloseTo(expected, 0);
    // 画面表示 94,347,006 との差は 0.2% 以内
    expect(Math.abs(s.totalBase - 94347006) / 94347006).toBeLessThan(0.002);
  });

  it("通貨別の内訳が額の大きい順に並ぶ", () => {
    const s = summarizeInterestAssets(buildInterestAssetViews(rows, fx));
    expect(s.byCurrency.map(c => c.currency)).toEqual(["USD", "HKD"]);
    expect(s.byCurrency[0].amount).toBeCloseTo(586653.54, 2);
    expect(s.byCurrency[1].amount).toBeCloseTo(37556.86, 2);
  });

  it("加重平均利回りが記録した利率に近い", () => {
    const s = summarizeInterestAssets(buildInterestAssetViews(rows, fx));
    expect(s.weightedRatePct).not.toBeNull();
    // 全部 3.4% 複利なので実質 3.4585% になる
    expect(s.weightedRatePct!).toBeCloseTo(3.4585, 2);
  });

  it("累計収益を合計する", () => {
    const s = summarizeInterestAssets(buildInterestAssetViews(rows, fx));
    const expected =
      (697.62 + 2308.49 + 571.81) * 159.31 + 839.74 * 20.3064;
    expect(s.cumulativeIncomeBase).toBeCloseTo(expected, 0);
  });

  it("換算できない通貨があれば合計に入れず、その事実を伝える", () => {
    const withEur = [...rows, asset({ id: 5, currency: "EUR", amount: "10000" })];
    const s = summarizeInterestAssets(buildInterestAssetViews(withEur, fx));
    expect(s.hasUnconvertible).toBe(true);
    // EUR は合計に入らないので 4 本だけの合計と同じ
    const only4 = summarizeInterestAssets(buildInterestAssetViews(rows, fx));
    expect(s.totalBase).toBeCloseTo(only4.totalBase, 2);
    expect(s.count).toBe(5);
  });

  it("空なら合計 0 で利回りは出さない", () => {
    const s = summarizeInterestAssets([]);
    expect(s.totalBase).toBe(0);
    expect(s.weightedRatePct).toBeNull();
    expect(s.count).toBe(0);
  });
});
