/**
 * 株価データの鮮度判定。
 *
 * 【なぜ必要か】
 * 株価の自動更新は動いているが、112 銘柄のうち 1〜2 銘柄が静かに
 * 失敗しても誰も気付けない。古い株価で買い増し圏を判定すると、
 * 実際には圏外なのに「買い場」と出る。判断を誤らせる方向の不具合なので、
 * 古くなっていることを自分から知らせる必要がある。
 *
 * 【市場ごとに基準を変える】
 * 「24 時間以上前なら古い」という一律の基準は使えない。
 * 週末は 3 日更新されないのが正常で、一律の基準だと毎週末に
 * 112 銘柄すべてが「古い」と警告される。それでは警告を見なくなる。
 *
 * 営業日の数で数える。市場ごとの休場日までは持たないが、
 * 土日を除くだけで週末の誤検知はなくなる。祝日で 1 日ずれる程度は
 * 「注意」の域に収まるよう閾値に余裕を持たせる。
 */

export type FreshnessLevel = "FRESH" | "STALE" | "MISSING";

export type FreshnessResult = {
  level: FreshnessLevel;
  /** 最終更新からの経過時間（時間）。未取得なら null */
  hoursAgo: number | null;
  /** 経過した営業日数（土日を除く）。未取得なら null */
  businessDaysAgo: number | null;
  /** 画面に出す説明 */
  label: string;
};

/**
 * 「古い」と判定する営業日数。
 *
 * 1 営業日では厳しすぎる。株価更新は日本市場 15:30・米国市場 翌 6:30 に
 * 走るため、見る時刻によっては正常でも 1 営業日を超える。
 * 2 営業日更新されていなければ何かが失敗している。
 */
export const STALE_BUSINESS_DAYS = 2;

/**
 * 土日を除いた経過日数。
 *
 * 日付の切り替わりは JST で数える。サーバーは UTC で動くため
 * ローカル時刻で数えると JST の朝が前日扱いになり、
 * 「6:30 に更新した株価」が 1 日古く見える。
 * 保有は 4 市場にまたがるが、判断するのは日本にいる本人なので
 * JST を基準にする。
 */
const JST_OFFSET_MS = 9 * 3600_000;

/** JST での暦日（1970-01-01 からの日数）と曜日を返す */
function jstDayInfo(d: Date): { dayNumber: number; dow: number } {
  const shifted = d.getTime() + JST_OFFSET_MS;
  const dayNumber = Math.floor(shifted / 86_400_000);
  // 1970-01-01 は木曜（getUTCDay = 4）
  const dow = (((dayNumber + 4) % 7) + 7) % 7;
  return { dayNumber, dow };
}

export function countBusinessDays(from: Date, to: Date): number {
  const a = jstDayInfo(from);
  const b = jstDayInfo(to);
  if (b.dayNumber <= a.dayNumber) return 0;
  let days = 0;
  for (let n = a.dayNumber + 1; n <= b.dayNumber; n += 1) {
    const dow = (((n + 4) % 7) + 7) % 7;
    if (dow !== 0 && dow !== 6) days += 1;
  }
  return days;
}

/**
 * 1 銘柄の鮮度を判定する。
 *
 * 株価そのものが無い場合は「取得できていない」として別扱いにする。
 * 古いのと無いのは対処が違う（無い場合は銘柄コードが誤っている
 * 可能性があり、更新を待っても解決しない）。
 */
export function judgeFreshness(
  price: number | null,
  updatedAt: Date | null,
  now: Date = new Date()
): FreshnessResult {
  if (price === null || updatedAt === null) {
    return {
      level: "MISSING",
      hoursAgo: null,
      businessDaysAgo: null,
      label: price === null ? "株価を取得できていません" : "更新時刻が記録されていません",
    };
  }

  const hoursAgo = (now.getTime() - updatedAt.getTime()) / 3600_000;
  const businessDaysAgo = countBusinessDays(updatedAt, now);

  if (businessDaysAgo >= STALE_BUSINESS_DAYS) {
    return {
      level: "STALE",
      hoursAgo,
      businessDaysAgo,
      label: `${businessDaysAgo} 営業日更新されていません`,
    };
  }

  return {
    level: "FRESH",
    hoursAgo,
    businessDaysAgo,
    label: hoursAgo < 24 ? "最新です" : `${Math.floor(hoursAgo / 24)} 日前の株価です`,
  };
}

export type FreshnessSummary = {
  total: number;
  fresh: number;
  stale: number;
  missing: number;
  /** 対処が必要な件数（古い + 取得できていない） */
  problem: number;
  /** 最も古い更新時刻。1 件も無ければ null */
  oldestUpdatedAt: Date | null;
};

export function summarizeFreshness(
  items: Array<{ freshness: FreshnessResult; updatedAt: Date | null }>
): FreshnessSummary {
  let fresh = 0;
  let stale = 0;
  let missing = 0;
  let oldest: Date | null = null;
  for (const it of items) {
    if (it.freshness.level === "FRESH") fresh += 1;
    else if (it.freshness.level === "STALE") stale += 1;
    else missing += 1;
    if (it.updatedAt && (oldest === null || it.updatedAt < oldest)) oldest = it.updatedAt;
  }
  return {
    total: items.length,
    fresh,
    stale,
    missing,
    problem: stale + missing,
    oldestUpdatedAt: oldest,
  };
}
