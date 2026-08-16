import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  holdings,
  importJobs,
  investmentCards,
  newsItems,
  portfolioSnapshots,
  signals,
  userSettings,
  users,
  watchlist,
  brokerBalances,
  type Holding,
  type InsertHolding,
  type InsertImportJob,
  type InsertInvestmentCard,
  type InsertNewsItem,
  type InsertSignal,
  type InsertUser,
  type InsertWatchlistItem,
  type InsertBrokerBalance,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");
  return db;
}

/**
 * INSERT の結果から採番された ID を取り出す。
 *
 * drizzle の mysql2 ドライバは環境によって `ResultSetHeader` を直接返す場合と
 * `[ResultSetHeader, FieldPacket[]]` の配列で返す場合がある。どちらでも動くよう
 * 正規化する。取得できなければ NaN を後段に流さず、その場で失敗させる。
 */
function extractInsertId(result: unknown, table: string): number {
  const header = Array.isArray(result) ? result[0] : result;
  const raw = (header as { insertId?: unknown } | null)?.insertId;
  const id = typeof raw === "bigint" ? Number(raw) : Number(raw);

  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(
      `${table} への登録で ID を取得できませんでした（受け取った値: ${String(raw)}）`
    );
  }
  return id;
}

/** テスト用エクスポート */
export const extractInsertIdForTest = extractInsertId;

/* ---------------------------------- users --------------------------------- */

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/** users.id からユーザーを取得する（パスコードセッションの解決に使う） */
export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/* -------------------------------- settings -------------------------------- */

export async function getSettings(userId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (rows.length > 0) return rows[0];

  await db.insert(userSettings).values({ userId }).onDuplicateKeyUpdate({ set: { userId } });
  const created = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  return created[0];
}

export async function updateSettings(
  userId: number,
  patch: Partial<{
    baseCurrency: string;
    usdJpyRate: string;
    sgdJpyRate: string;
    concentrationThreshold: number;
    sectorConcentrationThreshold: number;
    cashBalance: string;
    autoNewsEnabled: boolean;
    lastPriceSyncAt: Date;
    lastNewsSyncAt: Date;
    fxAutoUpdate: boolean;
    fxRateUpdatedAt: Date;
  }>
) {
  const db = await requireDb();
  await getSettings(userId);
  await db.update(userSettings).set(patch).where(eq(userSettings.userId, userId));
  return getSettings(userId);
}

/* --------------------- 口座別の残高・証拠金（信用取引） --------------------- */

/**
 * 口座別の残高情報を取得する。
 *
 * 現物取引だけの口座では不要だが、信用取引を使っている口座（IBKR）では
 * 借入額を差し引かないと総資産が過大になるため、口座単位で持つ。
 */
export async function listBrokerBalances(userId: number) {
  const db = await requireDb();
  return db.select().from(brokerBalances).where(eq(brokerBalances.userId, userId));
}

export async function getBrokerBalance(userId: number, broker: string) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(brokerBalances)
    .where(and(eq(brokerBalances.userId, userId), eq(brokerBalances.broker, broker as never)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 口座別の残高情報を保存する（同じ口座なら上書き）。
 * スクショを上げ直すたびに最新の借入額・証拠金へ更新される想定。
 */
export async function upsertBrokerBalance(data: InsertBrokerBalance): Promise<number> {
  const db = await requireDb();
  const existing = await getBrokerBalance(data.userId, data.broker);
  if (existing) {
    await db.update(brokerBalances).set(data).where(eq(brokerBalances.id, existing.id));
    return existing.id;
  }
  await db.insert(brokerBalances).values(data);
  // INSERT の戻り値から ID が取れない環境があるため、再検索して確実に取得する
  const created = await getBrokerBalance(data.userId, data.broker);
  return created?.id ?? 0;
}

export async function deleteBrokerBalance(userId: number, broker: string): Promise<boolean> {
  const db = await requireDb();
  const existing = await getBrokerBalance(userId, broker);
  if (!existing) return false;
  await db.delete(brokerBalances).where(eq(brokerBalances.id, existing.id));
  return true;
}

/* -------------------------------- holdings -------------------------------- */

export async function listHoldings(userId: number) {
  const db = await requireDb();
  return db.select().from(holdings).where(eq(holdings.userId, userId)).orderBy(holdings.symbol);
}

export async function getHolding(userId: number, id: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.id, id)))
    .limit(1);
  return rows[0];
}

export async function getHoldingBySymbol(userId: number, symbol: string) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.symbol, symbol)))
    .limit(1);
  return rows[0];
}

/**
 * 銘柄 × 証券口座で 1 件を特定する。
 *
 * 同一銘柄を複数の証券口座で保有するケース（例: ヤクルトを moomoo と楽天の
 * 両方で持つ）に対応するため、保有の一意性は「シンボル + 口座」で判断する。
 * 取込や手動追加で既存行を更新するか新規作成するかを決める際にはこちらを使う。
 */
export async function getHoldingBySymbolAndBroker(
  userId: number,
  symbol: string,
  broker: Holding["broker"]
) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(holdings)
    .where(
      and(eq(holdings.userId, userId), eq(holdings.symbol, symbol), eq(holdings.broker, broker))
    )
    .limit(1);
  return rows[0];
}

/**
 * 同一シンボルの保有をすべて返す（口座をまたぐ）。
 * 合計ポジションの算出や、削除時の関連データ整理に使う。
 */
export async function listHoldingsBySymbol(userId: number, symbol: string) {
  const db = await requireDb();
  return db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.symbol, symbol)));
}

export async function insertHolding(values: InsertHolding) {
  const db = await requireDb();
  const res = await db.insert(holdings).values(values);
  return extractInsertId(res, "holdings");
}

export async function updateHolding(
  userId: number,
  id: number,
  patch: Partial<InsertHolding>
) {
  const db = await requireDb();
  await db
    .update(holdings)
    .set(patch)
    .where(and(eq(holdings.userId, userId), eq(holdings.id, id)));
}

export async function updateHoldingBySymbol(
  userId: number,
  symbol: string,
  patch: Partial<InsertHolding>
) {
  const db = await requireDb();
  await db
    .update(holdings)
    .set(patch)
    .where(and(eq(holdings.userId, userId), eq(holdings.symbol, symbol)));
}

export async function deleteHolding(userId: number, id: number) {
  const db = await requireDb();
  const target = await getHolding(userId, id);
  await db.delete(holdings).where(and(eq(holdings.userId, userId), eq(holdings.id, id)));
  return target;
}

/* ---------------------------- investment cards ---------------------------- */

export async function getCard(userId: number, symbol: string) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(investmentCards)
    .where(and(eq(investmentCards.userId, userId), eq(investmentCards.symbol, symbol)))
    .limit(1);
  return rows[0];
}

export async function listCards(userId: number) {
  const db = await requireDb();
  return db.select().from(investmentCards).where(eq(investmentCards.userId, userId));
}

export async function upsertCard(values: InsertInvestmentCard) {
  const db = await requireDb();
  const existing = await getCard(values.userId, values.symbol);
  if (existing) {
    await db
      .update(investmentCards)
      .set(values)
      .where(eq(investmentCards.id, existing.id));
    return existing.id;
  }
  const res = await db.insert(investmentCards).values(values);
  return extractInsertId(res, "investmentCards");
}

/* ---------------------------------- news ---------------------------------- */

export async function listNews(userId: number, opts: { symbol?: string; limit?: number } = {}) {
  const db = await requireDb();
  const { symbol, limit = 60 } = opts;
  const where = symbol
    ? and(eq(newsItems.userId, userId), eq(newsItems.symbol, symbol))
    : eq(newsItems.userId, userId);
  return db
    .select()
    .from(newsItems)
    .where(where)
    .orderBy(desc(newsItems.publishedAt), desc(newsItems.id))
    .limit(limit);
}

export async function existingNewsHashes(userId: number, hashes: string[]) {
  if (hashes.length === 0) return new Set<string>();
  const db = await requireDb();
  const rows = await db
    .select({ urlHash: newsItems.urlHash })
    .from(newsItems)
    .where(and(eq(newsItems.userId, userId), inArray(newsItems.urlHash, hashes)));
  return new Set(rows.map(r => r.urlHash));
}

export async function insertNews(values: InsertNewsItem[]) {
  if (values.length === 0) return 0;
  const db = await requireDb();
  await db.insert(newsItems).values(values);
  return values.length;
}

export async function updateNewsVerdict(
  userId: number,
  urlHash: string,
  patch: {
    sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
    impactScore: number;
    summary: string;
    reasoning: string;
  }
) {
  const db = await requireDb();
  await db
    .update(newsItems)
    .set({ ...patch, analyzedAt: new Date() })
    .where(and(eq(newsItems.userId, userId), eq(newsItems.urlHash, urlHash)));
}

export async function deleteNewsForSymbol(userId: number, symbol: string) {
  const db = await requireDb();
  await db
    .delete(newsItems)
    .where(and(eq(newsItems.userId, userId), eq(newsItems.symbol, symbol)));
}

/** 古いニュースを削除して肥大化を防ぐ（既定 90 日） */
export async function pruneOldNews(userId: number, days = 90) {
  const db = await requireDb();
  await db
    .delete(newsItems)
    .where(
      and(
        eq(newsItems.userId, userId),
        sql`${newsItems.createdAt} < DATE_SUB(NOW(), INTERVAL ${days} DAY)`
      )
    );
}

/* --------------------------------- signals -------------------------------- */

export async function insertSignal(values: InsertSignal) {
  const db = await requireDb();
  const res = await db.insert(signals).values(values);
  return extractInsertId(res, "signals");
}

/** 各銘柄の最新シグナルのみを返す */
export async function latestSignals(userId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(signals)
    .where(eq(signals.userId, userId))
    .orderBy(desc(signals.createdAt), desc(signals.id));

  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!map.has(r.symbol)) map.set(r.symbol, r);
  }
  return map;
}

export async function signalHistory(userId: number, symbol: string, limit = 20) {
  const db = await requireDb();
  return db
    .select()
    .from(signals)
    .where(and(eq(signals.userId, userId), eq(signals.symbol, symbol)))
    .orderBy(desc(signals.createdAt), desc(signals.id))
    .limit(limit);
}

/* -------------------------------- watchlist ------------------------------- */

export async function listWatchlist(userId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(watchlist)
    .where(eq(watchlist.userId, userId))
    .orderBy(watchlist.priority, watchlist.symbol);
}

export async function getWatchItem(userId: number, id: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(watchlist)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.id, id)))
    .limit(1);
  return rows[0];
}

export async function getWatchBySymbol(userId: number, symbol: string) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(watchlist)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.symbol, symbol)))
    .limit(1);
  return rows[0];
}

export async function insertWatchItem(values: InsertWatchlistItem) {
  const db = await requireDb();
  const res = await db.insert(watchlist).values(values);
  return extractInsertId(res, "watchlist");
}

export async function updateWatchItem(
  userId: number,
  id: number,
  patch: Partial<InsertWatchlistItem>
) {
  const db = await requireDb();
  await db
    .update(watchlist)
    .set(patch)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.id, id)));
}

export async function deleteWatchItem(userId: number, id: number) {
  const db = await requireDb();
  const target = await getWatchItem(userId, id);
  await db.delete(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.id, id)));
  return target;
}

/* ------------------------------- import jobs ------------------------------ */

export async function createImportJob(values: InsertImportJob) {
  const db = await requireDb();
  const res = await db.insert(importJobs).values(values);
  return extractInsertId(res, "importJobs");
}

export async function getImportJob(userId: number, id: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), eq(importJobs.id, id)))
    .limit(1);
  return rows[0];
}

export async function updateImportJob(
  userId: number,
  id: number,
  patch: Partial<InsertImportJob>
) {
  const db = await requireDb();
  await db
    .update(importJobs)
    .set(patch)
    .where(and(eq(importJobs.userId, userId), eq(importJobs.id, id)));
}

export async function listImportJobs(userId: number, limit = 10) {
  const db = await requireDb();
  return db
    .select()
    .from(importJobs)
    .where(eq(importJobs.userId, userId))
    .orderBy(desc(importJobs.createdAt))
    .limit(limit);
}

/* ------------------------------- snapshots -------------------------------- */

export async function insertSnapshot(values: {
  userId: number;
  totalValue: string;
  totalCost: string;
  positionCount: number;
}) {
  const db = await requireDb();
  await db.insert(portfolioSnapshots).values(values);
}

export async function listSnapshots(userId: number, limit = 90) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.capturedAt))
    .limit(limit);
  return rows.reverse();
}

/** 全ユーザーの ID を取得（定期ジョブ用） */
export async function listAllUserIds() {
  const db = await requireDb();
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map(r => r.id);
}
