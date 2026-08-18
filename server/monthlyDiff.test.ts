import { describe, expect, it } from "vitest";
import {
  breakdownMonthlyChange,
  diffMonthlyHoldings,
  periodYmOf,
  previousPeriodYm,
  type MonthlyHoldingRow,
} from "../shared/monthlyDiff";

function row(
  symbol: string,
  quantity: number,
  valueJpy: number | null,
  broker = "ibkr"
): MonthlyHoldingRow {
  return {
    symbol,
    name: symbol,
    broker,
    quantity,
    avgCost: 100,
    price: valueJpy !== null && quantity > 0 ? valueJpy / quantity : null,
    valueJpy,
  };
}

describe("diffMonthlyHoldings", () => {
  it("前月にない銘柄を新規として扱う", () => {
    const out = diffMonthlyHoldings([], [row("NKE", 100, 1_000_000)]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("NEW");
    expect(out[0].prevQuantity).toBe(0);
    expect(out[0].currQuantity).toBe(100);
  });

  it("当月にない銘柄を売却として扱う", () => {
    const out = diffMonthlyHoldings([row("INTC", 500, 5_000_000)], []);
    expect(out[0].kind).toBe("SOLD");
    expect(out[0].currQuantity).toBe(0);
  });

  it("株数が増えていれば買い増しとする", () => {
    const out = diffMonthlyHoldings(
      [row("8058.T", 1000, 4_000_000)],
      [row("8058.T", 1500, 6_300_000)]
    );
    expect(out[0].kind).toBe("ADDED");
    expect(out[0].quantityDelta).toBe(500);
  });

  it("株数が減っていれば一部売却とする", () => {
    const out = diffMonthlyHoldings(
      [row("7203.T", 16000, 48_000_000)],
      [row("7203.T", 10000, 30_500_000)]
    );
    expect(out[0].kind).toBe("REDUCED");
    expect(out[0].quantityDelta).toBe(-6000);
  });

  it("配当再投資のような 0.5% 未満の増減は変化なしとする", () => {
    // 端株の増加を買い増しと数えると本当の売買が埋もれる
    const out = diffMonthlyHoldings(
      [row("VOO", 1000, 70_000_000)],
      [row("VOO", 1002, 71_000_000)]
    );
    expect(out[0].kind).toBe("SAME");
  });

  it("同じ銘柄でも口座が違えば別として突き合わせる", () => {
    // IBKR で売って楽天で買った動きを潰さないため
    const out = diffMonthlyHoldings(
      [row("7203.T", 8000, 24_000_000, "ibkr")],
      [row("7203.T", 8000, 24_000_000, "rakuten_ispeed")]
    );
    expect(out).toHaveLength(2);
    const kinds = out.map(r => r.kind).sort();
    expect(kinds).toEqual(["NEW", "SOLD"]);
  });

  it("変化のあった銘柄を先に並べる", () => {
    const out = diffMonthlyHoldings(
      [row("A", 100, 1_000_000), row("B", 100, 5_000_000)],
      [row("A", 200, 2_000_000), row("B", 100, 5_100_000), row("C", 10, 500_000)]
    );
    // 変化なし（B）が最後に来る
    expect(out[out.length - 1].symbol).toBe("B");
  });
});

describe("breakdownMonthlyChange", () => {
  it("値上がりと買い増しを分けて集計する", () => {
    const rows = diffMonthlyHoldings(
      [row("HOLD", 1000, 10_000_000)],
      [row("HOLD", 1000, 12_000_000), row("NEW1", 100, 3_000_000)]
    );
    const b = breakdownMonthlyChange(rows);
    expect(b.newBuyJpy).toBe(3_000_000);
    expect(b.priceMoveJpy).toBe(2_000_000);
    expect(b.totalDeltaJpy).toBe(5_000_000);
  });

  it("買い増した銘柄では買った分と値上がり分を切り分ける", () => {
    // 1000 株 1,000 万円（1 株 1 万円）→ 1500 株 1,800 万円（1 株 1.2 万円）
    // 増えた 500 株 × 1.2 万円 = 600 万円が買い増し、残り 200 万円が値上がり
    const rows = diffMonthlyHoldings(
      [row("X", 1000, 10_000_000)],
      [row("X", 1500, 18_000_000)]
    );
    const b = breakdownMonthlyChange(rows);
    expect(b.addedCostJpy).toBe(6_000_000);
    expect(b.priceMoveJpy).toBe(2_000_000);
  });

  it("売却は負の値として集計する", () => {
    const rows = diffMonthlyHoldings([row("Y", 100, 5_000_000)], []);
    const b = breakdownMonthlyChange(rows);
    expect(b.soldJpy).toBe(-5_000_000);
    expect(b.totalDeltaJpy).toBe(-5_000_000);
  });
});

describe("periodYmOf", () => {
  it("JST の暦月で判断する", () => {
    // UTC 7/31 16:00 は JST 8/1 なので 8 月扱い
    expect(periodYmOf(new Date("2026-07-31T16:00:00Z"))).toBe("2026-08");
    expect(periodYmOf(new Date("2026-07-31T14:00:00Z"))).toBe("2026-07");
  });
});

describe("previousPeriodYm", () => {
  it("前月を返す", () => {
    expect(previousPeriodYm("2026-07")).toBe("2026-06");
  });

  it("年をまたぐ場合も正しく返す", () => {
    expect(previousPeriodYm("2026-01")).toBe("2025-12");
  });
});
