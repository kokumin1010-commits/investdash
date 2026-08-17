/**
 * 買い増しプランの判定が変わった履歴を記録・取得する。
 *
 * 株価更新のたびに全銘柄の判定を計算し、前回と違うときだけ 1 行足す。
 * 月 1 回しか画面を開かない使い方でも「その間に買い増し圏に入って
 * 戻った」ことに後から気付けるようにするのが目的。
 */
import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { getDb } from "../db";
import { bandTransitions } from "../../drizzle/schema";
import {
  classifyTransition,
  describeTransition,
  hasStateChanged,
  type BandState,
  type TransitionImportance,
} from "../../shared/bandTransition";
import type { BandAction } from "../../shared/priceBands";
import { listPlanOverview } from "./priceBandService";

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できません");
  return d;
}

export type TransitionRow = {
  id: number;
  symbol: string;
  name: string;
  fromAction: BandAction | null;
  fromLabel: string | null;
  toAction: BandAction | null;
  toLabel: string | null;
  outsideDirection: "ABOVE" | "BELOW" | null;
  price: number | null;
  currency: string | null;
  priceChangePct: number | null;
  /** 人が読める 1 行の説明 */
  description: string;
  importance: TransitionImportance;
  acknowledgedAt: Date | null;
  createdAt: Date;
};

/**
 * 全銘柄の判定を今の株価で計算し、前回と違うものだけ記録する。
 *
 * 株価更新の直後に呼ぶ。戻り値は記録した件数と内容の要約。
 */
export async function recordTransitions(userId: number): Promise<{
  checked: number;
  recorded: number;
  highCount: number;
  changes: { symbol: string; description: string; importance: TransitionImportance }[];
}> {
  const d = await requireDb();
  const overview = await listPlanOverview(userId);
  if (overview.length === 0) {
    return { checked: 0, recorded: 0, highCount: 0, changes: [] };
  }

  /*
   * 各銘柄の最後の記録を 1 回のクエリで引く。
   * 銘柄ごとに問い合わせると 112 回になり、株価更新の処理が長引く。
   */
  const symbols = overview.map(o => o.symbol);
  const previous = await d
    .select()
    .from(bandTransitions)
    .where(and(eq(bandTransitions.userId, userId), inArray(bandTransitions.symbol, symbols)))
    .orderBy(desc(bandTransitions.createdAt));

  // 同じ銘柄が複数あるので、最初に見つかったもの（＝最新）だけを採る
  const lastBySymbol = new Map<string, (typeof previous)[number]>();
  for (const row of previous) {
    if (!lastBySymbol.has(row.symbol)) lastBySymbol.set(row.symbol, row);
  }

  const toInsert: (typeof bandTransitions.$inferInsert)[] = [];
  const changes: { symbol: string; description: string; importance: TransitionImportance }[] = [];
  let highCount = 0;

  for (const row of overview) {
    const last = lastBySymbol.get(row.symbol) ?? null;
    const prev: BandState | null = last
      ? {
          action: last.toAction,
          label: last.toLabel,
          outsideDirection: last.outsideDirection,
        }
      : null;
    const next: BandState = {
      action: row.action,
      label: row.actionLabel,
      outsideDirection: row.outsideDirection,
    };

    if (!hasStateChanged(prev, next)) continue;

    /*
     * 前回記録時の株価からの変化率。
     * 「どれだけ動いて判定が変わったか」が分かる。
     * どちらかの株価が無い場合は出さない（0% と混同しないため）。
     */
    const lastPrice = last?.price === null || last?.price === undefined ? null : Number(last.price);
    const priceChangePct =
      lastPrice !== null && lastPrice > 0 && row.currentPrice !== null
        ? ((row.currentPrice - lastPrice) / lastPrice) * 100
        : null;

    const importance = classifyTransition(prev, next);
    if (importance === "HIGH") highCount += 1;

    toInsert.push({
      userId,
      symbol: row.symbol,
      fromAction: prev?.action ?? null,
      fromLabel: prev?.label ?? null,
      toAction: next.action,
      toLabel: next.label,
      outsideDirection: next.outsideDirection,
      price: row.currentPrice === null ? null : row.currentPrice.toFixed(4),
      currency: row.currency,
      priceChangePct: priceChangePct === null ? null : priceChangePct.toFixed(4),
    });
    changes.push({
      symbol: row.symbol,
      description: describeTransition(prev, next),
      importance,
    });
  }

  if (toInsert.length > 0) {
    // 1 回の insert でまとめる（112 銘柄が初回で全件変化するため）
    await d.insert(bandTransitions).values(toInsert);
  }

  return {
    checked: overview.length,
    recorded: toInsert.length,
    highCount,
    changes,
  };
}

/**
 * 判定変化の履歴を新しい順に取得する。
 *
 * @param symbol 指定すればその銘柄だけ
 * @param onlyUnacknowledged 未確認のものだけ
 */
export async function listTransitions(
  userId: number,
  opts: { symbol?: string; onlyUnacknowledged?: boolean; limit?: number } = {},
): Promise<TransitionRow[]> {
  const d = await requireDb();
  const conds = [eq(bandTransitions.userId, userId)];
  if (opts.symbol) conds.push(eq(bandTransitions.symbol, opts.symbol));
  if (opts.onlyUnacknowledged) conds.push(isNull(bandTransitions.acknowledgedAt));

  const rows = await d
    .select()
    .from(bandTransitions)
    .where(and(...conds))
    .orderBy(desc(bandTransitions.createdAt))
    .limit(opts.limit ?? 100);

  /*
   * 銘柄名は保有側から引く。履歴に名前を複製して持つと、
   * 銘柄名の表記を直したときに古い行だけ旧表記のまま残る。
   */
  const holdings = await (await import("../db")).listHoldings(userId);
  const nameBySymbol = new Map<string, string>();
  for (const h of holdings) {
    if (!nameBySymbol.has(h.symbol)) nameBySymbol.set(h.symbol, h.name);
  }

  return rows.map(r => {
    const prev: BandState | null =
      r.fromAction === null && r.fromLabel === null
        ? null
        : { action: r.fromAction, label: r.fromLabel, outsideDirection: null };
    const next: BandState = {
      action: r.toAction,
      label: r.toLabel,
      outsideDirection: r.outsideDirection,
    };
    return {
      id: r.id,
      symbol: r.symbol,
      name: nameBySymbol.get(r.symbol) ?? r.symbol,
      fromAction: r.fromAction,
      fromLabel: r.fromLabel,
      toAction: r.toAction,
      toLabel: r.toLabel,
      outsideDirection: r.outsideDirection,
      price: r.price === null ? null : Number(r.price),
      currency: r.currency,
      priceChangePct: r.priceChangePct === null ? null : Number(r.priceChangePct),
      description: describeTransition(prev, next),
      importance: classifyTransition(prev, next),
      acknowledgedAt: r.acknowledgedAt,
      createdAt: r.createdAt,
    };
  });
}

/**
 * 変化を確認済みにする。
 *
 * id を渡さなければ、その時点までの未確認をまとめて確認済みにする
 * （「全部見た」を 1 回で押せるように）。
 */
export async function acknowledgeTransitions(
  userId: number,
  opts: { ids?: number[]; until?: Date } = {},
): Promise<{ updated: number }> {
  const d = await requireDb();
  const conds = [eq(bandTransitions.userId, userId), isNull(bandTransitions.acknowledgedAt)];
  if (opts.ids?.length) conds.push(inArray(bandTransitions.id, opts.ids));
  if (opts.until) conds.push(lte(bandTransitions.createdAt, opts.until));

  const res = await d
    .update(bandTransitions)
    .set({ acknowledgedAt: new Date() })
    .where(and(...conds));
  /*
   * mysql2 は [ResultSetHeader, fields] を返すため先頭要素から件数を取る。
   * 取れない場合は 0 を返す（件数が分からないことを成功と混同しない）。
   */
  const header = Array.isArray(res) ? (res[0] as { affectedRows?: number } | undefined) : undefined;
  return { updated: header?.affectedRows ?? 0 };
}
