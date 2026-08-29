import { describe, expect, it } from "vitest";
import { buildDividendDetailView } from "../shared/dividendDetail";

describe("buildDividendDetailView", () => {
  it("2733.T の実績から継続利回りと口座年間配当を出す", () => {
    const result = buildDividendDetailView({
      quantity: 2000,
      perShare: 112,
      annualIncomeBase: 224000,
      yieldPct: 4.090577,
      recurringPerShare: 112,
      recurringYieldPct: 4.090577,
      hasSpecial: false,
      updatedAt: "2026-08-28T19:22:43.000Z",
    });
    expect(result.status).toBe("PAYING");
    expect(result.forecastYieldPct).toBeCloseTo(4.090577);
    expect(result.annualIncomeLocal).toBe(224000);
    expect(result.annualIncomeBase).toBe(224000);
  });

  it("特別配当を除いた継続水準へ年間額も比例調整する", () => {
    const result = buildDividendDetailView({
      quantity: 100,
      perShare: 120,
      annualIncomeBase: 12000,
      yieldPct: 6,
      recurringPerShare: 80,
      recurringYieldPct: 4,
      hasSpecial: true,
      updatedAt: new Date("2026-08-28T00:00:00Z"),
    });
    expect(result.annualIncomeLocal).toBe(8000);
    expect(result.annualIncomeBase).toBe(8000);
    expect(result.basisLabel).toContain("特別配当除外");
  });

  it("null は未取得、0 は無配として区別する", () => {
    expect(buildDividendDetailView(null).status).toBe("UNKNOWN");
    expect(
      buildDividendDetailView({
        quantity: 54,
        perShare: 0,
        annualIncomeBase: 0,
        yieldPct: 0,
        recurringPerShare: 0,
        recurringYieldPct: 0,
        hasSpecial: false,
        updatedAt: null,
      }).status
    ).toBe("NONE");
  });

  it("外貨の円換算が未取得なら現地年間額だけを保持する", () => {
    const result = buildDividendDetailView({
      quantity: 54,
      perShare: 0.312,
      annualIncomeBase: null,
      yieldPct: 1.5423,
      recurringPerShare: 0.312,
      recurringYieldPct: 1.5423,
      hasSpecial: false,
      updatedAt: null,
    });
    expect(result.annualIncomeLocal).toBeCloseTo(16.848);
    expect(result.annualIncomeBase).toBeNull();
  });
});
