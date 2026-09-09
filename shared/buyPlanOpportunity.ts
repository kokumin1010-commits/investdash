export const BUY_PLAN_OPPORTUNITY_VERSION = "unheld-purchase-decision-v2";
export const BUY_PLAN_GROUP_SIZE = 10;

export const UNHELD_PURCHASE_DECISIONS = [
  "BUY_NOW",
  "PRICE_WAIT",
  "DATA_WAIT",
  "SKIP",
] as const;

export type UnheldPurchaseDecision = (typeof UNHELD_PURCHASE_DECISIONS)[number];

export const UNHELD_PURCHASE_DECISION_LABELS: Record<UnheldPurchaseDecision, string> = {
  BUY_NOW: "今すぐ購入を検討",
  PRICE_WAIT: "価格待ち",
  DATA_WAIT: "資料確認待ち",
  SKIP: "今回は見送る",
};

export type UnheldPurchaseDecisionView = {
  decision: UnheldPurchaseDecision;
  label: string;
  reasons: string[];
};

export type RankedBuyPlanLike = {
  symbol: string;
  held: boolean;
  action: string | null;
  currentPrice: number | null;
  outsideDirection?: "ABOVE" | "BELOW" | null;
  targetTooFar?: boolean;
  needsCheck: boolean;
  pendingCheckCount: number;
  concernCount: number;
  signalAction?: string | null;
  signalDataQuality: string | null;
  cardConviction: number | null;
  sizing: {
    status: string;
    shares: number;
    amountBase: number;
    ibkrRiskLevel?: string | null;
    reasons?: string[];
  };
  ranking: {
    eligible: boolean;
    rank: number | null;
    score?: number;
    breakdown: Record<string, number>;
    gateReasons?: string[];
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
): Array<T & { purchaseDecision: UnheldPurchaseDecisionView }> {
  return selectUnheldPurchaseCandidates(rows).filter(
    row => row.purchaseDecision.decision === "BUY_NOW"
  );
}

function uniqueReasons(reasons: Array<string | null | undefined>): string[] {
  return Array.from(new Set(reasons.filter((reason): reason is string => Boolean(reason))));
}

/**
 * 全口座合算で本当に未保有の銘柄だけを、現在の情報で4つに分類する。
 * 「仮に未保有なら」という保有シグナルの参考値は一切使わない。
 */
export function classifyUnheldPurchaseCandidate(
  row: RankedBuyPlanLike
): UnheldPurchaseDecisionView | null {
  if (row.held) return null;

  if (row.concernCount > 0) {
    return {
      decision: "SKIP",
      label: UNHELD_PURCHASE_DECISION_LABELS.SKIP,
      reasons: [`確認済みの懸念が ${row.concernCount} 件あります`],
    };
  }
  if (row.signalAction === "REDUCE" || row.signalAction === "EXIT") {
    return {
      decision: "SKIP",
      label: UNHELD_PURCHASE_DECISION_LABELS.SKIP,
      reasons: [`最新シグナルが ${row.signalAction} のため新規購入と競合します`],
    };
  }
  if (row.sizing.ibkrRiskLevel === "WARNING" || row.sizing.ibkrRiskLevel === "DANGER") {
    return {
      decision: "SKIP",
      label: UNHELD_PURCHASE_DECISION_LABELS.SKIP,
      reasons: [`IBKR リスク ${row.sizing.ibkrRiskLevel} のため新規購入を停止します`],
    };
  }

  const dataReasons = uniqueReasons([
    row.currentPrice === null ? "現在価格を取得できていません" : null,
    row.needsCheck || row.pendingCheckCount > 0
      ? `未照合の確認項目が ${row.pendingCheckCount} 件あります`
      : null,
    row.action === "VERIFY" ? "現在の価格帯で材料確認が必要です" : null,
    row.signalDataQuality === null || row.signalDataQuality === "LIMITED"
      ? "判断資料の品質が十分ではありません"
      : null,
    row.cardConviction === null ? "投資カードの確信度が未設定です" : null,
    row.outsideDirection === "BELOW" ? "想定価格帯を下回ったため下落理由の再確認が必要です" : null,
  ]);
  if (dataReasons.length > 0) {
    return {
      decision: "DATA_WAIT",
      label: UNHELD_PURCHASE_DECISION_LABELS.DATA_WAIT,
      reasons: dataReasons,
    };
  }

  const inBuyBand = row.action === "ADD_MAIN" || row.action === "ADD_SMALL";
  const strictQuality =
    (row.signalDataQuality === "STRONG" || row.signalDataQuality === "MODERATE") &&
    (row.cardConviction ?? 0) >= 3 &&
    (row.ranking.breakdown.quality ?? 0) >= 18;
  const executable =
    row.ranking.eligible &&
    row.sizing.status === "BUY" &&
    row.sizing.shares > 0 &&
    row.sizing.amountBase > 0;

  if (inBuyBand && strictQuality && executable) {
    return {
      decision: "BUY_NOW",
      label: UNHELD_PURCHASE_DECISION_LABELS.BUY_NOW,
      reasons: [
        "全口座合算で保有0株です",
        row.action === "ADD_MAIN" ? "主力買い価格帯に入っています" : "打診買い価格帯に入っています",
        "資料品質・確認項目・初回購入サイズの条件を通過しています",
      ],
    };
  }

  if (!inBuyBand) {
    return {
      decision: "PRICE_WAIT",
      label: UNHELD_PURCHASE_DECISION_LABELS.PRICE_WAIT,
      reasons: uniqueReasons([
        row.targetTooFar
          ? "登録した目標価格が現在値から遠いため、価格条件の見直しも必要です"
          : "現在は初回購入の価格帯に入っていません",
        row.outsideDirection === "ABOVE" ? "登録した価格帯より上にあります" : null,
      ]),
    };
  }

  const skipReasons = uniqueReasons([
    (row.cardConviction ?? 0) < 3 ? "投資カードの確信度が購入基準に届いていません" : null,
    (row.ranking.breakdown.quality ?? 0) < 18 ? "構造資料の品質点が購入基準に届いていません" : null,
    row.signalAction === "WATCH" ? "最新シグナルが WATCH のため今回は待ちます" : null,
    ...(row.ranking.gateReasons ?? []),
    ...(row.sizing.reasons ?? []),
  ]);
  return {
    decision: "SKIP",
    label: UNHELD_PURCHASE_DECISION_LABELS.SKIP,
    reasons: skipReasons.length > 0 ? skipReasons : ["現在の購入条件を満たしていません"],
  };
}

export function selectUnheldPurchaseCandidates<T extends RankedBuyPlanLike>(
  rows: T[]
): Array<T & { purchaseDecision: UnheldPurchaseDecisionView }> {
  const order: Record<UnheldPurchaseDecision, number> = {
    BUY_NOW: 0,
    PRICE_WAIT: 1,
    DATA_WAIT: 2,
    SKIP: 3,
  };
  return rows
    .filter(row => !row.held)
    .map(row => ({ ...row, purchaseDecision: classifyUnheldPurchaseCandidate(row)! }))
    .sort((a, b) => {
      const decisionDiff = order[a.purchaseDecision.decision] - order[b.purchaseDecision.decision];
      if (decisionDiff !== 0) return decisionDiff;
      const rankDiff = (a.ranking.rank ?? Number.MAX_SAFE_INTEGER) - (b.ranking.rank ?? Number.MAX_SAFE_INTEGER);
      if (rankDiff !== 0) return rankDiff;
      const scoreDiff = (b.ranking.score ?? 0) - (a.ranking.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return a.symbol.localeCompare(b.symbol);
    });
}

export function groupRankedCandidates<T>(rows: T[], size = BUY_PLAN_GROUP_SIZE): T[][] {
  const normalizedSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : BUY_PLAN_GROUP_SIZE;
  const groups: T[][] = [];
  for (let index = 0; index < rows.length; index += normalizedSize) {
    groups.push(rows.slice(index, index + normalizedSize));
  }
  return groups;
}
