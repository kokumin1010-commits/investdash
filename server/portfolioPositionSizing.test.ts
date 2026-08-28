import { describe, expect, it } from "vitest";
import { computePortfolioPositionSizing } from "../shared/portfolioPositionSizing";

const productionBase = {
  netAssetsBase: 734_667_816.4483856,
  liquidAssetsBase: 95_908_963.400826,
  userSectorLimitPct: 35,
  ibkrLeverage: 1.8250869631936704,
  ibkrRiskLevel: "CAUTION" as const,
  ibkrDropToMarginCallPct: 33.88228697507812,
};

describe("computePortfolioPositionSizing", () => {
  it("uses one tradable 100-share lot for unheld 285A without inventing a holding", () => {
    const result = computePortfolioPositionSizing({
      ...productionBase,
      action: "ADD_SMALL",
      priority: "MEDIUM",
      market: "JP",
      localPrice: 47_900,
      yenPerLocalUnit: 1,
      currentHoldingBase: 0,
      sectorValueBase: 197_342_403.77271006,
    });

    expect(result.status).toBe("BUY");
    expect(result.currentWeightPct).toBe(0);
    expect(result.targetWeightPct).toBe(1);
    expect(result.shares).toBe(100);
    expect(result.amountBase).toBe(4_790_000);
    expect(result.afterWeightPct).toBeCloseTo(0.652, 3);
    expect(result.lotAdjusted).toBe(true);
    expect(result.marginFactor).toBe(0.5);
    expect(result.reasons).toContain(
      "最低売買単位に合わせて初回額を調整しました"
    );
  });

  it("sizes PYPL from the symbol-level value across all accounts", () => {
    const result = computePortfolioPositionSizing({
      ...productionBase,
      action: "ADD_SMALL",
      priority: "MEDIUM",
      market: "US",
      localPrice: 53.66,
      yenPerLocalUnit: 160.038,
      currentHoldingBase: 7_351_019.05248,
      sectorValueBase: 135_488_275.60454005,
    });

    expect(result.status).toBe("BUY");
    expect(result.currentWeightPct).toBeCloseTo(1.0006, 3);
    expect(result.shares).toBe(53);
    expect(result.amountBase).toBeCloseTo(455_144.87, 0);
    expect(result.afterWeightPct).toBeGreaterThan(result.currentWeightPct);
    expect(result.afterWeightPct).toBeLessThan(result.targetWeightPct);
    expect(result.lotAdjusted).toBe(false);
  });

  it.each(["HOLD", "VERIFY", "REDUCE"] as const)(
    "returns zero for %s until the plan condition is satisfied",
    action => {
      const result = computePortfolioPositionSizing({
        ...productionBase,
        action,
        market: "US",
        localPrice: 50,
        yenPerLocalUnit: 160,
        currentHoldingBase: 0,
        sectorValueBase: 0,
      });

      expect(result.status).toBe("WAIT");
      expect(result.amountBase).toBe(0);
      expect(result.shares).toBe(0);
    }
  );

  it("blocks new buying when IBKR reaches WARNING", () => {
    const result = computePortfolioPositionSizing({
      ...productionBase,
      action: "ADD_MAIN",
      market: "US",
      localPrice: 50,
      yenPerLocalUnit: 160,
      currentHoldingBase: 0,
      sectorValueBase: 0,
      ibkrRiskLevel: "WARNING",
      ibkrDropToMarginCallPct: 19,
    });

    expect(result.status).toBe("BLOCKED_MARGIN");
    expect(result.shares).toBe(0);
  });

  it("blocks buying when the existing symbol is already above 5% of net assets", () => {
    const result = computePortfolioPositionSizing({
      ...productionBase,
      action: "ADD_SMALL",
      market: "US",
      localPrice: 50,
      yenPerLocalUnit: 160,
      currentHoldingBase: productionBase.netAssetsBase * 0.06,
      sectorValueBase: productionBase.netAssetsBase * 0.1,
    });

    expect(result.status).toBe("BLOCKED_POSITION");
    expect(result.amountBase).toBe(0);
  });

  it("blocks buying when the sector is already at the internal 30% cap", () => {
    const result = computePortfolioPositionSizing({
      ...productionBase,
      action: "ADD_SMALL",
      market: "US",
      localPrice: 50,
      yenPerLocalUnit: 160,
      currentHoldingBase: 0,
      sectorValueBase: productionBase.netAssetsBase * 0.3,
    });

    expect(result.status).toBe("BLOCKED_SECTOR");
    expect(result.sectorLimitPct).toBe(30);
  });

  it("does not force a Japanese lot when one lot exceeds every risk budget", () => {
    const result = computePortfolioPositionSizing({
      action: "ADD_SMALL",
      priority: "LOW",
      market: "JP",
      localPrice: 100_000,
      yenPerLocalUnit: 1,
      netAssetsBase: 10_000_000,
      liquidAssetsBase: 1_000_000,
      currentHoldingBase: 0,
      sectorValueBase: 0,
      userSectorLimitPct: 35,
      ibkrLeverage: 1,
      ibkrRiskLevel: "SAFE",
      ibkrDropToMarginCallPct: 60,
    });

    expect(result.status).toBe("TOO_SMALL");
    expect(result.shares).toBe(0);
    expect(result.reasons).toContain(
      "最低売買単位が今回のリスク予算を超えます"
    );
  });
});
