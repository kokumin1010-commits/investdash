import { describe, expect, it } from "vitest";
import { buildDividendCalendar, type CalendarInput } from "./services/dividendCalendar";

/**
 * 配当カレンダーに利回りと業種を持たせた部分の検証。
 *
 * 金額だけでは「その配当が投資額に対して見合っているか」が判断できない。
 * 同じ 20 万円の配当でも投資額 200 万なら 10%、2000 万なら 1% で
 * 意味が全く違うため、利回りを併記する必要がある。
 */

/** 3 月と 9 月に配当が入る銘柄を作る */
function makeItem(over: Partial<CalendarInput> = {}): CalendarInput {
  const monthlyPerShare = Array(12).fill(0);
  monthlyPerShare[2] = 50; // 3 月に 1 株 50 円
  monthlyPerShare[8] = 50; // 9 月に 1 株 50 円

  const monthlyIncomeBase = Array(12).fill(0);
  monthlyIncomeBase[2] = 50_000;
  monthlyIncomeBase[8] = 50_000;

  return {
    id: 1,
    symbol: "8058.T",
    tickerCode: "8058",
    name: "三菱商事",
    market: "JP",
    broker: "moomoo_jp",
    currency: "JPY",
    quantity: 1000,
    sector: "Industrials",
    dividend: {
      monthlyPerShare,
      monthlyIncomeBase,
      annualIncomeBase: 100_000,
      yieldPct: 3.45,
      yieldOnCostPct: 4.12,
      hasSpecial: false,
      yieldNeedsCheck: false,
    },
    ...over,
  };
}

describe("配当カレンダーの利回りと業種", () => {
  it("年間ベースの利回りをそのまま持つ（月ごとに割らない）", () => {
    const cal = buildDividendCalendar([makeItem()]);
    const march = cal[2].entries[0];

    /*
     * 3 月の受取は年間の半分だが、利回りは 3.45% のまま。
     * 月ごとに割って 1.7% と出すと、年間利回りの水準（3.45%）と
     * 比較できない数字になり、高配当かどうかの判断に使えない。
     */
    expect(march.yieldPct).toBe(3.45);
    expect(march.yieldOnCostPct).toBe(4.12);
    expect(march.shareOfAnnual).toBeCloseTo(0.5, 5);
  });

  it("同じ銘柄が複数の月に出ても利回りは同じ値になる", () => {
    const cal = buildDividendCalendar([makeItem()]);
    expect(cal[2].entries[0].yieldPct).toBe(cal[8].entries[0].yieldPct);
  });

  it("業種を保持する", () => {
    const cal = buildDividendCalendar([makeItem()]);
    expect(cal[2].entries[0].sector).toBe("Industrials");
  });

  it("株価が未取得で利回りが出せない場合は null を返す（0% と区別する）", () => {
    const item = makeItem();
    const cal = buildDividendCalendar([
      { ...item, dividend: { ...item.dividend!, yieldPct: null, yieldOnCostPct: null } },
    ]);

    /*
     * 0% は「配当が出ない」を意味し、null は「計算できない」を意味する。
     * 混同すると無配銘柄と株価未取得の銘柄が同じに見えてしまう。
     */
    expect(cal[2].entries[0].yieldPct).toBeNull();
    expect(cal[2].entries[0].yieldOnCostPct).toBeNull();
  });

  it("業種が未取得なら null を返す（勝手に未分類などに置き換えない）", () => {
    const cal = buildDividendCalendar([makeItem({ sector: null })]);
    expect(cal[2].entries[0].sector).toBeNull();
  });

  it("同一銘柄を 2 口座で持つ場合、口座ごとに利回りを持つ", () => {
    const a = makeItem();
    const b = makeItem({ id: 2, broker: "rakuten" });
    // 取得単価が違えば取得原価利回りも変わる
    b.dividend = { ...b.dividend!, yieldOnCostPct: 2.5 };

    const cal = buildDividendCalendar([a, b]);
    const yocs = cal[2].entries.map(e => e.yieldOnCostPct);

    expect(cal[2].entries).toHaveLength(2);
    expect(yocs).toContain(4.12);
    expect(yocs).toContain(2.5);
  });
});
