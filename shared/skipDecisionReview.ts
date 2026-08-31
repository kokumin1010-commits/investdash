export const SKIP_PROCESS_VERSION = "skip-process-v1";
export const SKIP_OUTCOME_VERSION = "skip-outcome-v1";

export type SkipProcessQuality =
  | "DISCIPLINE_SOUND"
  | "DISCIPLINE_NEEDS_IMPROVEMENT"
  | "PROCESS_UNCLEAR";

export type SkipOutcomeQuality =
  | "OUTCOME_FAVORABLE"
  | "OUTCOME_UNFAVORABLE"
  | "OUTCOME_NOT_YET_CLEAR";

export type SkipReviewMilestoneType =
  | "DAY_30"
  | "DAY_90"
  | "DAY_180"
  | "AFTER_EARNINGS";

export type SkipDirection = "BUY" | "NONE" | "REVIEW" | "SELL" | "EXIT";
export type SignalAction = "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT";

export type SkipMilestoneSeed = {
  milestoneType: Exclude<SkipReviewMilestoneType, "AFTER_EARNINGS">;
  eventKey: "day-30" | "day-90" | "day-180";
  dueAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildSkipMilestoneSeeds(skippedAt: Date): SkipMilestoneSeed[] {
  return [
    { milestoneType: "DAY_30", eventKey: "day-30", dueAt: new Date(skippedAt.getTime() + 30 * DAY_MS) },
    { milestoneType: "DAY_90", eventKey: "day-90", dueAt: new Date(skippedAt.getTime() + 90 * DAY_MS) },
    { milestoneType: "DAY_180", eventKey: "day-180", dueAt: new Date(skippedAt.getTime() + 180 * DAY_MS) },
  ];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export function evaluateSkipProcess(input: {
  direction: SkipDirection | null;
  decisionNote: string | null;
  recommendedShares: number | null;
  recommendedAmountBase: number | null;
  evidence: Record<string, unknown> | null;
}): { quality: SkipProcessQuality; reasons: string[]; version: string } {
  const evidence = input.evidence ?? {};
  const riskFlags = stringArray(evidence.riskFlags);
  const sizingStatus = typeof evidence.sizingStatus === "string" ? evidence.sizingStatus : null;
  const dataQuality = typeof evidence.dataQuality === "string" ? evidence.dataQuality : null;
  const ibkrRiskLevel =
    typeof evidence.ibkrRiskLevel === "string" ? evidence.ibkrRiskLevel : null;
  const note = input.decisionNote?.trim() ?? "";
  const reasons: string[] = [];

  if (riskFlags.length > 0) reasons.push(`当時のリスクフラグ ${riskFlags.length} 件を確認して見送った`);
  if (dataQuality === "LIMITED") reasons.push("当時の資料品質が限定的だった");
  if (sizingStatus && sizingStatus !== "BUY") reasons.push(`当時の買付サイズ判定が ${sizingStatus} だった`);
  if (ibkrRiskLevel === "WARNING" || ibkrRiskLevel === "DANGER") {
    reasons.push(`当時の IBKR リスクが ${ibkrRiskLevel} だった`);
  }
  if (
    input.direction === "BUY" &&
    ((input.recommendedShares ?? 0) <= 0 || (input.recommendedAmountBase ?? 0) <= 0)
  ) {
    reasons.push("当時は実行可能な買付数量または金額を算出できなかった");
  }
  if (note.length >= 4) reasons.push("見送り理由を当時の言葉で記録した");

  if (reasons.length > 0) {
    return { quality: "DISCIPLINE_SOUND", reasons, version: SKIP_PROCESS_VERSION };
  }

  if (input.direction === "BUY" || input.direction === "SELL" || input.direction === "EXIT") {
    return {
      quality: "DISCIPLINE_NEEDS_IMPROVEMENT",
      reasons: ["実行可能な提案を見送ったが、当時の理由が記録されていない"],
      version: SKIP_PROCESS_VERSION,
    };
  }

  return {
    quality: "PROCESS_UNCLEAR",
    reasons: ["確認提案のため、現時点の資料だけでは見送り規律を判定できない"],
    version: SKIP_PROCESS_VERSION,
  };
}

export type SkipOutcomeEvaluation = {
  quality: SkipOutcomeQuality;
  version: string;
  currentPrice: number | null;
  returnPct: number | null;
  highestPrice: number | null;
  lowestPrice: number | null;
  maxUpsidePct: number | null;
  maxDrawdownPct: number | null;
  observedTradingDays: number;
  summary: string;
};

export function calculateCounterfactualEffectBase(input: {
  direction: SkipDirection | null;
  recommendedAmountBase: number | null;
  returnPct: number | null;
}): number | null {
  const amount = input.recommendedAmountBase;
  const returnPct = input.returnPct;
  if (
    amount === null ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    returnPct === null ||
    !Number.isFinite(returnPct)
  ) {
    return null;
  }
  if (input.direction === "BUY") return amount * (returnPct / 100);
  if (input.direction === "SELL" || input.direction === "EXIT") {
    return -amount * (returnPct / 100);
  }
  return null;
}

function percentChange(value: number, baseline: number): number {
  return ((value - baseline) / baseline) * 100;
}

function validPrices(prices: number[]): number[] {
  return prices.filter(price => Number.isFinite(price) && price > 0);
}

export function evaluateSkipOutcome(input: {
  direction: SkipDirection | null;
  milestoneType: SkipReviewMilestoneType;
  baselinePrice: number | null;
  currentPrice: number | null;
  observedPrices: number[];
  signalAction: SignalAction | null;
}): SkipOutcomeEvaluation {
  const prices = validPrices(input.observedPrices);
  const observedTradingDays = prices.length;
  const baseline = input.baselinePrice;
  const current = input.currentPrice;
  const canCompare =
    baseline !== null && baseline > 0 && current !== null && Number.isFinite(current) && current > 0;
  const highestPrice = prices.length > 0 ? Math.max(...prices) : null;
  const lowestPrice = prices.length > 0 ? Math.min(...prices) : null;
  const returnPct = canCompare ? percentChange(current, baseline) : null;
  const maxUpsidePct =
    baseline && baseline > 0 && highestPrice !== null ? percentChange(highestPrice, baseline) : null;
  const maxDrawdownPct =
    baseline && baseline > 0 && lowestPrice !== null ? percentChange(lowestPrice, baseline) : null;

  const base = {
    version: SKIP_OUTCOME_VERSION,
    currentPrice: current,
    returnPct,
    highestPrice,
    lowestPrice,
    maxUpsidePct,
    maxDrawdownPct,
    observedTradingDays,
  };

  if (!canCompare) {
    return {
      ...base,
      quality: "OUTCOME_NOT_YET_CLEAR",
      summary: "基準価格または現在価格を取得できず、結果はまだ判定できません。",
    };
  }

  if (input.milestoneType === "DAY_30") {
    return {
      ...base,
      quality: "OUTCOME_NOT_YET_CLEAR",
      summary: `30日確認では短期の値動きを結論にせず、記録開始後 ${observedTradingDays} 日分を確認しました。`,
    };
  }

  const signalSupportsSkip =
    (input.direction === "BUY" &&
      (input.signalAction === "REDUCE" || input.signalAction === "EXIT")) ||
    ((input.direction === "SELL" || input.direction === "EXIT") && input.signalAction === "ADD");

  if (signalSupportsSkip) {
    return {
      ...base,
      quality: "OUTCOME_FAVORABLE",
      summary: "見送り後の新しいシグナル方向は、見送った結果に有利な変化でした。",
    };
  }

  const minimumDays = input.milestoneType === "AFTER_EARNINGS" ? 1 : 15;
  if (observedTradingDays < minimumDays) {
    return {
      ...base,
      quality: "OUTCOME_NOT_YET_CLEAR",
      summary: `価格観測が ${observedTradingDays} 日分のため、結果判定に必要な記録がまだ不足しています。`,
    };
  }

  if (input.direction === "NONE" || input.direction === "REVIEW" || input.direction === null) {
    return {
      ...base,
      quality: "OUTCOME_NOT_YET_CLEAR",
      summary: "確認提案の見送りは価格だけで有利・不利を決めず、新しい事業材料を待ちます。",
    };
  }

  const threshold = input.milestoneType === "DAY_90" ? 10 : 15;
  let quality: SkipOutcomeQuality = "OUTCOME_NOT_YET_CLEAR";
  if (input.direction === "BUY") {
    if ((returnPct ?? 0) >= threshold) quality = "OUTCOME_UNFAVORABLE";
    else if ((returnPct ?? 0) <= -threshold) quality = "OUTCOME_FAVORABLE";
  } else if (input.direction === "SELL" || input.direction === "EXIT") {
    if ((returnPct ?? 0) >= threshold) quality = "OUTCOME_FAVORABLE";
    else if ((returnPct ?? 0) <= -threshold) quality = "OUTCOME_UNFAVORABLE";
  }

  const pctLabel = `${(returnPct ?? 0).toFixed(1)}%`;
  const summary =
    quality === "OUTCOME_FAVORABLE"
      ? `見送った後の価格経路（現在 ${pctLabel}）は結果面で有利でした。これは当時の判断過程とは別評価です。`
      : quality === "OUTCOME_UNFAVORABLE"
        ? `見送った後の価格経路（現在 ${pctLabel}）は結果面で不利でした。ただし価格だけで当時の判断を誤りとはしません。`
        : `現在の変化は ${pctLabel} で判定帯の内側です。結果はまだ明確ではありません。`;

  return { ...base, quality, summary };
}
