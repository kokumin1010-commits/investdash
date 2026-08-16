/**
 * 表示通貨切り替えのテスト。
 *
 * この機能で守りたいのは次の 3 点なので、それぞれを崩すと落ちるようにしている。
 * 1. 円で積み上げた集計値を表示通貨に換算するとき、比率が壊れないこと
 *    （表示だけ変えて並び順の基準と食い違うと、以前の「4 番目が小さく見える」問題が再発する）
 * 2. レートが取れていない（0 や負）ときに 0 や Infinity を出さず null で「出せない」と伝えること
 * 3. 現地通貨と表示通貨が同じときに同じ数字を二度出さないこと
 */
import { describe, expect, it } from "vitest";
import {
  DISPLAY_CURRENCIES,
  convertFromBase,
  isDisplayCurrency,
  resolveDisplayCurrencyCode,
  shouldShowLocalHint,
  type FxRates,
} from "../shared/displayCurrency";

/** 実際に自動取得している値（2026/8/16 時点）を使う */
const fx: FxRates = { usdJpy: 159.305, sgdJpy: 124.564 };

describe("convertFromBase", () => {
  it("円を選んだときは換算せずそのまま返す", () => {
    expect(convertFromBase(45_300_000, "JPY", fx)).toBe(45_300_000);
  });

  it("USD へはレートで割る（トヨタの評価額 ¥4530万 → 約 $28.4万）", () => {
    const usd = convertFromBase(45_300_000, "USD", fx);
    expect(usd).not.toBeNull();
    expect(usd!).toBeCloseTo(45_300_000 / 159.305, 6);
    // 画面表示の「$28.4万」と桁が合うこと
    expect(Math.round(usd!)).toBe(284_360);
  });

  it("SGD へはレートで割る（ウィルマー ¥1863.8万 → 約 SGD 15万）", () => {
    const sgd = convertFromBase(18_638_000, "SGD", fx);
    expect(sgd).not.toBeNull();
    expect(Math.round(sgd!)).toBe(149_626);
  });

  it("換算しても金額の大小関係が入れ替わらない", () => {
    // 円換算で 双日 > オラクル の順。以前は表示が現地通貨のままで逆に見えていた
    const sojitzJpy = 28_988_400;
    const oracleJpy = 23_043_424;
    for (const target of ["USD", "JPY", "SGD"] as const) {
      const a = convertFromBase(sojitzJpy, target, fx)!;
      const b = convertFromBase(oracleJpy, target, fx)!;
      expect(a).toBeGreaterThan(b);
    }
  });

  it("LOCAL は円換算値から復元できないので null を返す", () => {
    // 「換算しない」選択なので、呼び出し側は現地通貨の値をそのまま使う必要がある
    expect(convertFromBase(45_300_000, "LOCAL", fx)).toBeNull();
  });

  it("値が無いときは null を返す", () => {
    expect(convertFromBase(null, "USD", fx)).toBeNull();
    expect(convertFromBase(undefined, "USD", fx)).toBeNull();
    expect(convertFromBase(Number.NaN, "USD", fx)).toBeNull();
  });

  it("レートが取れていないときは 0 や Infinity を出さず null を返す", () => {
    // レート 0 で割ると Infinity になり、画面に「$Infinity」と出てしまう
    expect(convertFromBase(45_300_000, "USD", { usdJpy: 0, sgdJpy: 124.564 })).toBeNull();
    expect(convertFromBase(45_300_000, "SGD", { usdJpy: 159.305, sgdJpy: 0 })).toBeNull();
    expect(convertFromBase(45_300_000, "USD", { usdJpy: -1, sgdJpy: 124.564 })).toBeNull();
  });

  it("片方のレートが欠けてももう片方の換算は動く", () => {
    const broken: FxRates = { usdJpy: 159.305, sgdJpy: 0 };
    expect(convertFromBase(45_300_000, "USD", broken)).not.toBeNull();
    expect(convertFromBase(45_300_000, "SGD", broken)).toBeNull();
  });

  it("損失（マイナス）も符号を保って換算する", () => {
    const loss = convertFromBase(-2_878_000, "USD", fx);
    expect(loss).not.toBeNull();
    expect(loss!).toBeLessThan(0);
  });

  it("0 円は 0 のまま返し null にしない", () => {
    // Mapletree Logistics Trust のように損益が 0.00 の銘柄がある。
    // null 扱いにすると「—」と出て「取得できていない」と誤解される
    expect(convertFromBase(0, "USD", fx)).toBe(0);
    expect(convertFromBase(0, "JPY", fx)).toBe(0);
  });
});

describe("resolveDisplayCurrencyCode", () => {
  it("統一表示のときは銘柄の通貨に関係なく選択通貨を使う", () => {
    expect(resolveDisplayCurrencyCode("USD", "JPY")).toBe("USD");
    expect(resolveDisplayCurrencyCode("JPY", "SGD")).toBe("JPY");
    expect(resolveDisplayCurrencyCode("SGD", "USD")).toBe("SGD");
  });

  it("LOCAL のときは銘柄の通貨を使う", () => {
    expect(resolveDisplayCurrencyCode("LOCAL", "SGD")).toBe("SGD");
    expect(resolveDisplayCurrencyCode("LOCAL", "USD")).toBe("USD");
  });

  it("LOCAL で銘柄の通貨が不明なときは円として扱う", () => {
    expect(resolveDisplayCurrencyCode("LOCAL", null)).toBe("JPY");
    expect(resolveDisplayCurrencyCode("LOCAL", "")).toBe("JPY");
  });
});

describe("shouldShowLocalHint", () => {
  it("表示通貨と現地通貨が違うときは併記する", () => {
    // USD 表示の日本株 → 「$28.4万（¥4530万）」
    expect(shouldShowLocalHint("USD", "JPY")).toBe(true);
    expect(shouldShowLocalHint("USD", "SGD")).toBe(true);
    expect(shouldShowLocalHint("JPY", "USD")).toBe(true);
  });

  it("同じ通貨なら同じ数字が二度出るので併記しない", () => {
    expect(shouldShowLocalHint("USD", "USD")).toBe(false);
    expect(shouldShowLocalHint("JPY", "JPY")).toBe(false);
    expect(shouldShowLocalHint("SGD", "SGD")).toBe(false);
  });

  it("LOCAL 表示のときは主役が現地通貨なので併記しない", () => {
    expect(shouldShowLocalHint("LOCAL", "JPY")).toBe(false);
    expect(shouldShowLocalHint("LOCAL", "USD")).toBe(false);
  });

  it("現地通貨が不明なら併記しない", () => {
    expect(shouldShowLocalHint("USD", null)).toBe(false);
    expect(shouldShowLocalHint("USD", undefined)).toBe(false);
  });
});

describe("isDisplayCurrency", () => {
  it("保存済みの選択を読み戻すときに不正な値を弾く", () => {
    // localStorage は人が書き換えられるため、読み込み時に検証が必要
    for (const c of DISPLAY_CURRENCIES) expect(isDisplayCurrency(c)).toBe(true);
    expect(isDisplayCurrency("EUR")).toBe(false);
    expect(isDisplayCurrency("usd")).toBe(false);
    expect(isDisplayCurrency(null)).toBe(false);
    expect(isDisplayCurrency(123)).toBe(false);
  });
});
