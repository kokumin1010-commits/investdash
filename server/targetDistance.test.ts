import { describe, expect, it } from "vitest";
import {
  computeTargetDistance,
  targetDistanceNote,
  TARGET_DISTANCE_LABELS,
} from "../shared/targetDistance";

describe("目標価格の距離の判定", () => {
  it("目標が未設定なら距離を測らない", () => {
    const d = computeTargetDistance(3765, null);
    expect(d.level).toBe("NO_TARGET");
    expect(d.gapPct).toBeNull();
    expect(d.needsRework).toBe(false);
  });

  it("現在値が取得できていない場合も距離を測らない", () => {
    expect(computeTargetDistance(null, 1900).level).toBe("NO_TARGET");
  });

  it("現在値が 0 以下なら割り算を避ける", () => {
    expect(computeTargetDistance(0, 100).level).toBe("NO_TARGET");
    expect(computeTargetDistance(-5, 100).gapPct).toBeNull();
  });

  it("INPEX の実データ（3,765 円に対し目標 1,900 円）を遠すぎると判定する", () => {
    const d = computeTargetDistance(3765, 1900);
    expect(d.level).toBe("TOO_FAR");
    expect(d.gapPct).toBeCloseTo(-49.5, 1);
    expect(d.needsRework).toBe(true);
  });

  it("CVX の実データ（$200 に対し目標 $142）は境目の手前でやや遠いに留まる", () => {
    const d = computeTargetDistance(200, 142);
    // -29.0% は -30% の境目に届かないため FAR。機械的に書き換える対象にはしない
    expect(d.level).toBe("FAR");
    expect(d.gapPct).toBeCloseTo(-29, 1);
    expect(d.needsRework).toBe(false);
  });

  it("Jパワーの実データ（3,943 円に対し目標 3,150 円）はやや遠いに留める", () => {
    const d = computeTargetDistance(3943, 3150);
    expect(d.level).toBe("FAR");
    expect(d.gapPct).toBeCloseTo(-20.1, 1);
    // -20% 台の調整は実際に起こりうるため、機械的に書き換えない
    expect(d.needsRework).toBe(false);
  });

  it("A17U.SI の実データ（2.44 に対し目標 2.24）は現実的と判定する", () => {
    const d = computeTargetDistance(2.44, 2.24);
    expect(d.level).toBe("NEAR");
    expect(d.gapPct).toBeCloseTo(-8.2, 1);
    expect(d.needsRework).toBe(false);
  });

  it("現在値が目標以下なら到達とする", () => {
    expect(computeTargetDistance(140, 142).level).toBe("REACHED");
    expect(computeTargetDistance(142, 142).level).toBe("REACHED");
  });

  it("到達直後の値動きで警告が点滅しないよう +10% までは到達扱いにする", () => {
    // 現在 100 / 目標 109 は 9% 上。日々の値動きの範囲なので到達のまま
    expect(computeTargetDistance(100, 109).level).toBe("REACHED");
    // +10% を超えたら目標の置き方自体がおかしい
    const d = computeTargetDistance(100, 111);
    expect(d.level).toBe("ABOVE_MARKET");
    expect(d.needsRework).toBe(true);
  });

  it("閾値ちょうどは遠い側に含める", () => {
    // -30% ちょうどは TOO_FAR
    expect(computeTargetDistance(100, 70).level).toBe("TOO_FAR");
    // -29.9% は FAR に留まる
    expect(computeTargetDistance(100, 70.1).level).toBe("FAR");
    // -20% ちょうどは FAR
    expect(computeTargetDistance(100, 80).level).toBe("FAR");
    // -19.9% は NEAR
    expect(computeTargetDistance(100, 80.1).level).toBe("NEAR");
  });

  it("作り直しが必要な区分だけ needsRework が立つ", () => {
    const levels = [
      computeTargetDistance(100, null),
      computeTargetDistance(100, 95),
      computeTargetDistance(100, 85),
      computeTargetDistance(100, 60),
      computeTargetDistance(100, 130),
    ];
    expect(levels.map(d => d.needsRework)).toEqual([false, false, false, true, true]);
  });

  it("説明文は何をすべきかまで書く", () => {
    const tooFar = targetDistanceNote(computeTargetDistance(3765, 1900));
    expect(tooFar).toContain("49.5%");
    expect(tooFar).toContain("買わない");

    const above = targetDistanceNote(computeTargetDistance(100, 130));
    expect(above).toContain("見直して");

    // 問題ない区分では余計な文言を出さない
    expect(targetDistanceNote(computeTargetDistance(2.44, 2.24))).toBeNull();
    expect(targetDistanceNote(computeTargetDistance(100, null))).toBeNull();
  });

  it("すべての区分にラベルがある", () => {
    const levels = [
      "NO_TARGET",
      "REACHED",
      "NEAR",
      "FAR",
      "TOO_FAR",
      "ABOVE_MARKET",
    ] as const;
    levels.forEach(l => expect(TARGET_DISTANCE_LABELS[l]).toBeTruthy());
  });
});
