export const WATCHLIST_SORT_KEYS = [
  "NEWEST",
  "OLDEST",
  "PRIORITY",
  "TARGET_NEAREST",
] as const;

export type WatchlistSortKey = (typeof WATCHLIST_SORT_KEYS)[number];

export const WATCHLIST_SORT_LABELS: Record<WatchlistSortKey, string> = {
  NEWEST: "追加が新しい順",
  OLDEST: "追加が古い順",
  PRIORITY: "優先度順",
  TARGET_NEAREST: "目標価格に近い順",
};

export type WatchlistSortableRow = {
  id: number;
  symbol: string;
  tickerCode?: string;
  name?: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  gapPct: number | null;
  reachedTarget: boolean;
  createdAt: Date | string;
};

function normalizeWatchlistSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
}

/** 名称・正規化 symbol・表示用 ticker code の部分一致検索。 */
export function filterWatchlistRows<T extends WatchlistSortableRow>(
  rows: readonly T[],
  query: string
): T[] {
  const needle = normalizeWatchlistSearch(query);
  if (!needle) return [...rows];

  return rows.filter(row =>
    [row.name, row.symbol, row.tickerCode].some(value =>
      value ? normalizeWatchlistSearch(value).includes(needle) : false
    )
  );
}

const PRIORITY_ORDER: Record<WatchlistSortableRow["priority"], number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

function timestamp(value: Date | string): number {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(a: WatchlistSortableRow, b: WatchlistSortableRow): number {
  return timestamp(b.createdAt) - timestamp(a.createdAt) || b.id - a.id;
}

function oldestFirst(a: WatchlistSortableRow, b: WatchlistSortableRow): number {
  return timestamp(a.createdAt) - timestamp(b.createdAt) || a.id - b.id;
}

function targetDistance(row: WatchlistSortableRow): number {
  if (row.reachedTarget || (row.gapPct !== null && row.gapPct >= 0)) return 0;
  if (row.gapPct === null || !Number.isFinite(row.gapPct)) return Number.POSITIVE_INFINITY;
  return Math.abs(row.gapPct);
}

/**
 * ウォッチリストの表示順を決める純関数。
 *
 * 同じ値では追加日時と id を使うため、再描画のたびに順番が揺れない。
 * 目標価格が未設定の銘柄は「近い」とは判断せず最後に置く。
 */
export function sortWatchlistRows<T extends WatchlistSortableRow>(
  rows: readonly T[],
  key: WatchlistSortKey
): T[] {
  return [...rows].sort((a, b) => {
    if (key === "NEWEST") return newestFirst(a, b);
    if (key === "OLDEST") return oldestFirst(a, b);
    if (key === "PRIORITY") {
      return (
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        newestFirst(a, b) ||
        a.symbol.localeCompare(b.symbol)
      );
    }

    return (
      targetDistance(a) - targetDistance(b) ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      newestFirst(a, b) ||
      a.symbol.localeCompare(b.symbol)
    );
  });
}
