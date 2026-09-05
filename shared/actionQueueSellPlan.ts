import { DEPLOYABLE_LIQUIDITY_PCT } from "./portfolioPositionSizing";

export type SaleImpact = {
  currentPnlBase: number | null;
  currentPnlPct: number | null;
  saleProceedsBase: number | null;
  estimatedRealizedPnlBase: number | null;
  afterValueBase: number | null;
  remainingPnlBase: number | null;
  soldRatio: number | null;
};

export function calculateSaleImpact(input: {
  currentQuantity: number;
  sellShares: number;
  currentValueBase: number | null;
  currentCostBase: number | null;
  currentPnlPct: number | null;
  costBasisReliable: boolean;
}): SaleImpact {
  const quantity = Number.isFinite(input.currentQuantity)
    ? Math.max(0, input.currentQuantity)
    : 0;
  const sellShares = Number.isFinite(input.sellShares)
    ? Math.min(quantity, Math.max(0, input.sellShares))
    : 0;
  const soldRatio = quantity > 0 ? sellShares / quantity : null;
  const currentValueBase =
    input.currentValueBase !== null && Number.isFinite(input.currentValueBase)
      ? input.currentValueBase
      : null;
  const currentCostBase =
    input.currentCostBase !== null && Number.isFinite(input.currentCostBase)
      ? input.currentCostBase
      : null;
  const currentPnlBase =
    currentValueBase !== null && currentCostBase !== null
      ? currentValueBase - currentCostBase
      : null;
  const saleProceedsBase =
    currentValueBase !== null && soldRatio !== null
      ? currentValueBase * soldRatio
      : null;
  const estimatedRealizedPnlBase =
    input.costBasisReliable && currentPnlBase !== null && soldRatio !== null
      ? currentPnlBase * soldRatio
      : null;
  const afterValueBase =
    currentValueBase !== null && saleProceedsBase !== null
      ? Math.max(0, currentValueBase - saleProceedsBase)
      : null;
  const remainingPnlBase =
    input.costBasisReliable && currentPnlBase !== null && estimatedRealizedPnlBase !== null
      ? currentPnlBase - estimatedRealizedPnlBase
      : null;

  return {
    currentPnlBase,
    currentPnlPct: input.costBasisReliable ? input.currentPnlPct : null,
    saleProceedsBase,
    estimatedRealizedPnlBase,
    afterValueBase,
    remainingPnlBase,
    soldRatio,
  };
}

export type SaleProceedsCandidate = {
  symbol: string;
  name: string;
  rank: number;
  shares: number;
  amountBase: number;
  lotSize: number;
  currentHoldingBase: number;
  netAssetsBase: number;
};

export type SaleProceedsAllocation = {
  saleProceedsBase: number;
  debtRepaymentBase: number;
  cashReserveBase: number;
  reinvestmentBudgetBase: number;
  reinvestmentAllocatedBase: number;
  unallocatedBase: number;
  ibkrRiskLevel: "SAFE" | "CAUTION" | "WARNING" | "DANGER" | null;
  allocations: Array<{
    symbol: string;
    name: string;
    rank: number;
    shares: number;
    amountBase: number;
    afterWeightPct: number | null;
  }>;
};

export function allocateSaleProceeds(input: {
  saleProceedsBase: number;
  ibkrBorrowedBase: number;
  ibkrRiskLevel: SaleProceedsAllocation["ibkrRiskLevel"];
  soldSymbol: string;
  candidates: SaleProceedsCandidate[];
}): SaleProceedsAllocation {
  const proceeds = Number.isFinite(input.saleProceedsBase)
    ? Math.max(0, input.saleProceedsBase)
    : 0;
  const borrowed = Number.isFinite(input.ibkrBorrowedBase)
    ? Math.max(0, input.ibkrBorrowedBase)
    : 0;
  const debtFirst =
    borrowed > 0 &&
    (input.ibkrRiskLevel === "CAUTION" ||
      input.ibkrRiskLevel === "WARNING" ||
      input.ibkrRiskLevel === "DANGER");
  const debtRepaymentBase = debtFirst ? Math.min(proceeds, borrowed) : 0;
  const afterDebt = Math.max(0, proceeds - debtRepaymentBase);
  const reinvestmentBudgetBase =
    afterDebt * (DEPLOYABLE_LIQUIDITY_PCT / 100);
  const baseCashReserve = afterDebt - reinvestmentBudgetBase;
  let remainingBudget = reinvestmentBudgetBase;
  const allocations: SaleProceedsAllocation["allocations"] = [];

  for (const candidate of [...input.candidates].sort((a, b) => a.rank - b.rank)) {
    if (
      allocations.length >= 3 ||
      candidate.symbol === input.soldSymbol ||
      candidate.shares <= 0 ||
      candidate.amountBase <= 0 ||
      remainingBudget <= 0
    ) {
      continue;
    }
    const yenPerShare = candidate.amountBase / candidate.shares;
    if (!Number.isFinite(yenPerShare) || yenPerShare <= 0) continue;
    const lotSize = Math.max(1, Math.floor(candidate.lotSize));
    const affordableShares =
      Math.floor(remainingBudget / yenPerShare / lotSize) * lotSize;
    const shares = Math.min(candidate.shares, affordableShares);
    if (shares <= 0) continue;
    const amountBase = shares * yenPerShare;
    allocations.push({
      symbol: candidate.symbol,
      name: candidate.name,
      rank: candidate.rank,
      shares,
      amountBase,
      afterWeightPct:
        candidate.netAssetsBase > 0
          ? ((candidate.currentHoldingBase + amountBase) /
              candidate.netAssetsBase) *
            100
          : null,
    });
    remainingBudget = Math.max(0, remainingBudget - amountBase);
  }

  const reinvestmentAllocatedBase = allocations.reduce(
    (sum, item) => sum + item.amountBase,
    0
  );
  return {
    saleProceedsBase: proceeds,
    debtRepaymentBase,
    cashReserveBase: baseCashReserve + remainingBudget,
    reinvestmentBudgetBase,
    reinvestmentAllocatedBase,
    unallocatedBase: remainingBudget,
    ibkrRiskLevel: input.ibkrRiskLevel,
    allocations,
  };
}
