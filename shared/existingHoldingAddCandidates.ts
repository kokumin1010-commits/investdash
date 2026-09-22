export const EXISTING_HOLDING_ADD_POLICY_VERSION =
  "existing-holding-add-review-v1";

export const EXISTING_HOLDING_ADD_DEFERRAL_REASONS = [
  "SAFETY_GATE",
  "CONFIRMED_CONCERN",
  "SIGNAL_CONFLICT",
  "SIGNAL_STALE_OR_MISSING",
  "SIGNAL_DATA_LIMITED",
  "VALUATION_NOT_POSITIVE",
  "LOW_CONVICTION",
] as const;

export type ExistingHoldingAddDeferralReason =
  (typeof EXISTING_HOLDING_ADD_DEFERRAL_REASONS)[number];

export const EXISTING_HOLDING_ADD_DEFERRAL_LABELS: Record<
  ExistingHoldingAddDeferralReason,
  string
> = {
  SAFETY_GATE: "数量・集中度・業種・借入などの安全条件を通過していません",
  CONFIRMED_CONCERN: "確認済みの懸念材料があります",
  SIGNAL_CONFLICT: "最新の保有シグナルと買い増しが競合しています",
  SIGNAL_STALE_OR_MISSING: "保有シグナルが未取得または再分析待ちです",
  SIGNAL_DATA_LIMITED: "AI判断の材料品質が不足しています",
  VALUATION_NOT_POSITIVE: "現在値の企業価値確認が買い増し基準に届いていません",
  LOW_CONVICTION: "投資カードの確信度が3未満です",
};

export type ExistingHoldingAddCandidateInput = {
  symbol: string;
  held: boolean;
  action: string | null;
  concernCount: number;
  signalAction: string | null;
  signalDataQuality: string | null;
  signalWouldBuyNow: string | null;
  signalIsStale: boolean | null;
  cardConviction: number | null;
  sizing: {
    status: string;
    shares: number;
    amountBase: number;
  };
  ranking: {
    eligible: boolean;
    rank: number | null;
    gateReasons?: string[];
  };
};

export type ExistingHoldingAddReviewCandidate<
  T extends ExistingHoldingAddCandidateInput,
> = T & {
  /** 厳格確認済み候補だけを詰め直した、ユーザー向けの連番。 */
  reviewRank: number;
  /** 全価格帯候補の元順位。監査・詳細画面で元の並びを追えるように残す。 */
  priceBandRank: number;
};

export type ExistingHoldingAddSummary<
  T extends ExistingHoldingAddCandidateInput,
> = {
  policyVersion: string;
  rawAddZoneCount: number;
  rawAddMainCount: number;
  rawAddSmallCount: number;
  safetyGatePassedCount: number;
  reviewReadyCount: number;
  reviewReadyMainCount: number;
  reviewReadySmallCount: number;
  reviewOnlyCount: number;
  deferralCounts: Record<ExistingHoldingAddDeferralReason, number>;
  candidates: Array<ExistingHoldingAddReviewCandidate<T>>;
};

function isAddZone(row: ExistingHoldingAddCandidateInput): boolean {
  return (
    row.held && (row.action === "ADD_MAIN" || row.action === "ADD_SMALL")
  );
}

function passedExistingSafetyGates(
  row: ExistingHoldingAddCandidateInput
): boolean {
  return (
    row.ranking.eligible &&
    row.ranking.rank !== null &&
    row.sizing.status === "BUY" &&
    row.sizing.shares > 0 &&
    row.sizing.amountBase > 0
  );
}

/**
 * 価格帯に入っただけの銘柄を、そのまま買い推奨にしないための追加確認。
 *
 * - 価格帯ランキングの安全ゲート（数量・単一銘柄5%・業種・IBKR）を必須にする。
 * - WATCH / REDUCE / EXIT と競合するものは除外する。
 * - 再分析待ち、LIMITED、現在値での価値確認が YES でないものは保留する。
 * - 確認済み懸念と低確信度カードも「今月レビュー」から外す。
 *
 * ここで返す候補も注文ではなく、ユーザー確認を前提とした検討順である。
 */
export function existingHoldingAddDeferralReasons(
  row: ExistingHoldingAddCandidateInput
): ExistingHoldingAddDeferralReason[] {
  const reasons: ExistingHoldingAddDeferralReason[] = [];
  if (!passedExistingSafetyGates(row)) reasons.push("SAFETY_GATE");
  if (row.concernCount > 0) reasons.push("CONFIRMED_CONCERN");
  if (row.signalAction !== "ADD" && row.signalAction !== "HOLD") {
    reasons.push("SIGNAL_CONFLICT");
  }
  if (row.signalIsStale !== false) reasons.push("SIGNAL_STALE_OR_MISSING");
  if (
    row.signalDataQuality !== "STRONG" &&
    row.signalDataQuality !== "MODERATE"
  ) {
    reasons.push("SIGNAL_DATA_LIMITED");
  }
  if (row.signalWouldBuyNow !== "YES") {
    reasons.push("VALUATION_NOT_POSITIVE");
  }
  if ((row.cardConviction ?? 0) < 3) reasons.push("LOW_CONVICTION");
  return Array.from(new Set(reasons));
}

export function buildExistingHoldingAddSummary<
  T extends ExistingHoldingAddCandidateInput,
>(rows: T[]): ExistingHoldingAddSummary<T> {
  const addZoneRows = rows.filter(isAddZone);
  const safetyGatePassedCount = addZoneRows.filter(
    passedExistingSafetyGates
  ).length;
  const deferralCounts = Object.fromEntries(
    EXISTING_HOLDING_ADD_DEFERRAL_REASONS.map(reason => [reason, 0])
  ) as Record<ExistingHoldingAddDeferralReason, number>;

  const readyRows: T[] = [];
  for (const row of addZoneRows) {
    const reasons = existingHoldingAddDeferralReasons(row);
    if (reasons.length === 0) {
      readyRows.push(row);
      continue;
    }
    for (const reason of reasons) deferralCounts[reason] += 1;
  }

  const candidates = readyRows
    .sort(
      (a, b) =>
        (a.ranking.rank ?? Number.MAX_SAFE_INTEGER) -
          (b.ranking.rank ?? Number.MAX_SAFE_INTEGER) ||
        a.symbol.localeCompare(b.symbol)
    )
    .map((row, index) => ({
      ...row,
      reviewRank: index + 1,
      priceBandRank: row.ranking.rank!,
    }));

  return {
    policyVersion: EXISTING_HOLDING_ADD_POLICY_VERSION,
    rawAddZoneCount: addZoneRows.length,
    rawAddMainCount: addZoneRows.filter(row => row.action === "ADD_MAIN")
      .length,
    rawAddSmallCount: addZoneRows.filter(row => row.action === "ADD_SMALL")
      .length,
    safetyGatePassedCount,
    reviewReadyCount: candidates.length,
    reviewReadyMainCount: candidates.filter(row => row.action === "ADD_MAIN")
      .length,
    reviewReadySmallCount: candidates.filter(row => row.action === "ADD_SMALL")
      .length,
    reviewOnlyCount: addZoneRows.length - candidates.length,
    deferralCounts,
    candidates,
  };
}
