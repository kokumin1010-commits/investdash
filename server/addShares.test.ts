import { describe, expect, it } from "vitest";
import { actualAmount, lotSizeFor, lotSizeUncertain, sharesForAmount } from "../shared/addShares";

describe("単元株の扱い", () => {
  it("日本株は 100 株単位、米国株・SG 株は 1 株単位", () => {
    expect(lotSizeFor("JP")).toBe(100);
    expect(lotSizeFor("US")).toBe(1);
    expect(lotSizeFor("SG")).toBe(1);
  });

  it("香港株は銘柄ごとに単元が異なるため確認が必要と示す", () => {
    // 実データの 0005.HK / 2318.HK などは単元が 100〜2,000 株で銘柄別。
    // 誤った単元で断定するより、確認を促す方が誤発注を防げる。
    expect(lotSizeUncertain("HK")).toBe(true);
    expect(lotSizeUncertain("JP")).toBe(false);
    expect(lotSizeUncertain("US")).toBe(false);
  });
});

describe("買い増し株数の算定", () => {
  it("日本株は 100 株単位に切り捨てる（三菱商事の実データ）", () => {
    // 1,191 万円 ÷ 4,775 円 = 2,500.5 株 → 2,500 株
    expect(sharesForAmount(11_942_500, 4_775, "JP")).toBe(2_500);
  });

  it("米国株は 1 株単位で計算する（ブロードコムの実データ）", () => {
    // 74,561.7 USD ÷ 392.43 USD = 190.0 株
    expect(sharesForAmount(74_561.7, 392.43, "US")).toBe(190);
  });

  it("金額を超える株数は出さない", () => {
    // 切り上げると提示金額を超え、1 銘柄の上限（資産の 5%）を破る
    const shares = sharesForAmount(1_000, 300, "US");
    expect(shares).toBe(3);
    expect(shares! * 300).toBeLessThanOrEqual(1_000);
  });

  it("1 単元も買えない場合は 0 を返す（買えないことを伝える）", () => {
    // 5 万円ではトヨタ 100 株（約 30 万円）に届かない
    expect(sharesForAmount(50_000, 3_016, "JP")).toBe(0);
  });

  it("株価が未取得なら株数を出さない", () => {
    expect(sharesForAmount(100_000, 0, "JP")).toBeNull();
    expect(sharesForAmount(100_000, Number.NaN, "US")).toBeNull();
  });

  it("金額が 0 以下なら株数を出さない", () => {
    expect(sharesForAmount(0, 3_016, "JP")).toBeNull();
    expect(sharesForAmount(-100, 3_016, "JP")).toBeNull();
  });
});

describe("丸めた後の実際の金額", () => {
  it("株数 × 株価で出す（表示金額と株数が食い違わないため）", () => {
    expect(actualAmount(2_500, 4_775)).toBe(11_937_500);
  });

  it("株数が 0 なら金額も出さない", () => {
    expect(actualAmount(0, 4_775)).toBeNull();
  });
});
