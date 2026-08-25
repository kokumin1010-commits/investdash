/**
 * バフェット式の判定（今から買うか / 株価と中身の伸び）での絞り込み。
 *
 * 判定は 112 銘柄すべてに入っているが、一覧では上から順に見るしかなく
 * 「今からは買わない 12 件」「株価が中身より速い 21 件」を探し出せなかった。
 * 2.29 億円を借りている状態では、この区分の銘柄を先に見る必要がある。
 *
 * サーバー・画面の両方で同じ区分を使うため共通化する。
 * 画面側だけに書くと、レポートや提案で使うときに定義がずれる。
 */

export type WouldBuy = "YES" | "NO" | "UNCLEAR";
export type PriceVsValue = "PRICE_AHEAD" | "VALUE_AHEAD" | "IN_LINE" | "UNKNOWN";

/**
 * 絞り込みの選択肢。
 *
 * 判定値をそのまま並べるのではなく「何を探したいか」で作る。
 * 実際に知りたいのは次の 3 つ。
 *   - 今からは買わない銘柄はどれか（持ち続ける理由を確かめたい）
 *   - 株価が中身より先に走っている銘柄はどれか（レバレッジ下で最も危ない）
 *   - 材料が足りず判断できていない銘柄はどれか（調べる対象）
 *
 * 「今からでも買う」は買い増しプラン側で既に扱えるため選択肢に入れるが、
 * 一覧の既定にはしない。
 */
export const BUFFETT_FILTERS = [
  "ALL",
  /** 今からは買わない */
  "NOT_BUY_NOW",
  /** 株価が中身より速い */
  "PRICE_AHEAD",
  /** 今からは買わない かつ 株価が中身より速い（最も注意すべき組み合わせ） */
  "OVERHEATED",
  /** 今からでも買う */
  "BUY_NOW",
  /** 中身が株価より速い */
  "VALUE_AHEAD",
  /** 判断材料が足りない */
  "UNCLEAR",
] as const;

export type BuffettFilter = (typeof BUFFETT_FILTERS)[number];

export const BUFFETT_FILTER_LABELS: Record<BuffettFilter, string> = {
  ALL: "すべての新規判定",
  NOT_BUY_NOW: "新規では見送る",
  PRICE_AHEAD: "株価が中身より速い",
  OVERHEATED: "新規見送り＋株価先行",
  BUY_NOW: "仮に未保有なら買う",
  VALUE_AHEAD: "中身が株価より速い",
  UNCLEAR: "新規判断・材料不足",
};

/** 判定を持つ最小限の形。画面側の型に依存させない */
export type BuffettJudged = {
  wouldBuyNow?: WouldBuy | string | null;
  priceVsValue?: PriceVsValue | string | null;
};

/**
 * 1 件が絞り込み条件に合うかを判定する。
 *
 * 判定が入っていない銘柄（過去に生成したシグナル）は、
 * ALL 以外では除外する。null を「該当しない」ではなく
 * 「まだ分からない」として扱い、UNCLEAR にも入れない
 * （UNCLEAR は AI が材料不足と明示的に答えたものに限る。
 *   混ぜると「AI が判断できなかった銘柄」の実数が分からなくなる）。
 */
export function matchesBuffettFilter(item: BuffettJudged, filter: BuffettFilter): boolean {
  if (filter === "ALL") return true;
  const buy = item.wouldBuyNow ?? null;
  const pv = item.priceVsValue ?? null;
  switch (filter) {
    case "NOT_BUY_NOW":
      return buy === "NO";
    case "PRICE_AHEAD":
      return pv === "PRICE_AHEAD";
    case "OVERHEATED":
      return buy === "NO" && pv === "PRICE_AHEAD";
    case "BUY_NOW":
      return buy === "YES";
    case "VALUE_AHEAD":
      return pv === "VALUE_AHEAD";
    case "UNCLEAR":
      // 材料不足はどちらの軸でも起こる
      return buy === "UNCLEAR" || pv === "UNKNOWN";
    default:
      return true;
  }
}

/** URL クエリ（?lens=PRICE_AHEAD）から判定フィルタを読み取る */
export function parseBuffettFilter(search: string): BuffettFilter | null {
  const raw = new URLSearchParams(search).get("lens");
  if (!raw) return null;
  return (BUFFETT_FILTERS as readonly string[]).includes(raw) ? (raw as BuffettFilter) : null;
}

/**
 * 判定の内訳を数える。
 *
 * 同じ銘柄を複数口座で持っていても 1 銘柄として数える前提で、
 * 呼び出し側が銘柄単位に畳んだ配列を渡す。
 */
export function countBuffettBreakdown(items: BuffettJudged[]): {
  filter: BuffettFilter;
  count: number;
}[] {
  return BUFFETT_FILTERS.filter(f => f !== "ALL").map(filter => ({
    filter,
    count: items.filter(i => matchesBuffettFilter(i, filter)).length,
  }));
}

/**
 * 判定が入っていない銘柄の数。
 *
 * 0 件でない場合は「まだ全銘柄に行き渡っていない」ことを画面で伝える必要がある。
 * 内訳の合計と銘柄数が合わない理由がそこにあるため。
 */
export function countUnjudged(items: BuffettJudged[]): number {
  return items.filter(i => !i.wouldBuyNow && !i.priceVsValue).length;
}
