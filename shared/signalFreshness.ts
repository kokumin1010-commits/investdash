export type SignalFreshnessInput = {
  createdAt: Date;
  validUntil?: Date | null;
  schemaVersion?: number | null;
  priceAtSignal?: number | null;
  currentPrice?: number | null;
  latestAnalyzedNewsAt?: Date | null;
  cardUpdatedAt?: Date | null;
  now?: Date;
  currentSchemaVersion: number;
};

export type SignalFreshness = {
  isStale: boolean;
  reasons: Array<"SCHEMA" | "EXPIRED" | "NEW_NEWS" | "CARD_UPDATED" | "PRICE_MOVE">;
  priceMovePct: number | null;
};

export function evaluateSignalFreshness(input: SignalFreshnessInput): SignalFreshness {
  const now = input.now ?? new Date();
  const createdAtMs = input.createdAt.getTime();
  const reasons: SignalFreshness["reasons"] = [];

  if ((input.schemaVersion ?? 1) < input.currentSchemaVersion) reasons.push("SCHEMA");

  const defaultExpiry = createdAtMs + 7 * 24 * 60 * 60 * 1000;
  const expiryMs = input.validUntil?.getTime() ?? defaultExpiry;
  if (expiryMs <= now.getTime()) reasons.push("EXPIRED");

  if ((input.latestAnalyzedNewsAt?.getTime() ?? 0) > createdAtMs) reasons.push("NEW_NEWS");
  if ((input.cardUpdatedAt?.getTime() ?? 0) > createdAtMs) reasons.push("CARD_UPDATED");

  let priceMovePct: number | null = null;
  if (
    input.priceAtSignal !== null &&
    input.priceAtSignal !== undefined &&
    input.priceAtSignal > 0 &&
    input.currentPrice !== null &&
    input.currentPrice !== undefined
  ) {
    priceMovePct = ((input.currentPrice - input.priceAtSignal) / input.priceAtSignal) * 100;
    if (Math.abs(priceMovePct) >= 10) reasons.push("PRICE_MOVE");
  }

  return { isStale: reasons.length > 0, reasons, priceMovePct };
}
