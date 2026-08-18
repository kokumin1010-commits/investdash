/**
 * 月ごとの保有記録（スナップショット）の保存と読み出し。
 *
 * 保有テーブルは「今の状態」しか持たないため、毎月スクショを取り込むと
 * 前月の状態が上書きされて消える。売った銘柄は行ごと消え、買い増した銘柄は
 * 株数が置き換わる。この状態では「7 月から 8 月で資産がいくら増えたか」も
 * 「その増加が値上がりか買い増しか」も後から追えない。
 *
 * 日次の総額記録（portfolioSnapshots）とは役割が異なるため分けている。
 * 日次は総額だけで明細を持たず、明細を持たせると 112 銘柄 × 日数で
 * 数万行になるうえ、日々変わるのは株価だけで売買はほとんど起きない。
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, readInsertId } from "../db";
import { monthlyHoldings, monthlySnapshots } from "../../drizzle/schema";
import { buildPortfolio } from "./portfolio";
import {
  breakdownMonthlyChange,
  diffMonthlyHoldings,
  periodYmOf,
  previousPeriodYm,
  type MonthlyDiffRow,
  type MonthlyHoldingRow,
} from "../../shared/monthlyDiff";

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できませんでした");
  return d;
}

export type SaveSnapshotResult = {
  periodYm: string;
  recordCount: number;
  symbolCount: number;
  totalValueJpy: number;
  replaced: boolean;
};

/**
 * 現在の保有状態を指定月の記録として保存する。
 *
 * 同じ月に 2 回記録した場合は上書きする。月内に複数回スクショを送ることが
 * あり、追記すると同じ月に 2 つの記録が並んで差分の基準が定まらなくなる。
 * 月末に近い記録の方が実態に近いため、後から来たものを採用する。
 */
export async function saveMonthlySnapshot(
  userId: number,
  opts: { periodYm?: string; source?: string; note?: string } = {}
): Promise<SaveSnapshotResult> {
  const db = await requireDb();
  const periodYm = opts.periodYm ?? periodYmOf(new Date());

  const portfolio = await buildPortfolio(userId);
  const positions = portfolio.positions;
  const summary = portfolio.summary;

  const existing = await db
    .select({ id: monthlySnapshots.id })
    .from(monthlySnapshots)
    .where(and(eq(monthlySnapshots.userId, userId), eq(monthlySnapshots.periodYm, periodYm)))
    .limit(1);

  const replaced = existing.length > 0;
  if (replaced) {
    // 明細を先に消す。スナップショットだけ消すと明細が孤児として残り、
    // 次回の差分計算で二重に数えられる。
    await db.delete(monthlyHoldings).where(
      and(eq(monthlyHoldings.userId, userId), eq(monthlyHoldings.periodYm, periodYm))
    );
    await db.delete(monthlySnapshots).where(eq(monthlySnapshots.id, existing[0].id));
  }

  const symbolSet = new Set(positions.map(p => p.symbol));
  const inserted = await db.insert(monthlySnapshots).values({
    userId,
    periodYm,
    totalValueJpy: String(summary.totalValueBase ?? 0),
    totalCostJpy: String(summary.totalCostBase ?? 0),
    borrowedJpy: String(summary.totalBorrowedBase ?? 0),
    cashJpy: summary.interestAssetsBase !== null ? String(summary.interestAssetsBase) : null,
    netAssetsJpy: summary.netAssetsBase !== null ? String(summary.netAssetsBase) : null,
    symbolCount: symbolSet.size,
    recordCount: positions.length,
    annualDividendJpy:
      portfolio.dividends?.annualIncomeBase !== null &&
      portfolio.dividends?.annualIncomeBase !== undefined
        ? String(portfolio.dividends.annualIncomeBase)
        : null,
    usdJpy: String(summary.usdJpyRate),
    sgdJpy: String(summary.sgdJpyRate),
    hkdJpy: String(summary.hkdJpyRate),
    source: opts.source ?? "import",
    note: opts.note ?? null,
  });

  // ドライバの戻りは環境によって [ResultSetHeader, fields] か ResultSetHeader。
  // 直接 .insertId を読むと配列で返る環境で NaN になり、明細の登録が全滅する。
  const snapshotId = readInsertId(inserted, "monthlySnapshots");

  if (positions.length > 0) {
    await db.insert(monthlyHoldings).values(
      positions.map(p => ({
        snapshotId,
        userId,
        periodYm,
        symbol: p.symbol,
        name: p.name,
        market: p.market,
        currency: p.currency,
        broker: p.broker,
        quantity: String(p.quantity),
        avgCost: String(p.avgCost),
        price: p.currentPrice !== null ? String(p.currentPrice) : null,
        valueJpy: p.marketValueBase !== null ? String(p.marketValueBase) : null,
        sector: p.sector ?? null,
      }))
    );
  }

  return {
    periodYm,
    recordCount: positions.length,
    symbolCount: symbolSet.size,
    totalValueJpy: summary.totalValueBase ?? 0,
    replaced,
  };
}

export type MonthlySnapshotRow = {
  periodYm: string;
  totalValueJpy: number;
  totalCostJpy: number;
  borrowedJpy: number | null;
  cashJpy: number | null;
  netAssetsJpy: number | null;
  symbolCount: number;
  recordCount: number;
  annualDividendJpy: number | null;
  usdJpy: number | null;
  capturedAt: Date;
  source: string;
};

/** 記録された月の一覧を新しい順に返す。 */
export async function listMonthlySnapshots(
  userId: number,
  limit = 24
): Promise<MonthlySnapshotRow[]> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(monthlySnapshots)
    .where(eq(monthlySnapshots.userId, userId))
    .orderBy(desc(monthlySnapshots.periodYm))
    .limit(limit);

  return rows.map((r: typeof monthlySnapshots.$inferSelect) => ({
    periodYm: r.periodYm,
    totalValueJpy: num(r.totalValueJpy) ?? 0,
    totalCostJpy: num(r.totalCostJpy) ?? 0,
    borrowedJpy: num(r.borrowedJpy),
    cashJpy: num(r.cashJpy),
    netAssetsJpy: num(r.netAssetsJpy),
    symbolCount: r.symbolCount,
    recordCount: r.recordCount,
    annualDividendJpy: num(r.annualDividendJpy),
    usdJpy: num(r.usdJpy),
    capturedAt: r.capturedAt,
    source: r.source,
  }));
}

async function loadHoldings(userId: number, periodYm: string): Promise<MonthlyHoldingRow[]> {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(monthlyHoldings)
    .where(and(eq(monthlyHoldings.userId, userId), eq(monthlyHoldings.periodYm, periodYm)));
  return rows.map((r: typeof monthlyHoldings.$inferSelect) => ({
    symbol: r.symbol,
    name: r.name,
    broker: r.broker,
    quantity: num(r.quantity) ?? 0,
    avgCost: num(r.avgCost) ?? 0,
    price: num(r.price),
    valueJpy: num(r.valueJpy),
  }));
}

export type MonthlyComparison = {
  fromPeriod: string;
  toPeriod: string;
  /** 差分の明細（変化のあったものが先） */
  rows: MonthlyDiffRow[];
  /** 評価額の変化を売買と値動きに分けた内訳 */
  breakdown: ReturnType<typeof breakdownMonthlyChange>;
  /** 記録に残っている総額の変化 */
  totals: {
    fromValueJpy: number;
    toValueJpy: number;
    fromNetJpy: number | null;
    toNetJpy: number | null;
    fromUsdJpy: number | null;
    toUsdJpy: number | null;
  } | null;
};

/**
 * 2 つの月を比べる。
 *
 * 比べる相手を指定しない場合は「1 つ前に記録がある月」を使う。
 * 単純に前月を見ると、記録を飛ばした月があったときに比較が成立しない。
 */
export async function compareMonths(
  userId: number,
  toPeriod: string,
  fromPeriod?: string
): Promise<MonthlyComparison | null> {
  const snaps = await listMonthlySnapshots(userId, 36);
  const to = snaps.find(s => s.periodYm === toPeriod);
  if (!to) return null;

  let from: MonthlySnapshotRow | undefined;
  if (fromPeriod) {
    from = snaps.find(s => s.periodYm === fromPeriod);
  } else {
    // 対象月より前で最も新しい記録
    from = snaps.find(s => s.periodYm < toPeriod);
  }
  if (!from) return null;

  const [prevRows, currRows] = await Promise.all([
    loadHoldings(userId, from.periodYm),
    loadHoldings(userId, to.periodYm),
  ]);

  const rows = diffMonthlyHoldings(prevRows, currRows);
  return {
    fromPeriod: from.periodYm,
    toPeriod: to.periodYm,
    rows,
    breakdown: breakdownMonthlyChange(rows),
    totals: {
      fromValueJpy: from.totalValueJpy,
      toValueJpy: to.totalValueJpy,
      fromNetJpy: from.netAssetsJpy,
      toNetJpy: to.netAssetsJpy,
      fromUsdJpy: from.usdJpy,
      toUsdJpy: to.usdJpy,
    },
  };
}

/** 直近の記録月とその 1 つ前を比べる（画面の既定表示用）。 */
export async function compareLatestMonths(userId: number): Promise<MonthlyComparison | null> {
  const snaps = await listMonthlySnapshots(userId, 2);
  if (snaps.length < 2) return null;
  return compareMonths(userId, snaps[0].periodYm, snaps[1].periodYm);
}

/** 指定月の記録を削除する（誤って作った記録を消すため）。 */
export async function deleteMonthlySnapshot(userId: number, periodYm: string): Promise<boolean> {
  const db = await requireDb();
  const existing = await db
    .select({ id: monthlySnapshots.id })
    .from(monthlySnapshots)
    .where(and(eq(monthlySnapshots.userId, userId), eq(monthlySnapshots.periodYm, periodYm)))
    .limit(1);
  if (existing.length === 0) return false;
  await db.delete(monthlyHoldings).where(
    and(eq(monthlyHoldings.userId, userId), eq(monthlyHoldings.periodYm, periodYm))
  );
  await db.delete(monthlySnapshots).where(eq(monthlySnapshots.id, existing[0].id));
  return true;
}

export { previousPeriodYm, periodYmOf, inArray };
