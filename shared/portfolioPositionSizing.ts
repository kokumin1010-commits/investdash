import { actualAmount, lotSizeFor, sharesForAmount } from "./addShares";
import type { Market } from "./investing";

export const POSITION_HARD_CAP_PCT = 5;
export const INTERNAL_SECTOR_CAP_PCT = 30;
export const DEPLOYABLE_LIQUIDITY_PCT = 25;

export type PositionSizingAction =
  | "HOLD"
  | "ADD_SMALL"
  | "ADD_MAIN"
  | "VERIFY"
  | "REDUCE";
export type PositionSizingPriority = "HIGH" | "MEDIUM" | "LOW";
export type PositionSizingStatus =
  | "BUY"
  | "WAIT"
  | "BLOCKED_MARGIN"
  | "BLOCKED_POSITION"
  | "BLOCKED_SECTOR"
  | "TOO_SMALL"
  | "UNAVAILABLE";
export type IbkrRiskLevel = "SAFE" | "CAUTION" | "WARNING" | "DANGER";

export type PortfolioPositionSizingInput = {
  action: PositionSizingAction;
  priority?: PositionSizingPriority | null;
  market: Market;
  localPrice: number | null;
  yenPerLocalUnit: number | null;
  netAssetsBase: number;
  liquidAssetsBase: number;
  currentHoldingBase: number;
  sectorValueBase: number;
  userSectorLimitPct?: number | null;
  ibkrLeverage?: number | null;
  ibkrRiskLevel?: IbkrRiskLevel | null;
  ibkrDropToMarginCallPct?: number | null;
};

export type PortfolioPositionSizing = {
  status: PositionSizingStatus;
  amountBase: number;
  amountLocal: number;
  shares: number;
  currentWeightPct: number;
  afterWeightPct: number;
  targetWeightPct: number;
  targetGapBase: number;
  tranchePct: number;
  liquidAssetsBase: number;
  deployableLiquidityBase: number;
  remainingLiquidBase: number;
  positionRoomBase: number;
  sectorCurrentPct: number;
  sectorAfterPct: number;
  sectorLimitPct: number;
  sectorRoomBase: number;
  marginFactor: number;
  ibkrLeverage: number | null;
  ibkrRiskLevel: IbkrRiskLevel | null;
  ibkrDropToMarginCallPct: number | null;
  lotSize: number;
  lotAdjusted: boolean;
  fundingMode: "CASH_ONLY";
  reasons: string[];
};

const TARGET_WEIGHT_BY_PRIORITY: Record<PositionSizingPriority, number> = {
  HIGH: 1.5,
  MEDIUM: 1,
  LOW: 0.5,
};

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function pct(value: number, base: number): number {
  return base > 0 ? (value / base) * 100 : 0;
}

/**
 * 全保有・待機資金・IBKR 主リスクを同じ分母で見て、今回だけの発注量を決める。
 * LLM には金額を決めさせず、価格帯の action だけを入力として使う。
 */
export function computePortfolioPositionSizing(
  input: PortfolioPositionSizingInput
): PortfolioPositionSizing {
  const netAssetsBase = finiteOrZero(input.netAssetsBase);
  const liquidAssetsBase = finiteOrZero(input.liquidAssetsBase);
  const currentHoldingBase = finiteOrZero(input.currentHoldingBase);
  const sectorValueBase = finiteOrZero(input.sectorValueBase);
  const currentWeightPct = pct(currentHoldingBase, netAssetsBase);
  const sectorCurrentPct = pct(sectorValueBase, netAssetsBase);
  const priority = input.priority ?? "MEDIUM";
  const userSectorLimit =
    input.userSectorLimitPct !== null &&
    input.userSectorLimitPct !== undefined &&
    Number.isFinite(input.userSectorLimitPct) &&
    input.userSectorLimitPct > 0
      ? input.userSectorLimitPct
      : INTERNAL_SECTOR_CAP_PCT;
  const sectorLimitPct = Math.min(INTERNAL_SECTOR_CAP_PCT, userSectorLimit);
  const deployableLiquidityBase =
    (liquidAssetsBase * DEPLOYABLE_LIQUIDITY_PCT) / 100;
  const positionRoomBase = Math.max(
    0,
    (netAssetsBase * POSITION_HARD_CAP_PCT) / 100 - currentHoldingBase
  );
  const sectorRoomBase = Math.max(
    0,
    (netAssetsBase * sectorLimitPct) / 100 - sectorValueBase
  );
  const lotSize = lotSizeFor(input.market);
  const isHeld = currentHoldingBase > 0;
  const targetWeightPct = isHeld
    ? Math.min(
        POSITION_HARD_CAP_PCT,
        currentWeightPct + (input.action === "ADD_MAIN" ? 1 : 0.5)
      )
    : TARGET_WEIGHT_BY_PRIORITY[priority];
  const targetGapBase = Math.max(
    0,
    (netAssetsBase * targetWeightPct) / 100 - currentHoldingBase
  );
  const tranchePct =
    input.action === "ADD_MAIN" ? 50 : input.action === "ADD_SMALL" ? 25 : 0;
  const reasons: string[] = [];
  const marginBlocked =
    input.ibkrRiskLevel === "WARNING" ||
    input.ibkrRiskLevel === "DANGER" ||
    (input.ibkrLeverage !== null &&
      input.ibkrLeverage !== undefined &&
      input.ibkrLeverage >= 2) ||
    (input.ibkrDropToMarginCallPct !== null &&
      input.ibkrDropToMarginCallPct !== undefined &&
      input.ibkrDropToMarginCallPct < 25);
  const marginCaution =
    !marginBlocked &&
    (input.ibkrRiskLevel === "CAUTION" ||
      (input.ibkrLeverage !== null &&
        input.ibkrLeverage !== undefined &&
        input.ibkrLeverage >= 1.8));
  const marginFactor = marginCaution ? 0.5 : marginBlocked ? 0 : 1;

  const baseResult = (
    status: PositionSizingStatus,
    extraReasons: string[] = []
  ): PortfolioPositionSizing => ({
    status,
    amountBase: 0,
    amountLocal: 0,
    shares: 0,
    currentWeightPct,
    afterWeightPct: currentWeightPct,
    targetWeightPct,
    targetGapBase,
    tranchePct,
    liquidAssetsBase,
    deployableLiquidityBase,
    remainingLiquidBase: liquidAssetsBase,
    positionRoomBase,
    sectorCurrentPct,
    sectorAfterPct: sectorCurrentPct,
    sectorLimitPct,
    sectorRoomBase,
    marginFactor,
    ibkrLeverage: input.ibkrLeverage ?? null,
    ibkrRiskLevel: input.ibkrRiskLevel ?? null,
    ibkrDropToMarginCallPct: input.ibkrDropToMarginCallPct ?? null,
    lotSize,
    lotAdjusted: false,
    fundingMode: "CASH_ONLY",
    reasons: [...reasons, ...extraReasons],
  });

  if (
    netAssetsBase <= 0 ||
    input.localPrice === null ||
    input.localPrice <= 0
  ) {
    return baseResult("UNAVAILABLE", ["純資産または現在値を確認できません"]);
  }
  if (input.yenPerLocalUnit === null || input.yenPerLocalUnit <= 0) {
    return baseResult("UNAVAILABLE", ["円換算レートを確認できません"]);
  }
  if (
    input.action === "HOLD" ||
    input.action === "VERIFY" ||
    input.action === "REDUCE"
  ) {
    return baseResult("WAIT", ["現在の価格帯では新規発注を行いません"]);
  }
  if (marginBlocked) {
    return baseResult("BLOCKED_MARGIN", [
      "IBKR の主リスクが停止条件に達しています",
    ]);
  }
  if (positionRoomBase <= 0 || targetGapBase <= 0) {
    return baseResult("BLOCKED_POSITION", ["単一銘柄の上限に達しています"]);
  }
  if (sectorRoomBase <= 0) {
    return baseResult("BLOCKED_SECTOR", ["業種の慎重上限に達しています"]);
  }
  if (deployableLiquidityBase <= 0) {
    return baseResult("TOO_SMALL", ["現金性資産の追加余力がありません"]);
  }

  if (marginCaution)
    reasons.push("IBKR が CAUTION のため通常額を 50% に抑えます");
  reasons.push("借入は増やさず、現金性資産だけを原資にします");

  const rawTrancheBase = targetGapBase * (tranchePct / 100) * marginFactor;
  const hardRoomBase = Math.min(
    targetGapBase,
    deployableLiquidityBase,
    positionRoomBase,
    sectorRoomBase
  );
  const normalBudgetBase = Math.min(rawTrancheBase, hardRoomBase);
  const yenPerLocalUnit = input.yenPerLocalUnit;
  let shares = sharesForAmount(
    normalBudgetBase / yenPerLocalUnit,
    input.localPrice,
    input.market
  );
  let lotAdjusted = false;

  if (shares === null || shares <= 0) {
    const oneLotBase = lotSize * input.localPrice * yenPerLocalUnit;
    if (oneLotBase <= hardRoomBase) {
      shares = lotSize;
      lotAdjusted = true;
      reasons.push("最低売買単位に合わせて初回額を調整しました");
    } else {
      return baseResult("TOO_SMALL", [
        "最低売買単位が今回のリスク予算を超えます",
      ]);
    }
  }

  const amountLocal = actualAmount(shares, input.localPrice) ?? 0;
  const amountBase = amountLocal * yenPerLocalUnit;
  const afterWeightPct = pct(currentHoldingBase + amountBase, netAssetsBase);
  const sectorAfterPct = pct(sectorValueBase + amountBase, netAssetsBase);

  return {
    status: "BUY",
    amountBase,
    amountLocal,
    shares,
    currentWeightPct,
    afterWeightPct,
    targetWeightPct,
    targetGapBase,
    tranchePct,
    liquidAssetsBase,
    deployableLiquidityBase,
    remainingLiquidBase: Math.max(0, liquidAssetsBase - amountBase),
    positionRoomBase,
    sectorCurrentPct,
    sectorAfterPct,
    sectorLimitPct,
    sectorRoomBase,
    marginFactor,
    ibkrLeverage: input.ibkrLeverage ?? null,
    ibkrRiskLevel: input.ibkrRiskLevel ?? null,
    ibkrDropToMarginCallPct: input.ibkrDropToMarginCallPct ?? null,
    lotSize,
    lotAdjusted,
    fundingMode: "CASH_ONLY",
    reasons,
  };
}
