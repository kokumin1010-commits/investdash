import { describe, expect, it } from "vitest";
import {
  allocateSaleProceeds,
  calculateSaleImpact,
} from "../shared/actionQueueSellPlan";

describe("calculateSaleImpact", () => {
  it("按拟卖比例拆分当前含盈、概算实现损益和残存含盈", () => {
    const result = calculateSaleImpact({
      currentQuantity: 600,
      sellShares: 150,
      currentValueBase: 18_000_000,
      currentCostBase: 12_000_000,
      currentPnlPct: 50,
      costBasisReliable: true,
    });
    expect(result.soldRatio).toBe(0.25);
    expect(result.currentPnlBase).toBe(6_000_000);
    expect(result.saleProceedsBase).toBe(4_500_000);
    expect(result.estimatedRealizedPnlBase).toBe(1_500_000);
    expect(result.afterValueBase).toBe(13_500_000);
    expect(result.remainingPnlBase).toBe(4_500_000);
  });

  it("取得原価が信頼できない場合は実現/残存損益を作らない", () => {
    const result = calculateSaleImpact({
      currentQuantity: 100,
      sellShares: 25,
      currentValueBase: 1_000_000,
      currentCostBase: null,
      currentPnlPct: null,
      costBasisReliable: false,
    });
    expect(result.saleProceedsBase).toBe(250_000);
    expect(result.estimatedRealizedPnlBase).toBeNull();
    expect(result.remainingPnlBase).toBeNull();
  });
});

describe("allocateSaleProceeds", () => {
  it("IBKR が CAUTION 以上なら売却代金を借入返済へ優先する", () => {
    const result = allocateSaleProceeds({
      saleProceedsBase: 4_500_000,
      ibkrBorrowedBase: 10_000_000,
      ibkrRiskLevel: "CAUTION",
      soldSymbol: "ACN",
      candidates: [],
    });
    expect(result.debtRepaymentBase).toBe(4_500_000);
    expect(result.cashReserveBase).toBe(0);
    expect(result.reinvestmentAllocatedBase).toBe(0);
  });

  it("SAFE では売却代金の25%以内を月度順位順に具体株数へ配分する", () => {
    const result = allocateSaleProceeds({
      saleProceedsBase: 4_000_000,
      ibkrBorrowedBase: 0,
      ibkrRiskLevel: "SAFE",
      soldSymbol: "ACN",
      candidates: [
        {
          symbol: "AAA",
          name: "Alpha",
          rank: 1,
          shares: 80,
          amountBase: 800_000,
          lotSize: 1,
          currentHoldingBase: 1_000_000,
          netAssetsBase: 100_000_000,
        },
        {
          symbol: "BBB",
          name: "Beta",
          rank: 2,
          shares: 80,
          amountBase: 800_000,
          lotSize: 1,
          currentHoldingBase: 0,
          netAssetsBase: 100_000_000,
        },
      ],
    });
    expect(result.reinvestmentBudgetBase).toBe(1_000_000);
    expect(result.allocations).toMatchObject([
      { symbol: "AAA", shares: 80, amountBase: 800_000 },
      { symbol: "BBB", shares: 20, amountBase: 200_000 },
    ]);
    expect(result.reinvestmentAllocatedBase).toBe(1_000_000);
    expect(result.cashReserveBase).toBe(3_000_000);
  });

  it("売却対象の買い直しと単元未満の再投資を除外し未配分額を現金に戻す", () => {
    const result = allocateSaleProceeds({
      saleProceedsBase: 1_000_000,
      ibkrBorrowedBase: 0,
      ibkrRiskLevel: "SAFE",
      soldSymbol: "ACN",
      candidates: [
        {
          symbol: "ACN",
          name: "Accenture",
          rank: 1,
          shares: 10,
          amountBase: 200_000,
          lotSize: 1,
          currentHoldingBase: 0,
          netAssetsBase: 100_000_000,
        },
        {
          symbol: "7203.T",
          name: "Toyota",
          rank: 2,
          shares: 100,
          amountBase: 1_000_000,
          lotSize: 100,
          currentHoldingBase: 0,
          netAssetsBase: 100_000_000,
        },
      ],
    });
    expect(result.allocations).toEqual([]);
    expect(result.unallocatedBase).toBe(250_000);
    expect(result.cashReserveBase).toBe(1_000_000);
  });
});
