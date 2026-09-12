import { describe, expect, it } from "vitest";
import {
  classifyCandidateIndustry,
  normalizeCandidateFinancialMetrics,
  type CandidateFinancialSeries,
} from "../shared/candidateFinancialMetrics";

function point(value: number, asOfDate: string, currencyCode = "USD", periodType = "12M") {
  return { value, asOfDate, currencyCode, periodType };
}

function baseSeries(): CandidateFinancialSeries {
  return {
    trailingPeRatio: [point(20, "2026-09-11", "USD", "TTM")],
    trailingMarketCap: [point(200_000_000_000, "2026-09-11", "USD", "TTM")],
    annualTotalRevenue: [
      point(90_000_000_000, "2024-12-31"),
      point(100_000_000_000, "2025-12-31"),
    ],
    annualOperatingIncome: [point(20_000_000_000, "2025-12-31")],
    annualNetIncome: [point(15_000_000_000, "2025-12-31")],
    annualDilutedEPS: [point(5, "2024-12-31"), point(6, "2025-12-31")],
    annualFreeCashFlow: [point(12_000_000_000, "2025-12-31")],
    annualStockholdersEquity: [
      point(45_000_000_000, "2024-12-31"),
      point(50_000_000_000, "2025-12-31"),
    ],
    annualInvestedCapital: [
      point(70_000_000_000, "2024-12-31"),
      point(80_000_000_000, "2025-12-31"),
    ],
    annualTotalDebt: [point(20_000_000_000, "2025-12-31")],
    annualCashCashEquivalentsAndShortTermInvestments: [
      point(30_000_000_000, "2025-12-31"),
    ],
    annualCommonStockDividendPaid: [point(-4_500_000_000, "2025-12-31")],
    annualTaxProvision: [point(5_000_000_000, "2025-12-31")],
    annualPretaxIncome: [point(20_000_000_000, "2025-12-31")],
  };
}

function normalize(overrides: Partial<Parameters<typeof normalizeCandidateFinancialMetrics>[0]> = {}) {
  return normalizeCandidateFinancialMetrics({
    symbol: "TEST",
    sector: "Technology",
    industry: "Semiconductors",
    currentPrice: 100,
    priceCurrency: "USD",
    priceAsOfDate: "2026-09-11",
    fetchedAt: "2026-09-13T00:00:00.000Z",
    series: baseSeries(),
    dividend: {
      available: true,
      recurringAnnualDividend: 3,
      count: 4,
      lastDate: "2026-08-01",
      hasSpecialDividend: false,
    },
    ...overrides,
  });
}

describe("candidate financial metric normalization", () => {
  it("keeps source/date/basis and derives ordinary-company metrics from compatible periods", () => {
    const result = normalize();

    expect(result.dataQuality).toBe("COMPLETE");
    expect(result.metrics.forecastDividendYieldPct.value).toBe(3);
    expect(result.metrics.trailingPe.value).toBe(20);
    expect(result.metrics.priceToBook.value).toBe(4);
    expect(result.metrics.marketCap.currency).toBe("USD");
    expect(result.metrics.roePct.value).toBeCloseTo(31.5789, 3);
    expect(result.metrics.operatingMarginPct.value).toBe(20);
    expect(result.metrics.fcfYieldPct.value).toBe(6);
    expect(result.metrics.netCash.value).toBe(10_000_000_000);
    expect(result.metrics.revenueGrowthPct.value).toBeCloseTo(11.1111, 3);
    expect(result.metrics.epsGrowthPct.value).toBe(20);
    expect(result.metrics.payoutRatioPct.value).toBe(30);
    expect(result.marketAsOfDate).toBe("2026-09-11");
    expect(result.fiscalPeriodEnd).toBe("2025-12-31");
    expect(result.metrics.trailingPe.source).toContain("Yahoo Finance");
  });

  it("separates a loss-making PER from a genuinely unavailable market metric", () => {
    const series = baseSeries();
    delete series.trailingPeRatio;
    delete series.trailingMarketCap;
    series.annualDilutedEPS = [point(-1.2, "2025-12-31")];

    const result = normalize({ series });

    expect(result.metrics.trailingPe.status).toBe("NOT_MEANINGFUL");
    expect(result.metrics.trailingPe.value).toBeNull();
    expect(result.metrics.marketCap.status).toBe("UNAVAILABLE");
    expect(result.metrics.priceToBook.status).toBe("UNAVAILABLE");
  });

  it("does not derive ratios when source currencies disagree", () => {
    const series = baseSeries();
    series.annualStockholdersEquity = [point(50_000_000_000, "2025-12-31", "JPY")];

    const result = normalize({ series });

    expect(result.metrics.priceToBook.status).toBe("UNAVAILABLE");
    expect(result.metrics.priceToBook.basis).toContain("通貨");
  });

  it("treats verified zero dividends as 0% but missing dividend history as unavailable", () => {
    expect(
      normalize({
        dividend: {
          available: true,
          recurringAnnualDividend: 0,
          count: 0,
          lastDate: null,
          hasSpecialDividend: false,
        },
      }).metrics.forecastDividendYieldPct
    ).toMatchObject({ status: "AVAILABLE", value: 0 });

    expect(
      normalize({
        dividend: {
          available: false,
          recurringAnnualDividend: null,
          count: 0,
          lastDate: null,
          hasSpecialDividend: false,
        },
      }).metrics.forecastDividendYieldPct.status
    ).toBe("UNAVAILABLE");
  });

  it("uses finance and REIT lenses without applying ordinary-company FCF or debt rules", () => {
    expect(classifyCandidateIndustry("Financial Services", "Banks - Regional")).toBe(
      "FINANCIAL"
    );
    expect(classifyCandidateIndustry("Real Estate", "REIT - Industrial")).toBe("REIT");

    const finance = normalize({
      sector: "Financial Services",
      industry: "Banks - Regional",
    });
    expect(finance.metrics.roicPct.status).toBe("NOT_MEANINGFUL");
    expect(finance.metrics.freeCashFlow.status).toBe("NOT_MEANINGFUL");
    expect(finance.metrics.netCash.status).toBe("NOT_MEANINGFUL");
    expect(finance.notes.join(" ")).toContain("PBR・ROE");

    const reit = normalize({ sector: "Real Estate", industry: "REIT - Industrial" });
    expect(reit.metrics.operatingMarginPct.status).toBe("NOT_MEANINGFUL");
    expect(reit.notes.join(" ")).toContain("P/NAV・FFO/AFFO");
  });
});
