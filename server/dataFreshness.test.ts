import { describe, expect, it } from "vitest";
import {
  countBusinessDays,
  judgeFreshness,
  summarizeFreshness,
} from "../shared/dataFreshness";

/** 2026/8/18 は火曜。8/15 が土曜、8/16 が日曜 */
const TUE = new Date("2026-08-18T09:00:00+09:00");

describe("営業日の数え方", () => {
  it("土日を数えない（週末に警告が出ないようにするため）", () => {
    // 金曜 8/14 → 火曜 8/18 は営業日 2 日（月・火）
    expect(countBusinessDays(new Date("2026-08-14T15:30:00+09:00"), TUE)).toBe(2);
  });

  it("金曜の更新を月曜に見たときは 1 営業日（正常の範囲）", () => {
    expect(
      countBusinessDays(
        new Date("2026-08-14T15:30:00+09:00"),
        new Date("2026-08-17T09:00:00+09:00")
      )
    ).toBe(1);
  });

  it("同じ日なら 0", () => {
    expect(countBusinessDays(new Date("2026-08-18T06:30:00+09:00"), TUE)).toBe(0);
  });

  it("未来の時刻でも負の値を返さない", () => {
    expect(countBusinessDays(new Date("2026-08-20T00:00:00+09:00"), TUE)).toBe(0);
  });
});

describe("株価の鮮度判定", () => {
  it("当日の更新は最新とする", () => {
    const r = judgeFreshness(2884.5, new Date("2026-08-18T06:35:00+09:00"), TUE);
    expect(r.level).toBe("FRESH");
    expect(r.label).toBe("最新です");
  });

  it("実データ（14 時間前）を最新と判定する", () => {
    const r = judgeFreshness(2884.5, new Date("2026-08-17T06:35:15+09:00"), TUE);
    expect(r.level).toBe("FRESH");
    expect(Math.round(r.hoursAgo!)).toBe(26);
  });

  it("週末を挟んだ金曜の更新を月曜に見ても古いとしない", () => {
    const mon = new Date("2026-08-17T09:00:00+09:00");
    const r = judgeFreshness(100, new Date("2026-08-14T15:30:00+09:00"), mon);
    expect(r.level).toBe("FRESH");
  });

  it("2 営業日更新されていなければ古いとする", () => {
    const r = judgeFreshness(100, new Date("2026-08-14T15:30:00+09:00"), TUE);
    expect(r.level).toBe("STALE");
    expect(r.label).toBe("2 営業日更新されていません");
  });

  it("株価そのものが無い場合は別扱いにする（更新待ちでは解決しない）", () => {
    const r = judgeFreshness(null, new Date("2026-08-18T06:35:00+09:00"), TUE);
    expect(r.level).toBe("MISSING");
    expect(r.label).toBe("株価を取得できていません");
  });

  it("更新時刻が記録されていない場合も対処が必要とする", () => {
    const r = judgeFreshness(100, null, TUE);
    expect(r.level).toBe("MISSING");
    expect(r.label).toBe("更新時刻が記録されていません");
  });
});

describe("鮮度の集計", () => {
  it("対処が必要な件数を古い分と無い分の合計で出す", () => {
    const items = [
      { freshness: judgeFreshness(100, new Date("2026-08-18T06:00:00+09:00"), TUE), updatedAt: new Date("2026-08-18T06:00:00+09:00") },
      { freshness: judgeFreshness(100, new Date("2026-08-13T06:00:00+09:00"), TUE), updatedAt: new Date("2026-08-13T06:00:00+09:00") },
      { freshness: judgeFreshness(null, null, TUE), updatedAt: null },
    ];
    const s = summarizeFreshness(items);
    expect(s.total).toBe(3);
    expect(s.fresh).toBe(1);
    expect(s.stale).toBe(1);
    expect(s.missing).toBe(1);
    expect(s.problem).toBe(2);
  });

  it("最も古い更新時刻を返す", () => {
    const old = new Date("2026-08-13T06:00:00+09:00");
    const s = summarizeFreshness([
      { freshness: judgeFreshness(100, new Date("2026-08-18T06:00:00+09:00"), TUE), updatedAt: new Date("2026-08-18T06:00:00+09:00") },
      { freshness: judgeFreshness(100, old, TUE), updatedAt: old },
    ]);
    expect(s.oldestUpdatedAt?.getTime()).toBe(old.getTime());
  });

  it("1 件も無ければ 0 件として返す", () => {
    const s = summarizeFreshness([]);
    expect(s.total).toBe(0);
    expect(s.problem).toBe(0);
    expect(s.oldestUpdatedAt).toBeNull();
  });
});
