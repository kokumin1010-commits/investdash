import { and, desc, eq, inArray, lte, or } from "drizzle-orm";
import {
  actionQueueItems,
  type ActionQueueItem,
  type InsertActionQueueItem,
} from "../../drizzle/schema";
import {
  ACTIVE_ACTION_QUEUE_STATUSES,
  isPendingActionStatus,
  nextActionQueueStatus,
  type ActionQueueDecision,
  type ActionQueueStatus,
} from "../../shared/actionQueue";
import { getDb } from "../db";
import * as dbq from "../db";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できませんでした");
  return db;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type ActionQueueView = Omit<
  ActionQueueItem,
  | "currentQuantity"
  | "currentPrice"
  | "currentValueBase"
  | "currentWeightPct"
  | "recommendedShares"
  | "recommendedAmountLocal"
  | "recommendedAmountBase"
  | "afterQuantity"
  | "afterWeightPct"
> & {
  currentQuantity: number | null;
  currentPrice: number | null;
  currentValueBase: number | null;
  currentWeightPct: number | null;
  recommendedShares: number | null;
  recommendedAmountLocal: number | null;
  recommendedAmountBase: number | null;
  afterQuantity: number | null;
  afterWeightPct: number | null;
  pending: boolean;
};

function toView(row: ActionQueueItem, now = new Date()): ActionQueueView {
  return {
    ...row,
    currentQuantity: num(row.currentQuantity),
    currentPrice: num(row.currentPrice),
    currentValueBase: num(row.currentValueBase),
    currentWeightPct: num(row.currentWeightPct),
    recommendedShares: num(row.recommendedShares),
    recommendedAmountLocal: num(row.recommendedAmountLocal),
    recommendedAmountBase: num(row.recommendedAmountBase),
    afterQuantity: num(row.afterQuantity),
    afterWeightPct: num(row.afterWeightPct),
    pending: isPendingActionStatus(row.status, now, row.snoozedUntil),
  };
}

/**
 * 同じ trigger は 1 行、同じ symbol の未判断イベントも 1 行にまとめる。
 * 承認・見送り・完了済みの履歴は上書きしない。
 */
export async function upsertActionQueueItem(
  values: InsertActionQueueItem
): Promise<number> {
  const db = await requireDb();
  const sameTrigger = await db
    .select()
    .from(actionQueueItems)
    .where(
      and(
        eq(actionQueueItems.userId, values.userId),
        eq(actionQueueItems.triggerKey, values.triggerKey)
      )
    )
    .limit(1);
  if (sameTrigger[0]) {
    await db
      .update(actionQueueItems)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(actionQueueItems.id, sameTrigger[0].id));
    return sameTrigger[0].id;
  }

  const active = await db
    .select()
    .from(actionQueueItems)
    .where(
      and(
        eq(actionQueueItems.userId, values.userId),
        eq(actionQueueItems.symbol, values.symbol),
        inArray(actionQueueItems.status, [
          "WAITING_MATERIAL",
          "REANALYZING",
          "PENDING_ACTION",
          "SNOOZED",
          "FAILED",
        ])
      )
    )
    .orderBy(desc(actionQueueItems.updatedAt), desc(actionQueueItems.id))
    .limit(1);
  if (active[0]) {
    await db
      .update(actionQueueItems)
      .set({
        ...values,
        triggerKey: active[0].triggerKey,
        updatedAt: new Date(),
      })
      .where(eq(actionQueueItems.id, active[0].id));
    return active[0].id;
  }

  const result = await db.insert(actionQueueItems).values(values);
  const insertId = Number(
    (result as unknown as [{ insertId?: number }])?.[0]?.insertId ??
      (result as unknown as { insertId?: number }).insertId
  );
  if (!Number.isFinite(insertId))
    throw new Error("アクション待ちの保存 ID を取得できませんでした");
  return insertId;
}

export async function listActionQueue(
  userId: number,
  options: {
    view?: "ACTIVE" | "PENDING" | "APPROVED" | "HISTORY" | "ALL";
    limit?: number;
    now?: Date;
  } = {}
): Promise<ActionQueueView[]> {
  const db = await requireDb();
  const now = options.now ?? new Date();
  const view = options.view ?? "ACTIVE";
  let statuses: ActionQueueStatus[] | null;
  if (view === "PENDING")
    statuses = ["PENDING_ACTION", "SNOOZED", "FAILED", "REANALYZING"];
  else if (view === "APPROVED") statuses = ["APPROVED"];
  else if (view === "HISTORY") statuses = ["SKIPPED", "COMPLETED"];
  else if (view === "ALL") statuses = null;
  else statuses = ACTIVE_ACTION_QUEUE_STATUSES;

  const where = statuses
    ? and(
        eq(actionQueueItems.userId, userId),
        inArray(actionQueueItems.status, statuses)
      )
    : eq(actionQueueItems.userId, userId);
  const rows = await db
    .select()
    .from(actionQueueItems)
    .where(where)
    .orderBy(
      desc(actionQueueItems.priority),
      actionQueueItems.deadline,
      desc(actionQueueItems.updatedAt)
    )
    .limit(Math.min(200, Math.max(1, options.limit ?? 100)));
  return rows.map(row => toView(row, now));
}

export async function actionQueueSummary(userId: number, now = new Date()) {
  const rows = await listActionQueue(userId, { view: "ALL", limit: 200, now });
  const active = rows.filter(row =>
    ACTIVE_ACTION_QUEUE_STATUSES.includes(row.status)
  );
  return {
    pending: active.filter(row => row.pending).length,
    approved: active.filter(row => row.status === "APPROVED").length,
    snoozed: active.filter(
      row =>
        row.status === "SNOOZED" && row.snoozedUntil && row.snoozedUntil > now
    ).length,
    reviewing: active.filter(
      row => row.status === "REANALYZING" || row.status === "WAITING_MATERIAL"
    ).length,
    failed: active.filter(row => row.status === "FAILED").length,
    urgent: active.filter(
      row =>
        row.pending &&
        row.deadline &&
        row.deadline.getTime() - now.getTime() <= 48 * 3600_000
    ).length,
    top: active.filter(row => row.pending).slice(0, 5),
  };
}

export async function decideActionQueueItem(input: {
  userId: number;
  id: number;
  decision: ActionQueueDecision;
  snoozeDays?: 1 | 3 | 7;
  note?: string | null;
}): Promise<ActionQueueView> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(actionQueueItems)
    .where(
      and(
        eq(actionQueueItems.userId, input.userId),
        eq(actionQueueItems.id, input.id)
      )
    )
    .limit(1);
  const current = rows[0];
  if (!current) throw new Error("アクション待ちが見つかりませんでした");
  const status = nextActionQueueStatus(current.status, input.decision);
  if (!status) throw new Error("現在の状態ではこの操作を実行できません");

  const now = new Date();
  const snoozedUntil =
    input.decision === "SNOOZE"
      ? new Date(now.getTime() + (input.snoozeDays ?? 3) * 24 * 3600_000)
      : status === "PENDING_ACTION"
        ? null
        : current.snoozedUntil;
  await db
    .update(actionQueueItems)
    .set({
      status,
      decisionNote: input.note?.trim() || current.decisionNote,
      snoozedUntil,
      approvedAt: status === "APPROVED" ? now : current.approvedAt,
      skippedAt: status === "SKIPPED" ? now : current.skippedAt,
      completedAt: status === "COMPLETED" ? now : current.completedAt,
      updatedAt: now,
    })
    .where(eq(actionQueueItems.id, current.id));
  const updated = await db
    .select()
    .from(actionQueueItems)
    .where(eq(actionQueueItems.id, current.id))
    .limit(1);
  return toView(updated[0], now);
}

/** 保有数量の変化だけを見て、承認済み提案が実行されたかを照合する。 */
export async function reconcileApprovedActionQueue(userId: number) {
  const db = await requireDb();
  const [approved, holdings] = await Promise.all([
    db
      .select()
      .from(actionQueueItems)
      .where(
        and(
          eq(actionQueueItems.userId, userId),
          eq(actionQueueItems.status, "APPROVED")
        )
      ),
    dbq.listHoldings(userId),
  ]);
  const quantityBySymbol = new Map<string, number>();
  for (const holding of holdings) {
    quantityBySymbol.set(
      holding.symbol,
      (quantityBySymbol.get(holding.symbol) ?? 0) + Number(holding.quantity)
    );
  }
  let completed = 0;
  const details: Array<{
    id: number;
    symbol: string;
    before: number;
    after: number;
  }> = [];
  for (const item of approved) {
    const before = num(item.currentQuantity) ?? 0;
    const after = quantityBySymbol.get(item.symbol) ?? 0;
    const executed =
      (item.direction === "BUY" && after > before + 0.0001) ||
      ((item.direction === "SELL" || item.direction === "EXIT") &&
        after < before - 0.0001);
    if (!executed) continue;
    await db
      .update(actionQueueItems)
      .set({
        status: "COMPLETED",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(actionQueueItems.id, item.id));
    completed += 1;
    details.push({ id: item.id, symbol: item.symbol, before, after });
  }
  return { checked: approved.length, completed, details };
}

export async function wakeSnoozedActionQueue(userId: number, now = new Date()) {
  const db = await requireDb();
  await db
    .update(actionQueueItems)
    .set({ status: "PENDING_ACTION", snoozedUntil: null, updatedAt: now })
    .where(
      and(
        eq(actionQueueItems.userId, userId),
        eq(actionQueueItems.status, "SNOOZED"),
        or(
          lte(actionQueueItems.snoozedUntil, now),
          eq(actionQueueItems.snoozedUntil, now)
        )
      )
    );
}
