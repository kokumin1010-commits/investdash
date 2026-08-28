import { describe, expect, it } from "vitest";
import { assessSignalDataQuality, type SignalContext } from "./services/analysis";

const base: SignalContext = {
  name: "Example",
  symbol: "EX",
  currency: "USD",
  quantity: 10,
  avgCost: 100,
  currentPrice: 110,
  pnlPct: 10,
  weightPct: 2,
  sector: "Technology",
  industry: "Software",
  fiftyTwoWeekHigh: 120,
  fiftyTwoWeekLow: 80,
  return1m: 2,
  return3m: 5,
  longTerm: { return1y: 10, return3y: 20, return5y: 30, annualized3y: 6, annualized5y: 5 },
  businessSummary: "Enterprise software business.",
  card: {
    buyReason: "理由",
    coreThesis: "ロジック",
    valuationAssumption: "前提",
    fairValue: null,
    keyFinancials: "数値",
    exitConditions: "条件",
    risks: "リスク",
  },
  news: [{ title: "決算", sentiment: "POSITIVE", impactScore: 80, summary: "上方修正", publishedAt: new Date() }],
};

describe("assessSignalDataQuality", () => {
  it("カード、分析済みニュース、価格、企業情報が揃えば STRONG", () => {
    expect(assessSignalDataQuality(base)).toBe("STRONG");
  });

  it("材料が乏しい場合は LIMITED", () => {
    expect(
      assessSignalDataQuality({
        ...base,
        currentPrice: null,
        fiftyTwoWeekHigh: null,
        fiftyTwoWeekLow: null,
        longTerm: null,
        businessSummary: null,
        sector: null,
        industry: null,
        card: null,
        news: [],
      })
    ).toBe("LIMITED");
  });
});
