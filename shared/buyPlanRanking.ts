import type { BandAction } from "./priceBands";
import type { PositionSizingStatus, IbkrRiskLevel } from "./portfolioPositionSizing";

export const BUY_PLAN_SCORE_VERSION = "buy-plan-rank-v1";

export type BuyPlanSignalAction = "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT";

export type BuyPlanRankingInput = {
  symbol: string;
  action: BandAction | null;
  currentPrice: number | null;
  lowerPrice: number | null;
  upperPrice: number | null;
  needsCheck: boolean;
  pendingCheckCount: number;
  concernCount: number;
  signalAction: BuyPlanSignalAction | null;
  signalConfidence: number | null;
  signalDataQuality: "STRONG" | "MODERATE" | "LIMITED" | null;
  hasCard: boolean;
  cardConviction: number | null;
  cardUpdatedAt: Date | null;
  planGeneratedAt: Date;
  sizing: {
    status: PositionSizingStatus;
    amountBase: number;
    shares: number;
    afterWeightPct: number;
    liquidAssetsBase: number;
    sectorCurrentPct: number;
    sectorAfterPct: number;
    sectorLimitPct: number;
    ibkrRiskLevel: IbkrRiskLevel | null;
  };
};

export type BuyPlanScoreBreakdown = {
  quality: number;
  valuation: number;
  fundamentals: number;
  portfolioFit: number;
  liquidityLeverage: number;
};

export type BuyPlanRankingResult = BuyPlanRankingInput & {
  eligible: boolean;
  rank: number | null;
  score: number;
  scoreVersion: string;
  breakdown: BuyPlanScoreBreakdown;
  gateReasons: string[];
  rationale: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function confidencePoints(confidence: number | null): number {
  if (confidence === null || !Number.isFinite(confidence)) return 0;
  return Math.round(clamp(confidence, 0, 100) * 0.08);
}

function convictionPoints(conviction: number | null): number {
  const map: Record<number, number> = { 1: 2, 2: 5, 3: 8, 4: 11, 5: 14 };
  return conviction === null ? 0 : (map[Math.round(conviction)] ?? 0);
}

function bandPositionPoints(input: BuyPlanRankingInput): number {
  const { currentPrice, lowerPrice, upperPrice } = input;
  if (currentPrice === null || currentPrice <= 0) return 0;
  if (
    lowerPrice !== null &&
    upperPrice !== null &&
    upperPrice > lowerPrice
  ) {
    return Math.round(
      clamp((upperPrice - currentPrice) / (upperPrice - lowerPrice), 0, 1) * 5
    );
  }
  if (upperPrice !== null && currentPrice <= upperPrice) return 3;
  if (lowerPrice !== null && currentPrice >= lowerPrice) return 2;
  return 0;
}

function portfolioFitPoints(input: BuyPlanRankingInput): number {
  const after = input.sizing.afterWeightPct;
  let points = after <= 2 ? 15 : after <= 3 ? 12 : after <= 4 ? 8 : after <= 5 ? 4 : 0;
  if (
    input.sizing.sectorLimitPct > 0 &&
    input.sizing.sectorAfterPct >= input.sizing.sectorLimitPct * 0.9
  ) {
    points -= 4;
  }
  return clamp(points, 0, 15);
}

function liquidityLeveragePoints(input: BuyPlanRankingInput): number {
  let points =
    input.sizing.status === "BUY" &&
    input.sizing.amountBase > 0 &&
    input.sizing.shares > 0
      ? 4
      : 0;
  if (
    input.sizing.liquidAssetsBase > 0 &&
    input.sizing.amountBase <= input.sizing.liquidAssetsBase * 0.05
  ) {
    points += 3;
  }
  if (input.sizing.ibkrRiskLevel === "SAFE") points += 3;
  else if (input.sizing.ibkrRiskLevel === "CAUTION") points += 1;
  return clamp(points, 0, 10);
}

function gateReasons(input: BuyPlanRankingInput): string[] {
  const reasons: string[] = [];
  if (input.action !== "ADD_MAIN" && input.action !== "ADD_SMALL") {
    reasons.push("現在の価格帯は買い増し対象ではありません");
  }
  if (
    input.signalAction === "WATCH" ||
    input.signalAction === "REDUCE" ||
    input.signalAction === "EXIT"
  ) {
    reasons.push(`保有シグナル ${input.signalAction} と買い増しが競合しています`);
  }
  if (input.needsCheck || input.pendingCheckCount > 0) {
    reasons.push(`未照合の確認項目が ${input.pendingCheckCount} 件あります`);
  }
  if (input.sizing.status !== "BUY") {
    reasons.push(`実行可能な数量を算出できません（${input.sizing.status}）`);
  }
  if (input.sizing.amountBase <= 0 || input.sizing.shares <= 0) {
    reasons.push("推奨金額または株数が 0 です");
  }
  if (input.sizing.afterWeightPct > 5) {
    reasons.push("買付後の単一銘柄比率が 5% 上限を超えます");
  }
  if (input.sizing.sectorAfterPct > input.sizing.sectorLimitPct) {
    reasons.push("買付後の業種比率が慎重上限を超えます");
  }
  if (
    input.sizing.ibkrRiskLevel === "WARNING" ||
    input.sizing.ibkrRiskLevel === "DANGER"
  ) {
    reasons.push(`IBKR リスク ${input.sizing.ibkrRiskLevel} のため新規買付を停止します`);
  }
  return Array.from(new Set(reasons));
}

export function scoreBuyPlan(input: BuyPlanRankingInput): BuyPlanRankingResult {
  const gates = gateReasons(input);
  const quality = clamp(
    (input.hasCard ? 8 : 0) +
      convictionPoints(input.cardConviction) +
      confidencePoints(input.signalConfidence),
    0,
    30
  );
  const valuation = clamp(
    (input.action === "ADD_MAIN" ? 20 : input.action === "ADD_SMALL" ? 14 : 0) +
      bandPositionPoints(input),
    0,
    25
  );
  const fundamentals = clamp(
    (input.signalAction === "ADD"
      ? 14
      : input.signalAction === "HOLD"
        ? 8
        : input.signalAction === null
          ? 4
          : 0) +
      ((input.signalConfidence ?? 0) >= 80
        ? 4
        : (input.signalConfidence ?? 0) >= 60
          ? 2
          : 0) -
      Math.min(8, input.concernCount * 4),
    0,
    20
  );
  const portfolioFit = portfolioFitPoints(input);
  const liquidityLeverage = liquidityLeveragePoints(input);
  const breakdown = {
    quality,
    valuation,
    fundamentals,
    portfolioFit,
    liquidityLeverage,
  };
  const score = Object.values(breakdown).reduce((total, value) => total + value, 0);
  const rationale = [
    input.action === "ADD_MAIN"
      ? "現在は主力買い増し価格帯"
      : input.action === "ADD_SMALL"
        ? "現在は小幅買い増し価格帯"
        : "現在は買い増し価格帯外",
    input.hasCard
      ? `投資カード確信度 ${input.cardConviction ?? "未設定"}/5`
      : "投資カード未整備のため品質点を加算していません",
    input.signalAction
      ? `最新シグナル ${input.signalAction}（確信度 ${input.signalConfidence ?? "未取得"}）`
      : "最新シグナル未取得のため控えめに評価",
    `買付後構成比 ${input.sizing.afterWeightPct.toFixed(2)}%`,
    input.concernCount > 0
      ? `核验済みの懸念 ${input.concernCount} 件を減点`
      : "核验済みの懸念はありません",
  ];

  return {
    ...input,
    eligible: gates.length === 0,
    rank: null,
    score,
    scoreVersion: BUY_PLAN_SCORE_VERSION,
    breakdown,
    gateReasons: gates,
    rationale,
  };
}

export function rankBuyPlans(inputs: BuyPlanRankingInput[]): BuyPlanRankingResult[] {
  const scored = inputs.map(scoreBuyPlan).sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    if (a.action !== b.action) {
      if (a.action === "ADD_MAIN") return -1;
      if (b.action === "ADD_MAIN") return 1;
    }
    if (a.breakdown.valuation !== b.breakdown.valuation) {
      return b.breakdown.valuation - a.breakdown.valuation;
    }
    if (a.sizing.afterWeightPct !== b.sizing.afterWeightPct) {
      return a.sizing.afterWeightPct - b.sizing.afterWeightPct;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  let rank = 0;
  return scored.map(item => {
    if (!item.eligible) return item;
    rank += 1;
    return { ...item, rank };
  });
}

export function rankingMonthJst(date: Date): string {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buyPlanMaterialKey(input: BuyPlanRankingInput): Record<string, unknown> {
  return {
    symbol: input.symbol,
    action: input.action,
    needsCheck: input.needsCheck,
    pendingCheckCount: input.pendingCheckCount,
    concernCount: input.concernCount,
    signalAction: input.signalAction,
    signalConfidenceBand:
      input.signalConfidence === null ? null : Math.floor(input.signalConfidence / 10) * 10,
    signalDataQuality: input.signalDataQuality,
    hasCard: input.hasCard,
    cardConviction: input.cardConviction,
    cardUpdatedAt: input.cardUpdatedAt?.toISOString() ?? null,
    planGeneratedAt: input.planGeneratedAt.toISOString(),
    sizingStatus: input.sizing.status,
    afterWeightBand: Math.floor(input.sizing.afterWeightPct),
    sectorRiskBand:
      input.sizing.sectorLimitPct > 0
        ? Math.floor(
            (input.sizing.sectorAfterPct / input.sizing.sectorLimitPct) * 10
          )
        : null,
    ibkrRiskLevel: input.sizing.ibkrRiskLevel,
  };
}
