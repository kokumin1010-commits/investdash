import { describe, expect, it } from "vitest";
import { buildDividendCalendar, type CalendarInput } from "./services/dividendCalendar";

/**
 * 配当カレンダー（月別の銘柄内訳）のテスト。
 *
 * 「3 月に 650 万円」だけでは減配リスクの確認ができないため、
 * どの銘柄がその金額を作っているかを月別に出す。
 * 合計が月別集計と一致すること、同一銘柄を複数口座で持つ場合に
 * 口座ごとに分かれることを検証する。
 */

function item(
  over: Partial<CalendarInput> & { id: number },
  monthlyPerShare: number[] | null,
  monthlyIncomeBase: number[] | null,
  annualIncomeBase: number | null
): CalendarInput {
  return {
    id: over.id,
    symbol: over.symbol ?? "7203.T",
    tickerCode: over.tickerCode ?? "7203",
    name: over.name ?? "トヨタ自動車",
    market: over.market ?? "JP",
    broker: over.broker ?? "moomoo_jp",
    currency: over.currency ?? "JPY",
    quantity: over.quantity ?? 100,
    dividend: {
      monthlyPerShare,
      monthlyIncomeBase,
      annualIncomeBase,
      hasSpecial: false,
      yieldNeedsCheck: false,
    },
  };
}

/** 3 月と 9 月に半分ずつ払う日本株のパターン（1 株あたり） */
function jpPerShare(perYear: number): number[] {
  const m = Array<number>(12).fill(0);
  m[2] = perYear / 2;
  m[8] = perYear / 2;
  return m;
}

/** 円換算後の月別受取額（株数を掛けたもの） */
function jpIncome(perYear: number, qty: number): number[] {
  return jpPerShare(perYear).map(v => v * qty);
}

describe("配当カレンダー", () => {
  it("必ず 12 か月分を返す（配当が無い月も残す）", () => {
    const cal = buildDividendCalendar([
      item({ id: 1 }, jpPerShare(100), jpIncome(100, 100), 10_000),
    ]);
    expect(cal).toHaveLength(12);
    expect(cal.map(m => m.month)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // 配当が無い月は entries が空
    expect(cal[0].entries).toHaveLength(0);
    expect(cal[2].entries).toHaveLength(1);
  });

  it("各月の合計が銘柄内訳の合計と一致する", () => {
    const cal = buildDividendCalendar([
      item({ id: 1 }, jpPerShare(100), jpIncome(100, 100), 10_000),
      item({ id: 2, name: "ソニー" }, jpPerShare(60), jpIncome(60, 200), 12_000),
    ]);
    for (const m of cal) {
      const sum = m.entries.reduce((acc, e) => acc + e.amountBase, 0);
      expect(sum).toBeCloseTo(m.totalBase, 6);
    }
  });

  it("年間の合計が各銘柄の年間受取額の合計と一致する", () => {
    const cal = buildDividendCalendar([
      item({ id: 1 }, jpPerShare(100), jpIncome(100, 100), 10_000),
      item({ id: 2, name: "ソニー" }, jpPerShare(60), jpIncome(60, 200), 12_000),
    ]);
    const total = cal.reduce((acc, m) => acc + m.totalBase, 0);
    expect(total).toBeCloseTo(10_000 + 12_000, 6);
  });

  it("金額の大きい順に並ぶ", () => {
    const cal = buildDividendCalendar([
      item({ id: 1, name: "小さい" }, jpPerShare(10), jpIncome(10, 100), 1_000),
      item({ id: 2, name: "大きい" }, jpPerShare(100), jpIncome(100, 100), 10_000),
      item({ id: 3, name: "中くらい" }, jpPerShare(50), jpIncome(50, 100), 5_000),
    ]);
    expect(cal[2].entries.map(e => e.name)).toEqual(["大きい", "中くらい", "小さい"]);
  });

  it("同一銘柄を複数口座で持つ場合は口座ごとに分けて出す", () => {
    const cal = buildDividendCalendar([
      item({ id: 1, broker: "moomoo_jp", quantity: 100 }, jpPerShare(100), jpIncome(100, 100), 10_000),
      item({ id: 2, broker: "rakuten_ispeed", quantity: 300 }, jpPerShare(100), jpIncome(100, 300), 30_000),
    ]);
    const march = cal[2].entries;
    expect(march).toHaveLength(2);
    expect(march.map(e => e.broker)).toEqual(["rakuten_ispeed", "moomoo_jp"]);
    // 株数の多い口座の方が金額が大きい
    expect(march[0].amountBase).toBeGreaterThan(march[1].amountBase);
  });

  it("その月が年間の何割かを算出する", () => {
    const cal = buildDividendCalendar([
      item({ id: 1 }, jpPerShare(100), jpIncome(100, 100), 10_000),
    ]);
    // 3 月と 9 月に半分ずつなので各 50%
    expect(cal[2].pctOfAnnual).toBeCloseTo(50, 6);
    expect(cal[8].pctOfAnnual).toBeCloseTo(50, 6);
    expect(cal[0].pctOfAnnual).toBeCloseTo(0, 6);
    // 銘柄単位の割合も同じ
    expect(cal[2].entries[0].shareOfAnnual).toBeCloseTo(0.5, 6);
  });

  it("外貨建ては現地通貨の額と円換算額の両方を持つ", () => {
    // 1 株 1 USD を年 4 回、100 株。円換算は 1 USD = 150 円とする
    const perShare = Array<number>(12).fill(0);
    const income = Array<number>(12).fill(0);
    for (const i of [2, 5, 8, 11]) {
      perShare[i] = 1;
      income[i] = 1 * 100 * 150;
    }
    const cal = buildDividendCalendar([
      item(
        { id: 1, name: "アップル", market: "US", currency: "USD", quantity: 100 },
        perShare,
        income,
        4 * 100 * 150
      ),
    ]);
    const e = cal[2].entries[0];
    expect(e.currency).toBe("USD");
    expect(e.amount).toBeCloseTo(100, 6); // 現地通貨 100 USD
    expect(e.amountBase).toBeCloseTo(15_000, 6); // 円換算 15,000 円
  });

  it("配当情報が無い銘柄は無視する", () => {
    const withoutDividend: CalendarInput = {
      id: 9,
      symbol: "9999.T",
      tickerCode: "9999",
      name: "無配企業",
      market: "JP",
      broker: "moomoo_jp",
      currency: "JPY",
      quantity: 100,
      dividend: null,
    };
    const cal = buildDividendCalendar([
      item({ id: 1 }, jpPerShare(100), jpIncome(100, 100), 10_000),
      withoutDividend,
    ]);
    expect(cal[2].entries).toHaveLength(1);
    expect(cal[2].entries[0].name).toBe("トヨタ自動車");
  });

  it("月別データが壊れている銘柄は加算しない", () => {
    const cal = buildDividendCalendar([
      // 長さが 12 でない
      item({ id: 1 }, [1, 2, 3], [100, 200, 300], 600),
      item({ id: 2, name: "正常" }, jpPerShare(100), jpIncome(100, 100), 10_000),
    ]);
    const total = cal.reduce((acc, m) => acc + m.totalBase, 0);
    expect(total).toBeCloseTo(10_000, 6);
    expect(cal.every(m => m.entries.every(e => e.name === "正常"))).toBe(true);
  });

  it("無配銘柄のみなら全月が空になる", () => {
    const zero = Array<number>(12).fill(0);
    const cal = buildDividendCalendar([item({ id: 1 }, zero, zero, 0)]);
    expect(cal.every(m => m.entries.length === 0)).toBe(true);
    expect(cal.every(m => m.totalBase === 0)).toBe(true);
    // 年間が 0 なら割合は出さない（0 除算を避ける）
    expect(cal.every(m => m.pctOfAnnual === null)).toBe(true);
  });

  it("特別配当の注意フラグを引き継ぐ", () => {
    const base = item({ id: 1, name: "日本製鉄" }, jpPerShare(100), jpIncome(100, 100), 10_000);
    const cal = buildDividendCalendar([
      { ...base, dividend: { ...base.dividend!, hasSpecial: true, yieldNeedsCheck: true } },
    ]);
    expect(cal[2].entries[0].hasSpecial).toBe(true);
    expect(cal[2].entries[0].yieldNeedsCheck).toBe(true);
  });
});
