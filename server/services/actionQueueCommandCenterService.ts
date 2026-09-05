import { buildHoldingActionPlan } from "../../shared/holdingActionPlan";
import {
  allocateSaleProceeds,
  calculateSaleImpact,
  type SaleProceedsAllocation,
  type SaleImpact,
} from "../../shared/actionQueueSellPlan";
import { buildRankedPlanOverview } from "./buyPlanRankingService";
import { listActionQueue, type ActionQueueView } from "./actionQueueService";
import { buildPortfolio } from "./portfolio";

const REFRESHABLE_STATUSES = new Set([
  "WAITING_MATERIAL",
  "REANALYZING",
  "PENDING_ACTION",
  "SNOOZED",
  "FAILED",
]);

export function applyLiveSellDiscipline(
  items: ActionQueueView[],
  groups: Awaited<ReturnType<typeof buildPortfolio>>["groups"]
): ActionQueueView[] {
  const groupMap = new Map(groups.map(group => [group.symbol, group]));
  return items.map(item => {
    if (
      !REFRESHABLE_STATUSES.has(item.status) ||
      (item.action !== "REDUCE" && item.action !== "EXIT")
    ) {
      return item;
    }
    const group = groupMap.get(item.symbol);
    if (!group) return item;
    const plan = buildHoldingActionPlan({
      action: item.action,
      quantity: group.quantity,
      currentPrice: group.currentPrice,
      marketValueBase: group.marketValueBase,
      currentWeightPct: group.weightPct,
      market: group.market,
      accountCount: group.entries.length,
    });
    return {
      ...item,
      direction: plan.direction,
      currentQuantity: group.quantity,
      currentPrice: group.currentPrice,
      currentValueBase: group.marketValueBase,
      currentWeightPct: group.weightPct,
      recommendedShares: plan.shares,
      recommendedAmountLocal: plan.amountLocal,
      recommendedAmountBase: plan.amountBase,
      afterQuantity: plan.afterQuantity,
      afterWeightPct: plan.afterWeightPct,
      evidence: {
        ...(item.evidence ?? {}),
        planRationale: plan.rationale,
        lotSize: plan.lotSize,
        lotUncertain: plan.lotUncertain,
        liveSellDiscipline: true,
      },
    };
  });
}

export type ActionQueueCommandCenterView = ActionQueueView & {
  saleImpact: (SaleImpact & { priceUpdatedAt: Date | null }) | null;
  proceedsAllocation: SaleProceedsAllocation | null;
};

export function attachSaleImpacts(
  items: ActionQueueView[],
  groups: Awaited<ReturnType<typeof buildPortfolio>>["groups"]
): ActionQueueCommandCenterView[] {
  const groupMap = new Map(groups.map(group => [group.symbol, group]));
  return items.map(item => {
    const group = groupMap.get(item.symbol);
    const sellShares = item.recommendedShares ?? 0;
    if (
      !group ||
      (item.direction !== "SELL" && item.direction !== "EXIT") ||
      sellShares <= 0
    ) {
      return { ...item, saleImpact: null, proceedsAllocation: null };
    }
    return {
      ...item,
      saleImpact: {
        ...calculateSaleImpact({
          currentQuantity: group.quantity,
          sellShares,
          currentValueBase: group.marketValueBase,
          currentCostBase: group.costValueBase,
          currentPnlPct: group.pnlPct,
          costBasisReliable: group.avgCost > 0 && group.costValue > 0,
        }),
        priceUpdatedAt: group.priceUpdatedAt,
      },
      proceedsAllocation: null,
    };
  });
}

export async function listActionQueueCommandCenter(
  userId: number,
  options: Parameters<typeof listActionQueue>[1]
) {
  const [items, portfolio] = await Promise.all([
    listActionQueue(userId, options),
    buildPortfolio(userId),
  ]);
  const liveItems = applyLiveSellDiscipline(items, portfolio.groups);
  const withImpacts = attachSaleImpacts(liveItems, portfolio.groups);
  const hasExecutableSale = withImpacts.some(
    item => item.saleImpact && (item.saleImpact.saleProceedsBase ?? 0) > 0
  );
  if (!hasExecutableSale) return withImpacts;

  const ranked = await buildRankedPlanOverview(
    userId,
    options?.now ?? new Date(),
    portfolio
  );
  const ibkr = portfolio.brokers.find(item => item.key === "ibkr")?.leverage ?? null;
  const candidates = ranked.ranking.monthlyCandidates
    .filter(
      candidate =>
        candidate.ranking.rank !== null &&
        candidate.sizing.status === "BUY" &&
        candidate.sizing.shares > 0 &&
        candidate.sizing.amountBase > 0
    )
    .map(candidate => ({
      symbol: candidate.symbol,
      name: candidate.name,
      rank: candidate.ranking.rank ?? 999,
      shares: candidate.sizing.shares,
      amountBase: candidate.sizing.amountBase,
      lotSize: candidate.sizing.lotSize,
      currentHoldingBase: candidate.holdingValueJpy ?? 0,
      netAssetsBase: portfolio.summary.netAssetsBase,
    }));

  return withImpacts.map(item =>
    item.saleImpact?.saleProceedsBase
      ? {
          ...item,
          proceedsAllocation: allocateSaleProceeds({
            saleProceedsBase: item.saleImpact.saleProceedsBase,
            ibkrBorrowedBase: ibkr?.borrowedBase ?? 0,
            ibkrRiskLevel: ibkr?.riskLevel ?? null,
            soldSymbol: item.symbol,
            candidates,
          }),
        }
      : item
  );
}
