import { describe, expect, it } from "vitest";
import {
  adjustDividend,
  annualIncome,
  detectSpecialDividend,
  dividendYield,
  estimateFrequency,
  splitFactorAfter,
  summarizeDividends,
  yieldOnCost,
  type DividendEvent,
  type SplitEvent,
} from "./services/dividend";

/** 日付文字列を UNIX 秒に変換する（テストの可読性のため） */
const ts = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime() / 1000;
const NOW = new Date("2026-08-16T00:00:00Z");

describe("splitFactorAfter", () => {
  it("分割がなければ 1 倍", () => {
    expect(splitFactorAfter(ts("2026-01-01"), [])).toBe(1);
  });

  it("配当より後の分割は希薄化として数える", () => {
    const splits: SplitEvent[] = [{ date: ts("2026-06-01"), numerator: 5, denominator: 1 }];
    expect(splitFactorAfter(ts("2026-01-01"), splits)).toBe(5);
  });

  it("配当より前の分割は影響しない", () => {
    const splits: SplitEvent[] = [{ date: ts("2025-06-01"), numerator: 5, denominator: 1 }];
    expect(splitFactorAfter(ts("2026-01-01"), splits)).toBe(1);
  });

  it("配当日と分割日が同じ場合は影響を受けるものとして扱う", () => {
    // 権利確定は分割前の株数に対して行われるため、分割後の 1 株に換算すると割られる
    const splits: SplitEvent[] = [{ date: ts("2025-09-29"), numerator: 5, denominator: 1 }];
    expect(splitFactorAfter(ts("2025-09-29"), splits)).toBe(5);
  });

  it("複数回の分割は掛け合わせる", () => {
    const splits: SplitEvent[] = [
      { date: ts("2026-03-01"), numerator: 2, denominator: 1 },
      { date: ts("2026-06-01"), numerator: 3, denominator: 1 },
    ];
    expect(splitFactorAfter(ts("2026-01-01"), splits)).toBe(6);
  });

  it("株式併合（1:2 のような逆分割）も扱える", () => {
    const splits: SplitEvent[] = [{ date: ts("2026-06-01"), numerator: 1, denominator: 2 }];
    // 2 株が 1 株になるので 1 株あたりの配当は 2 倍になる
    expect(splitFactorAfter(ts("2026-01-01"), splits)).toBe(0.5);
  });

  it("不正な比率は無視する", () => {
    const splits: SplitEvent[] = [
      { date: ts("2026-06-01"), numerator: 5, denominator: 0 },
      { date: ts("2026-07-01"), numerator: NaN, denominator: 1 },
      { date: ts("2026-07-15"), numerator: 0, denominator: 1 },
    ];
    expect(splitFactorAfter(ts("2026-01-01"), splits)).toBe(1);
  });
});

describe("adjustDividend", () => {
  it("分割後の基準に換算する", () => {
    const splits: SplitEvent[] = [{ date: ts("2025-09-29"), numerator: 5, denominator: 1 }];
    const event: DividendEvent = { date: ts("2025-09-29"), amount: 60 };
    // 分割前の 60 円は分割後の 12 円に相当する
    expect(adjustDividend(event, splits)).toBe(12);
  });
});

describe("summarizeDividends", () => {
  it("直近 12 か月の配当だけを合計する", () => {
    const divs: DividendEvent[] = [
      { date: ts("2025-03-30"), amount: 50 }, // 1 年より前なので除外
      { date: ts("2025-09-29"), amount: 45 },
      { date: ts("2026-03-30"), amount: 50 },
    ];
    const s = summarizeDividends(divs, [], NOW);
    expect(s.annualDividend).toBe(95);
    expect(s.count).toBe(2);
  });

  it("分割があっても配当額は補正しない（Yahoo が既に調整済みのため）", () => {
    /*
     * 住友商事（8053.T）の実データで検証した結果、Yahoo の配当額は
     * 株価と同じく分割調整済みだった。補正すると二重に割ることになる。
     * 詳細は docs/dividend-data-source.md を参照。
     */
    const divs: DividendEvent[] = [
      { date: ts("2025-09-29"), amount: 17.5 },
      { date: ts("2026-03-30"), amount: 20 },
    ];
    const splits: SplitEvent[] = [{ date: ts("2026-06-29"), numerator: 4, denominator: 1 }];
    const s = summarizeDividends(divs, splits, NOW);
    // 4 で割らずそのまま合計する
    expect(s.annualDividend).toBe(37.5);
    // 株価 1,791 円に対して 2.09%（実勢と整合する）
    expect(dividendYield(s.annualDividend, 1791)).toBeCloseTo(2.09, 1);
  });

  it("日本製鉄のケース: 特別配当を検出して平常時の水準も出す", () => {
    /*
     * 2025-09-29 の 60 円は分割ではなく特別配当。
     * 配当日の株価と比べると 9.68% で、他の期の 2.1〜2.5% から突出していた。
     * 実績としての額は残しつつ、平常時の水準を別に持つ。
     */
    const divs: DividendEvent[] = [
      { date: ts("2025-09-29"), amount: 60 },
      { date: ts("2025-12-29"), amount: 16 },
      { date: ts("2026-03-30"), amount: 12 },
    ];
    const s = summarizeDividends(divs, [], NOW);
    expect(s.annualDividend).toBe(88);
    expect(s.hasSpecialDividend).toBe(true);
    // 突出した 60 を平常時の平均 14 に置き換える → 16 + 12 + 14 = 42
    expect(s.recurringDividend).toBe(42);
  });

  it("トヨタのケース: 分割がなければそのまま合計する", () => {
    const divs: DividendEvent[] = [
      { date: ts("2025-09-29"), amount: 45 },
      { date: ts("2026-03-30"), amount: 50 },
    ];
    const s = summarizeDividends(divs, [], NOW);
    expect(s.annualDividend).toBe(95);
    expect(s.frequency).toBe("semiannual");
  });

  it("DBS のケース: 四半期配当を 4 回分合計する", () => {
    const divs: DividendEvent[] = [
      { date: ts("2025-11-13"), amount: 0.75 },
      { date: ts("2026-04-08"), amount: 0.81 },
      { date: ts("2026-05-11"), amount: 0.81 },
      { date: ts("2026-08-14"), amount: 0.81 },
    ];
    const s = summarizeDividends(divs, [], NOW);
    expect(s.annualDividend).toBeCloseTo(3.18, 4);
    expect(s.frequency).toBe("quarterly");
    expect(s.lastAmount).toBeCloseTo(0.81, 4);
  });

  it("無配銘柄は 0 を返す（null ではない）", () => {
    const s = summarizeDividends([], [], NOW);
    expect(s.annualDividend).toBe(0);
    expect(s.count).toBe(0);
    expect(s.frequency).toBe("none");
    expect(s.lastDate).toBeNull();
    expect(s.hasSpecialDividend).toBe(false);
    expect(s.recurringDividend).toBe(0);
  });

  it("通常の増配は特別配当と誤検出しない", () => {
    // DBS の実データ。0.75 → 0.81 への増配は特別配当ではない
    const divs: DividendEvent[] = [
      { date: ts("2025-11-13"), amount: 0.75 },
      { date: ts("2026-04-08"), amount: 0.81 },
      { date: ts("2026-05-11"), amount: 0.81 },
      { date: ts("2026-08-14"), amount: 0.81 },
    ];
    const s = summarizeDividends(divs, [], NOW);
    expect(s.hasSpecialDividend).toBe(false);
    expect(s.recurringDividend).toBeCloseTo(3.18, 4);
  });

  it("最後の支払日と額を返す", () => {
    const divs: DividendEvent[] = [
      { date: ts("2026-02-13"), amount: 0.0461 },
      { date: ts("2026-04-27"), amount: 0.0398 },
    ];
    const s = summarizeDividends(divs, [], NOW);
    expect(s.lastDate?.toISOString().slice(0, 10)).toBe("2026-04-27");
    expect(s.lastAmount).toBeCloseTo(0.0398, 4);
  });

  it("金額が 0 や負の異常データは除外する", () => {
    const divs: DividendEvent[] = [
      { date: ts("2026-03-30"), amount: 50 },
      { date: ts("2026-04-30"), amount: 0 },
      { date: ts("2026-05-30"), amount: -10 },
      { date: ts("2026-06-30"), amount: NaN },
    ];
    const s = summarizeDividends(divs, [], NOW);
    expect(s.annualDividend).toBe(50);
    expect(s.count).toBe(1);
  });

  it("並び順が逆でも正しく最後の支払を特定する", () => {
    const divs: DividendEvent[] = [
      { date: ts("2026-06-30"), amount: 20 },
      { date: ts("2025-12-30"), amount: 10 },
    ];
    const s = summarizeDividends(divs, [], NOW);
    expect(s.lastDate?.toISOString().slice(0, 10)).toBe("2026-06-30");
    expect(s.annualDividend).toBe(30);
  });
});

describe("detectSpecialDividend", () => {
  it("平常時の 2 倍を超える配当を検出する", () => {
    const r = detectSpecialDividend([16, 60, 12]);
    expect(r.detected).toBe(true);
    // 60 を (16+12)/2 = 14 に置き換える
    expect(r.recurring).toBe(42);
  });

  it("2 倍以内なら検出しない（期末配当が中間より多いのは普通）", () => {
    // 期末が中間の 1.8 倍。これは通常の配当政策の範囲
    const r = detectSpecialDividend([10, 18, 10]);
    expect(r.detected).toBe(false);
    expect(r.recurring).toBe(38);
  });

  it("支払が 2 回以下なら判定しない", () => {
    // 半期配当で期末が中間の 3 倍でも、比較対象が 1 件では判断できない
    const r = detectSpecialDividend([10, 30]);
    expect(r.detected).toBe(false);
    expect(r.recurring).toBe(40);
  });

  it("均等な配当では検出しない", () => {
    const r = detectSpecialDividend([0.91, 0.91, 0.91, 0.91]);
    expect(r.detected).toBe(false);
    expect(r.recurring).toBeCloseTo(3.64, 4);
  });
});

describe("estimateFrequency", () => {
  it("回数から頻度を推定する", () => {
    expect(estimateFrequency(0)).toBe("none");
    expect(estimateFrequency(1)).toBe("annual");
    expect(estimateFrequency(2)).toBe("semiannual");
    expect(estimateFrequency(4)).toBe("quarterly");
    expect(estimateFrequency(12)).toBe("monthly");
  });
});

describe("dividendYield", () => {
  it("年間配当と現在値から利回りを出す", () => {
    expect(dividendYield(95, 3000)).toBeCloseTo(3.1667, 3);
  });

  it("現在値が無い場合は null（0% と区別する）", () => {
    expect(dividendYield(95, null)).toBeNull();
    expect(dividendYield(95, 0)).toBeNull();
    expect(dividendYield(95, -10)).toBeNull();
  });

  it("無配なら 0%", () => {
    expect(dividendYield(0, 3000)).toBe(0);
  });
});

describe("yieldOnCost", () => {
  it("取得単価に対する利回りを出す", () => {
    // 2,000 円で買った株が年 95 円配当なら 4.75%
    expect(yieldOnCost(95, 2000)).toBeCloseTo(4.75, 4);
  });

  it("現在値より安く買っていれば現在値利回りより高くなる", () => {
    const yoc = yieldOnCost(95, 2000)!;
    const cur = dividendYield(95, 3000)!;
    expect(yoc).toBeGreaterThan(cur);
  });

  it("取得単価が無効なら null", () => {
    expect(yieldOnCost(95, null)).toBeNull();
    expect(yieldOnCost(95, 0)).toBeNull();
  });
});

describe("annualIncome", () => {
  it("保有株数を掛けて年間受取額を出す", () => {
    expect(annualIncome(95, 800)).toBe(76000);
  });

  it("配当が未取得なら null（0 円と区別する）", () => {
    expect(annualIncome(null, 800)).toBeNull();
  });

  it("無配なら 0 円", () => {
    expect(annualIncome(0, 800)).toBe(0);
  });
});
