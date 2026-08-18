/**
 * 買い増し提案の株数と「待つ」銘柄の到達時金額のテスト。
 *
 * 画面では「4 銘柄に買いの結論」と出しながら実際は買い 3 件・待ち 1 件
 * という食い違いが起きていた。件数の数え方と、待つ銘柄に金額を出す
 * 条件を固定する。
 */
import { describe, expect, it } from "vitest";
import { computeAddSizing } from "../shared/addSizing";
import { sharesForAmount, actualAmount, lotSizeUncertain } from "../shared/addShares";

/** 画面側の件数集計と同じ数え方 */
function countByStance(rows: Array<{ stance: string }>) {
  return {
    buy: rows.filter(r => r.stance === "BUY").length,
    wait: rows.filter(r => r.stance === "WAIT").length,
    skip: rows.filter(r => r.stance === "SKIP").length,
  };
}

describe("提案の件数の数え方", () => {
  it("買いの件数に待ちを含めない", () => {
    // 実測で出ていた組み合わせ（買い 3・待ち 1）
    const rows = [
      { stance: "WAIT" },
      { stance: "BUY" },
      { stance: "BUY" },
      { stance: "BUY" },
    ];
    const c = countByStance(rows);
    expect(c.buy).toBe(3);
    expect(c.wait).toBe(1);
  });

  it("見送りは買いにも待ちにも含めない", () => {
    const c = countByStance([{ stance: "SKIP" }, { stance: "BUY" }]);
    expect(c.buy).toBe(1);
    expect(c.wait).toBe(0);
    expect(c.skip).toBe(1);
  });

  it("提案が空なら 0 件", () => {
    const c = countByStance([]);
    expect(c.buy).toBe(0);
    expect(c.wait).toBe(0);
  });
});

describe("待つ銘柄の到達時の金額と株数", () => {
  /** 実データに近い規模: 株式時価 8.6 億円・現金性 8,861 万円・預り金 126 万円 */
  const TOTAL = 860_000_000;
  const INTEREST = 88_610_000;
  const CASH = 1_260_000;

  it("待ち価格で割った株数を出す（米国株は 1 株単位）", () => {
    // アルファベット: 構成比 2.2%（1,892 万円）・待ち価格 $342.65
    const sizing = computeAddSizing(TOTAL, INTEREST, CASH, 18_920_000);
    expect(sizing).not.toBeNull();
    const amountLocal = sizing!.suggestedBase / 159.31; // USD/JPY
    const shares = sharesForAmount(amountLocal, 342.65, "US");
    expect(shares).not.toBeNull();
    // 1 株単位なので端数のない整数になる
    expect(Number.isInteger(shares!)).toBe(true);
    expect(shares!).toBeGreaterThan(0);
    // 丸めた実額が 1 回分の枠を超えない
    const actual = actualAmount(shares!, 342.65)! * 159.31;
    expect(actual).toBeLessThanOrEqual(sizing!.suggestedBase);
  });

  it("日本株は 100 株単位に丸める", () => {
    // 伊藤忠商事: 待ち価格 1,850 円
    const sizing = computeAddSizing(TOTAL, INTEREST, CASH, 14_600_000);
    const shares = sharesForAmount(sizing!.suggestedBase, 1850, "JP");
    expect(shares! % 100).toBe(0);
    expect(shares!).toBeGreaterThan(0);
  });

  it("上限に達している銘柄には到達時の金額を出さない", () => {
    // 構成比 5.6% = 上限超（買っても構成比が下がらない）
    const sizing = computeAddSizing(TOTAL, INTEREST, CASH, 48_160_000);
    expect(sizing!.atCap).toBe(true);
    // atCap のときは金額を出さない判断になる
    expect(sizing!.suggestedBase).toBe(0);
  });

  it("香港株は単元が不明なので確認を促す", () => {
    expect(lotSizeUncertain("HK")).toBe(true);
    expect(lotSizeUncertain("JP")).toBe(false);
    expect(lotSizeUncertain("US")).toBe(false);
  });

  it("株価が取得できていなければ株数を出さない", () => {
    expect(sharesForAmount(11_910_000, 0, "JP")).toBeNull();
  });

  it("1 単元も買えない金額では 0 を返す（不明と区別する）", () => {
    // 1 株 5 万円の銘柄を 100 株単位（500 万円）で、原資 10 万円のとき
    expect(sharesForAmount(100_000, 50_000, "JP")).toBe(0);
  });
});
