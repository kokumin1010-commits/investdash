import { describe, expect, it } from "vitest";
import {
  breakdownMonthlyChange,
  diffMonthlyHoldings,
  type MonthlyHoldingRow,
} from "@shared/monthlyDiff";

/**
 * 画面に出す 3 つの数字（買い増し・売却・値動き）が
 * 「総変化 = 買い + 売り + 値動き」に一致するかを確かめる。
 *
 * 画面ではこの 3 つを並べるため、合計が総変化と合わないと
 * どこかが抜けていることになり数字を信用できない。
 */
function row(
  symbol: string,
  quantity: number,
  valueJpy: number,
  broker = "moomoo"
): MonthlyHoldingRow {
  return {
    symbol,
    name: symbol,
    broker,
    market: "JP",
    quantity,
    avgCost: null,
    currentPrice: null,
    valueJpy,
    costJpy: null,
  };
}

describe("月次差分の内訳が画面の 3 区分と整合する", () => {
  it("買い増し・売却・値動きの合計が総変化に一致する", () => {
    const prev = [row("AAA", 100, 1_000_000), row("BBB", 200, 2_000_000)];
    const curr = [
      row("AAA", 200, 2_200_000), // 買い増し + 値上がり
      row("CCC", 50, 500_000), // 新規
    ];
    const rows = diffMonthlyHoldings(prev, curr);
    const b = breakdownMonthlyChange(rows);

    const shown = b.newBuyJpy + b.addedCostJpy + b.soldJpy + b.reducedJpy + b.priceMoveJpy;
    expect(shown).toBeCloseTo(b.totalDeltaJpy, 6);
  });

  it("売却分は負の値で返り、画面でそのまま表示できる", () => {
    const prev = [row("AAA", 100, 1_000_000)];
    const curr: MonthlyHoldingRow[] = [];
    const b = breakdownMonthlyChange(diffMonthlyHoldings(prev, curr));
    expect(b.soldJpy).toBeLessThan(0);
    expect(b.soldJpy).toBeCloseTo(-1_000_000, 6);
  });

  it("一部売却も負の値で返る", () => {
    const prev = [row("AAA", 100, 1_000_000)];
    const curr = [row("AAA", 40, 400_000)];
    const b = breakdownMonthlyChange(diffMonthlyHoldings(prev, curr));
    expect(b.reducedJpy).toBeLessThan(0);
  });

  it("売買がなければ買い増しと売却は 0 で値動きだけが動く", () => {
    const prev = [row("AAA", 100, 1_000_000)];
    const curr = [row("AAA", 100, 1_300_000)];
    const b = breakdownMonthlyChange(diffMonthlyHoldings(prev, curr));
    expect(b.newBuyJpy).toBe(0);
    expect(b.addedCostJpy).toBe(0);
    expect(b.soldJpy).toBe(0);
    expect(b.reducedJpy).toBe(0);
    expect(b.priceMoveJpy).toBeCloseTo(300_000, 6);
  });

  it("差分行は quantityDelta を持つ（画面はこの名前で参照する）", () => {
    const rows = diffMonthlyHoldings([row("AAA", 100, 1_000_000)], [row("AAA", 300, 3_000_000)]);
    expect(rows[0]).toHaveProperty("quantityDelta");
    expect(rows[0].quantityDelta).toBe(200);
  });

  it("同一銘柄を複数口座で持つ場合は口座ごとに行が出る", () => {
    const prev = [row("AAA", 100, 1_000_000, "moomoo"), row("AAA", 50, 500_000, "rakuten")];
    const curr = [row("AAA", 100, 1_100_000, "moomoo"), row("AAA", 80, 880_000, "rakuten")];
    const rows = diffMonthlyHoldings(prev, curr);
    expect(rows).toHaveLength(2);
    const rakuten = rows.find(r => r.broker === "rakuten");
    expect(rakuten?.kind).toBe("ADDED");
    const moomoo = rows.find(r => r.broker === "moomoo");
    expect(moomoo?.kind).toBe("SAME");
  });
});
