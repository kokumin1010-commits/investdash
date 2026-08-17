import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { aiRunLogs, type AiRunLog } from "../../drizzle/schema";

/**
 * AI 実行履歴の記録。
 *
 * 過去に「いつ何をどう判断したのか」を後から追えず、
 * 提案が古いのか新しいのかも分からない状態になっていた。
 * AI を呼ぶ処理はすべてここを通し、成功・失敗の両方を残す。
 *
 * 記録の失敗が本体の処理を止めてはいけないので、例外は握って警告だけ出す。
 */

export type AiRunKind =
  | "price_band_plan"
  | "band_check"
  | "signal"
  | "watch_signal"
  | "news_analysis"
  | "candidate_suggestion"
  | "ocr";

export async function logAiRun(params: {
  userId: number;
  kind: AiRunKind;
  symbol?: string | null;
  model?: string | null;
  status: "SUCCESS" | "FAILED";
  durationMs?: number | null;
  detail?: string | null;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(aiRunLogs).values({
      userId: params.userId,
      kind: params.kind,
      symbol: params.symbol ?? null,
      model: params.model ?? null,
      status: params.status,
      durationMs: params.durationMs ?? null,
      // 長いエラーメッセージで行が膨らむのを防ぐ
      detail: params.detail ? params.detail.slice(0, 2000) : null,
    });
  } catch (error) {
    console.warn("[aiRunLog] 記録に失敗:", error);
  }
}

/**
 * 実行履歴を新しい順に取得する。
 * 「この提案はいつ作られたものか」「失敗が続いていないか」を確認するために使う。
 */
export async function listAiRuns(
  userId: number,
  opts: { kind?: string; limit?: number } = {}
): Promise<AiRunLog[]> {
  const db = await getDb();
  if (!db) return [];
  const where = opts.kind
    ? and(eq(aiRunLogs.userId, userId), eq(aiRunLogs.kind, opts.kind))
    : eq(aiRunLogs.userId, userId);
  return await db
    .select()
    .from(aiRunLogs)
    .where(where)
    .orderBy(desc(aiRunLogs.createdAt))
    .limit(opts.limit ?? 50);
}

/**
 * AI 呼び出しを履歴付きで実行する。
 *
 * 呼び出し側が try/catch と時間計測を毎回書かなくて済むようにする。
 * 失敗しても履歴を残したうえで例外はそのまま投げ直す（呼び出し側で扱うため）。
 */
export async function withAiRunLog<T>(
  params: {
    userId: number;
    kind: AiRunKind;
    symbol?: string | null;
    model?: string | null;
    /** 成功時の要約を作る。結果の中身をそのまま残すと肥大するため短くまとめる */
    summarize?: (result: T) => string;
  },
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await logAiRun({
      ...params,
      status: "SUCCESS",
      durationMs: Date.now() - startedAt,
      detail: params.summarize ? params.summarize(result) : null,
    });
    return result;
  } catch (error) {
    await logAiRun({
      ...params,
      status: "FAILED",
      durationMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
