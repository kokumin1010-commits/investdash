/**
 * AI レポートの生成・保存・取得。
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { aiReports, type AiReport } from "../../drizzle/schema";
import { withAiRunLog } from "./aiRunLog";
import { generateWeeklyReport, REPORT_MODEL } from "./reportWriter";
import { buildDigestInput } from "./weeklyDigest";

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できません");
  return d;
}

/**
 * 週次レポートを生成して保存する。
 *
 * @param days 対象期間（日）。週次なら 7
 */
export async function createWeeklyReport(
  userId: number,
  days = 7
): Promise<{ id: number; headline: string; actionCount: number; topicCount: number }> {
  const input = await buildDigestInput(userId, days);

  const result = await withAiRunLog(
    {
      userId,
      kind: "weekly_report",
      model: REPORT_MODEL,
      summarize: r => `${r.headline.slice(0, 120)}（判断 ${r.actionCount} 件）`,
    },
    () => generateWeeklyReport(input)
  );

  const d = await requireDb();
  const res = await d.insert(aiReports).values({
    userId,
    kind: "WEEKLY",
    headline: result.headline,
    body: result.body,
    symbols: input.topics.map(t => t.symbol),
    actionCount: result.actionCount,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    model: REPORT_MODEL,
  });

  /*
   * mysql2 は [ResultSetHeader, fields] を返すため先頭要素から insertId を取る。
   * 取れない場合は保存済みの最新行を読み直す（id が NaN になると
   * 「保存できたのに開けない」状態になる）。
   */
  const header = Array.isArray(res) ? (res[0] as { insertId?: number } | undefined) : undefined;
  let id = header?.insertId ?? 0;
  if (!id) {
    const latest = await d
      .select({ id: aiReports.id })
      .from(aiReports)
      .where(and(eq(aiReports.userId, userId), eq(aiReports.kind, "WEEKLY")))
      .orderBy(desc(aiReports.id))
      .limit(1);
    id = latest[0]?.id ?? 0;
  }

  return {
    id,
    headline: result.headline,
    actionCount: result.actionCount,
    topicCount: input.topics.length,
  };
}

export type ReportListRow = Omit<AiReport, "body"> & { bodyPreview: string };

/** 一覧。本文は長いので冒頭だけ返す */
export async function listReports(
  userId: number,
  opts: { limit?: number; unreadOnly?: boolean } = {}
): Promise<ReportListRow[]> {
  const d = await requireDb();
  const conds = [eq(aiReports.userId, userId)];
  if (opts.unreadOnly) conds.push(isNull(aiReports.readAt));

  const rows = await d
    .select()
    .from(aiReports)
    .where(and(...conds))
    .orderBy(desc(aiReports.createdAt))
    .limit(opts.limit ?? 50);

  return rows.map(({ body, ...rest }) => ({
    ...rest,
    bodyPreview: body.slice(0, 200),
  }));
}

/** 1 件の詳細。開いた時点で既読にする */
export async function getReport(userId: number, id: number): Promise<AiReport | null> {
  const d = await requireDb();
  const rows = await d
    .select()
    .from(aiReports)
    .where(and(eq(aiReports.userId, userId), eq(aiReports.id, id)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  if (row.readAt === null) {
    await d.update(aiReports).set({ readAt: new Date() }).where(eq(aiReports.id, id));
  }
  return row;
}

/** 未読件数。ダッシュボードで知らせるために使う */
export async function countUnreadReports(userId: number): Promise<number> {
  const d = await requireDb();
  const rows = await d
    .select({ id: aiReports.id })
    .from(aiReports)
    .where(and(eq(aiReports.userId, userId), isNull(aiReports.readAt)));
  return rows.length;
}
