export const BUY_PLAN_OPPORTUNITY_VERSION = "unheld-quality-price-v1";
export const BUY_PLAN_GROUP_SIZE = 10;

export type RankedBuyPlanLike = {
  held: boolean;
  action: string | null;
  needsCheck: boolean;
  pendingCheckCount: number;
  concernCount: number;
  signalDataQuality: string | null;
  cardConviction: number | null;
  sizing: {
    status: string;
    shares: number;
    amountBase: number;
  };
  ranking: {
    eligible: boolean;
    rank: number | null;
    breakdown: Record<string, number>;
  };
};

export function selectAllRankedCandidates<T extends RankedBuyPlanLike>(rows: T[]): T[] {
  return rows
    .filter(
      row =>
        row.ranking.eligible &&
        row.ranking.rank !== null &&
        row.sizing.shares > 0 &&
        row.sizing.amountBase > 0
    )
    .sort((a, b) => (a.ranking.rank ?? Number.MAX_SAFE_INTEGER) - (b.ranking.rank ?? Number.MAX_SAFE_INTEGER));
}

/**
 * 「良い会社」を断定せず、既存カード・資料品質・価格帯・実行可能性が
 * すべて確認できる未保有候補だけを一次建て候補として抽出する。
 */
export function selectUnheldQualityPriceOpportunities<T extends RankedBuyPlanLike>(
  rows: T[]
): T[] {
  return selectAllRankedCandidates(rows).filter(
    row =>
      !row.held &&
      (row.action === "ADD_MAIN" || row.action === "ADD_SMALL") &&
      !row.needsCheck &&
      row.pendingCheckCount === 0 &&
      row.concernCount === 0 &&
      (row.signalDataQuality === "STRONG" || row.signalDataQuality === "MODERATE") &&
      (row.cardConviction ?? 0) >= 3 &&
      (row.ranking.breakdown.quality ?? 0) >= 18
  );
}

export function groupRankedCandidates<T>(rows: T[], size = BUY_PLAN_GROUP_SIZE): T[][] {
  const normalizedSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : BUY_PLAN_GROUP_SIZE;
  const groups: T[][] = [];
  for (let index = 0; index < rows.length; index += normalizedSize) {
    groups.push(rows.slice(index, index + normalizedSize));
  }
  return groups;
}
