const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本时间的日历日键，例如 2026-08-26。 */
export function jstDayKey(date: Date): string {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 指定时刻所属的日本日历日を UTC の半開区間 [start, end) で返す。
 * MySQL timestamp は UTC の Date として比較し、サーバーのローカル TZ に依存しない。
 */
export function jstDayBounds(date: Date): { start: Date; end: Date } {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  const start = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - JST_OFFSET_MS
  );
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}
