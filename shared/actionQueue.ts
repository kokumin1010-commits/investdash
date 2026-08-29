import type { HoldingSignalAction } from "./holdingActionPlan";

export type ActionQueueStatus =
  | "WAITING_MATERIAL"
  | "REANALYZING"
  | "PENDING_ACTION"
  | "APPROVED"
  | "SNOOZED"
  | "SKIPPED"
  | "COMPLETED"
  | "FAILED";

export type ActionQueueTriggerType =
  | "INITIAL_REVIEW"
  | "EARNINGS"
  | "IMPORTANT_NEWS"
  | "MANUAL_ANALYSIS"
  | "SIGNAL_CHANGE";

export type ActionQueueDecision =
  | "APPROVE"
  | "SNOOZE"
  | "SKIP"
  | "COMPLETE"
  | "RETRY";

export const ACTIVE_ACTION_QUEUE_STATUSES: ActionQueueStatus[] = [
  "WAITING_MATERIAL",
  "REANALYZING",
  "PENDING_ACTION",
  "APPROVED",
  "SNOOZED",
  "FAILED",
];

const STATUS_TRANSITIONS: Record<
  ActionQueueStatus,
  Partial<Record<ActionQueueDecision, ActionQueueStatus>>
> = {
  WAITING_MATERIAL: { SKIP: "SKIPPED", RETRY: "REANALYZING" },
  REANALYZING: { SKIP: "SKIPPED", RETRY: "REANALYZING" },
  PENDING_ACTION: {
    APPROVE: "APPROVED",
    SNOOZE: "SNOOZED",
    SKIP: "SKIPPED",
    COMPLETE: "COMPLETED",
  },
  APPROVED: { SKIP: "SKIPPED", COMPLETE: "COMPLETED" },
  SNOOZED: {
    APPROVE: "APPROVED",
    SNOOZE: "SNOOZED",
    SKIP: "SKIPPED",
    COMPLETE: "COMPLETED",
  },
  SKIPPED: {},
  COMPLETED: {},
  FAILED: { SKIP: "SKIPPED", RETRY: "REANALYZING" },
};

export function nextActionQueueStatus(
  current: ActionQueueStatus,
  decision: ActionQueueDecision
): ActionQueueStatus | null {
  return STATUS_TRANSITIONS[current][decision] ?? null;
}

export function shouldQueueSignal(input: {
  triggerType: ActionQueueTriggerType;
  previousAction: HoldingSignalAction | null;
  action: HoldingSignalAction;
}): boolean {
  if (input.action === "HOLD") return false;
  if (input.triggerType === "SIGNAL_CHANGE") {
    return (
      input.previousAction !== null && input.previousAction !== input.action
    );
  }
  if (
    input.action === "ADD" ||
    input.action === "REDUCE" ||
    input.action === "EXIT"
  ) {
    return true;
  }
  // WATCH は決算・重要ニュース・手動判断・実際の action 変化だけを本人確認へ回す。
  return (
    input.triggerType === "EARNINGS" ||
    input.triggerType === "IMPORTANT_NEWS" ||
    input.triggerType === "MANUAL_ANALYSIS" ||
    input.previousAction !== input.action
  );
}

export function actionQueuePriority(input: {
  action: HoldingSignalAction;
  triggerType: ActionQueueTriggerType;
  deadline: Date | null;
  currentValueBase: number | null;
  now?: Date;
}): number {
  const actionScore: Record<HoldingSignalAction, number> = {
    EXIT: 100,
    REDUCE: 80,
    ADD: 70,
    WATCH: 50,
    HOLD: 0,
  };
  let score = actionScore[input.action];
  if (input.triggerType === "EARNINGS") score += 10;
  if (input.triggerType === "IMPORTANT_NEWS") score += 5;
  if (input.deadline) {
    const remaining =
      input.deadline.getTime() - (input.now ?? new Date()).getTime();
    if (remaining < 0) score += 20;
    else if (remaining <= 48 * 3600_000) score += 10;
  }
  // 評価額は並び替えの補助。巨大ポジションでも action を逆転させない。
  const value = Math.max(0, input.currentValueBase ?? 0);
  score += Math.min(9, Math.floor(Math.log10(Math.max(1, value))));
  return score;
}

export function actionQueueDeadline(
  action: HoldingSignalAction,
  triggerType: ActionQueueTriggerType,
  now = new Date()
): Date {
  const days =
    triggerType === "INITIAL_REVIEW"
      ? 7
      : action === "EXIT" || action === "REDUCE"
        ? 2
        : 3;
  return new Date(now.getTime() + days * 24 * 3600_000);
}

export function buildActionQueueTriggerKey(input: {
  triggerType: ActionQueueTriggerType;
  previousSignalId: number | null;
  sourceSignalId?: number | null;
  sourceNewsId?: number | null;
  symbol: string;
}): string {
  if (input.triggerType === "INITIAL_REVIEW") {
    return `initial:${input.symbol}:${input.sourceSignalId ?? "none"}`;
  }
  if (input.triggerType === "MANUAL_ANALYSIS") {
    return `manual:${input.symbol}:after-${input.previousSignalId ?? "none"}`;
  }
  if (input.sourceNewsId) {
    return `${input.triggerType.toLowerCase()}:${input.symbol}:news-${input.sourceNewsId}`;
  }
  return `${input.triggerType.toLowerCase()}:${input.symbol}:signal-${input.previousSignalId ?? input.sourceSignalId ?? "none"}`;
}

export function isPendingActionStatus(
  status: ActionQueueStatus,
  now = new Date(),
  snoozedUntil?: Date | null
): boolean {
  if (status === "SNOOZED") return !snoozedUntil || snoozedUntil <= now;
  return status === "PENDING_ACTION" || status === "FAILED";
}
