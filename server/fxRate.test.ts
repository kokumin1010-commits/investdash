import { describe, expect, it } from "vitest";

/**
 * 為替レート自動取得の妥当性チェックのテスト。
 *
 * 為替レートは米国株の評価額に直接掛かるため、異常値をそのまま採用すると
 * 総資産が桁違いに壊れる。syncFxRate と同じ判定条件をここで固定しておく。
 */

/** syncFxRate が採用する値かどうか（server/services/portfolio.ts と同じ条件） */
function isAcceptableRate(rate: number | null): boolean {
  if (rate === null || !Number.isFinite(rate)) return false;
  return rate >= 50 && rate <= 500;
}

describe("為替レートの妥当性チェック", () => {
  it("実勢に近い値は採用する", () => {
    expect(isAcceptableRate(159.305)).toBe(true);
    expect(isAcceptableRate(150)).toBe(true);
    expect(isAcceptableRate(179.05)).toBe(true);
  });

  it("取得失敗（null）は採用しない", () => {
    // 既存の設定値を維持するのが安全側の挙動
    expect(isAcceptableRate(null)).toBe(false);
  });

  it("0 や負値は採用しない", () => {
    // 0 を採用すると米国株の評価額がすべて 0 円になる
    expect(isAcceptableRate(0)).toBe(false);
    expect(isAcceptableRate(-159)).toBe(false);
  });

  it("NaN や Infinity は採用しない", () => {
    // API の仕様変更でパースに失敗した場合を想定
    expect(isAcceptableRate(NaN)).toBe(false);
    expect(isAcceptableRate(Infinity)).toBe(false);
  });

  it("明らかに桁が違う値は採用しない", () => {
    // 1 ドル 1 円や 1 ドル 1 万円は現実的にありえない
    expect(isAcceptableRate(1)).toBe(false);
    expect(isAcceptableRate(49.9)).toBe(false);
    expect(isAcceptableRate(500.1)).toBe(false);
    expect(isAcceptableRate(15930.5)).toBe(false);
  });

  it("境界値はそのまま採用する", () => {
    expect(isAcceptableRate(50)).toBe(true);
    expect(isAcceptableRate(500)).toBe(true);
  });
});

describe("為替レートが評価額に与える影響", () => {
  /** 米国株の評価額（ドル）。実データの合計 */
  const usdValue = 193_842.54;

  it("レートの違いが円換算額に比例して現れる", () => {
    const at150 = usdValue * 150;
    const at159 = usdValue * 159.305;
    expect(Math.round(at150)).toBe(29_076_381);
    expect(Math.round(at159)).toBe(30_880_086);
    // 150 円のままだと約 180 万円低く出る
    expect(Math.round(at159 - at150)).toBe(1_803_705);
  });
});
