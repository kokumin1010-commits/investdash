/**
 * 買い増しプラン（価格帯ごとの行動）の共通型と判定ロジック。
 *
 * 「目標価格 1 点」ではなく価格帯の段組みで判断する。実際の使い方の例:
 *   160〜170 ドル → 持有、急いで買い増さない
 *   145〜152 ドル → 小幅追加
 *   125〜138 ドル → ファンダメンタルズに問題がなければ主力で買い増す
 *   110 ドル以下  → 大口顧客の喪失や AI 受注の悪化を確認してから判断
 *
 * サーバーと画面で同じ判定を使うため shared に置く。
 */

/** 帯ごとの行動の種類 */
export const BAND_ACTIONS = ["HOLD", "ADD_SMALL", "ADD_MAIN", "VERIFY", "REDUCE"] as const;
export type BandAction = (typeof BAND_ACTIONS)[number];

export const BAND_ACTION_LABELS: Record<BandAction, string> = {
  HOLD: "様子見",
  ADD_SMALL: "小幅に買い増す",
  ADD_MAIN: "主力で買い増す",
  VERIFY: "条件を確認してから判断",
  REDUCE: "減らす",
};

/**
 * 帯の色。下に行くほど「買う量が増える」ので緑を濃くしていく。
 * VERIFY は買うとは限らないので警告色にする。
 */
export const BAND_ACTION_STYLES: Record<BandAction, string> = {
  HOLD: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900/40 dark:text-slate-300",
  ADD_SMALL: "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300",
  ADD_MAIN: "bg-emerald-100 text-emerald-800 border-emerald-400 dark:bg-emerald-900/50 dark:text-emerald-200",
  VERIFY: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300",
  REDUCE: "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300",
};

/** グラフ用の HEX。CSS クラスと色相を揃える */
export const BAND_ACTION_HEX: Record<BandAction, string> = {
  HOLD: "#94a3b8",
  ADD_SMALL: "#34d399",
  ADD_MAIN: "#059669",
  VERIFY: "#f59e0b",
  REDUCE: "#f43f5e",
};

export type BandInput = {
  id: number;
  /** この値以上。null なら下限なし */
  lowerPrice: number | null;
  /** この値以下。null なら上限なし */
  upperPrice: number | null;
  action: BandAction;
  actionLabel: string;
  reason: string | null;
  checkItems: string[] | null;
  plannedAmount: number | null;
  sortOrder: number;
};

/**
 * 現在値が帯の中にあるか。
 *
 * 上限・下限はどちらも省略可能。「110 ドル以下」のように片側しか決まっていない
 * 段が実際に存在するため。境界はどちらも含む（以上・以下）。
 */
export function isPriceInBand(price: number, band: Pick<BandInput, "lowerPrice" | "upperPrice">): boolean {
  if (band.lowerPrice !== null && price < band.lowerPrice) return false;
  if (band.upperPrice !== null && price > band.upperPrice) return false;
  return true;
}

/** 帯を高い順（上限が大きい順）に並べる。表示は上が高値 */
export function sortBandsDesc(bands: BandInput[]): BandInput[] {
  return [...bands].sort((a, b) => {
    // 上限なし（上に開いている）帯を最上段に置く
    const au = a.upperPrice ?? Number.POSITIVE_INFINITY;
    const bu = b.upperPrice ?? Number.POSITIVE_INFINITY;
    if (au !== bu) return bu - au;
    const al = a.lowerPrice ?? Number.NEGATIVE_INFINITY;
    const bl = b.lowerPrice ?? Number.NEGATIVE_INFINITY;
    return bl - al;
  });
}

/** 帯の表示用の価格レンジ文字列 */
export function bandRangeText(band: Pick<BandInput, "lowerPrice" | "upperPrice">): string {
  const f = (v: number) => v.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  if (band.lowerPrice !== null && band.upperPrice !== null) {
    return `${f(band.lowerPrice)} 〜 ${f(band.upperPrice)}`;
  }
  if (band.upperPrice !== null) return `${f(band.upperPrice)} 以下`;
  if (band.lowerPrice !== null) return `${f(band.lowerPrice)} 以上`;
  return "価格の指定なし";
}

export type BandEvaluation = {
  /** 現在値が入っている帯。どの帯にも入っていなければ null */
  currentBand: BandInput | null;
  /**
   * 現在値が全ての帯より上にあるか。
   * 買い増しプランは通常「ここまで下がったら買う」なので、
   * 上に外れている場合は「今は対象外」と明示する必要がある。
   */
  abovePlan: boolean;
  /** 現在値が全ての帯より下にあるか（想定以上に下落している） */
  belowPlan: boolean;
  /**
   * 次に入る帯（現在値のすぐ下の帯）。
   * 「あと何 % 下がれば次の段に入るか」を出すために使う。
   */
  nextBand: BandInput | null;
  /** 次の帯に入るまでに必要な下落率（%）。負の数で表す */
  gapToNextPct: number | null;
  /** 次の帯に入る価格 */
  nextBandPrice: number | null;
};

/**
 * 現在値を価格帯に照らして評価する。
 *
 * 帯の外にいる場合に一番近い帯を無理に当てはめてはならない。
 * 「$222 なのに 160〜170 の帯の行動を出す」と誤った判断につながるため、
 * 外にいることを明示的に返す。
 */
export function evaluateBands(price: number | null, bands: BandInput[]): BandEvaluation {
  const sorted = sortBandsDesc(bands);
  if (price === null || sorted.length === 0) {
    return {
      currentBand: null,
      abovePlan: false,
      belowPlan: false,
      nextBand: null,
      gapToNextPct: null,
      nextBandPrice: null,
    };
  }

  const currentBand = sorted.find(b => isPriceInBand(price, b)) ?? null;

  // 帯の中にいる場合、次の段は「今の帯より下で、一番上にある帯」
  const below = sorted.filter(b => {
    const upper = b.upperPrice;
    // 上限が現在値より下にある帯 = まだ下がらないと入らない帯
    return upper !== null && upper < price;
  });
  const nextBand = below.length > 0 ? below[0] : null;

  /*
   * 次の帯に入る価格。
   * 上限が決まっていればその値まで下がれば入る。
   */
  const nextBandPrice = nextBand?.upperPrice ?? null;
  const gapToNextPct =
    nextBandPrice !== null && price > 0 ? ((nextBandPrice - price) / price) * 100 : null;

  // 全ての帯より上か
  const highestUpper = sorted[0]?.upperPrice ?? null;
  const abovePlan = currentBand === null && highestUpper !== null && price > highestUpper;

  // 全ての帯より下か
  const lowestLower = sorted[sorted.length - 1]?.lowerPrice ?? null;
  const belowPlan = currentBand === null && lowestLower !== null && price < lowestLower;

  return { currentBand, abovePlan, belowPlan, nextBand, gapToNextPct, nextBandPrice };
}
