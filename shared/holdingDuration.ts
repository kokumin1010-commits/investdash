import { jstDayKey } from "./jstDate";

export type HoldingDurationConfidence = "EXACT" | "AT_LEAST" | "TRACKED_SINCE";

export type HoldingDurationView = {
  startDate: Date;
  days: number;
  confidence: HoldingDurationConfidence;
  source: "USER_CONFIRMED" | "BROKER_TRADE" | "MONTHLY_SNAPSHOT" | "SYSTEM_IMPORT";
};

function dayOrdinal(date: Date): number {
  const [year, month, day] = jstDayKey(date).split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function buildHoldingDuration(input: {
  acquiredAt?: Date | null;
  acquiredAtSource?: "USER_CONFIRMED" | "BROKER_TRADE" | null;
  earliestSnapshotAt?: Date | null;
  trackedAt: Date;
  now?: Date;
}): HoldingDurationView {
  const now = input.now ?? new Date();
  const startDate = input.acquiredAt ?? input.earliestSnapshotAt ?? input.trackedAt;
  const confidence: HoldingDurationConfidence = input.acquiredAt
    ? "EXACT"
    : input.earliestSnapshotAt
      ? "AT_LEAST"
      : "TRACKED_SINCE";
  const source = input.acquiredAt
    ? (input.acquiredAtSource ?? "USER_CONFIRMED")
    : input.earliestSnapshotAt
      ? "MONTHLY_SNAPSHOT"
      : "SYSTEM_IMPORT";
  return { startDate, days: Math.max(0, dayOrdinal(now) - dayOrdinal(startDate)), confidence, source };
}

export function aggregateHoldingDurations(items: HoldingDurationView[]): HoldingDurationView {
  const earliest = [...items].sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  const confidence = items.every(item => item.confidence === "EXACT") ? "EXACT" :
    items.some(item => item.confidence === "AT_LEAST") ? "AT_LEAST" : "TRACKED_SINCE";
  return { ...earliest, confidence };
}
