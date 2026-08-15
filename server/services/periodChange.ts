/**
 * 前回記録からの変化。
 *
 * 長期保有が前提のため「前日比」は判断材料にならない。代わりに
 * 「前回このアプリで記録した時点」からどう変わったかを見せる。
 *
 * 重要なのは資産の増加を 2 つに分けること。
 *   - 買い増しによる増加（取得原価が増えた分）→ 儲けではない
 *   - 株価変動による増加（含み損益が増えた分）→ 実際の成績
 * 分けないと、銘柄を追加しただけで「増えた」と誤認する。
 */
export type PeriodChange = {
  /** 比較対象のスナップショット時刻 */
  fromAt: Date;
  /** 現在（最新スナップショット）の時刻 */
  toAt: Date;
  /** 経過日数。同日中の比較なら 0 */
  days: number;
  /** 評価額の増減（円）。買い増し分と株価変動分の合計 */
  totalDelta: number;
  /** 取得原価の増減（円）。買い増し（または売却）による分 */
  costDelta: number;
  /**
   * 株価変動による増減（円）。含み損益の差分。これが実際の成績を表す。
   *
   * ただし期間中に銘柄を追加・削除した場合は null になる。追加した銘柄が
   * すでに含み益を持っていると、その含み益が「この期間に上がった分」として
   * 混入してしまい、分離できないため。
   */
  gainDelta: number | null;
  /**
   * 株価変動による増減率（%）。
   * 前回時点の評価額を分母にする（買い増し分で分母が膨らまないようにする）。
   */
  gainPct: number | null;
  /** 銘柄数の増減 */
  countDelta: number;
  /**
   * 期間中に銘柄構成が変わったか。true の場合 gainDelta は null になり、
   * 画面では「銘柄を追加したため株価変動分を分離できない」旨を示す。
   */
  compositionChanged: boolean;
};

type SnapshotLike = {
  totalValue: number;
  totalCost: number;
  positionCount: number;
  capturedAt: Date;
};

/** 1 日のミリ秒 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * スナップショット列から「前回記録からの変化」を求める。
 *
 * @param snapshots 時刻の昇順・降順どちらでもよい。内部で降順に整える
 * @param minGapHours 直近と比較対象の最小間隔（時間）。株価更新は 1 日に複数回
 *   走るため、直前の記録と比べると「数分前との差」になってしまう。既定 20 時間。
 */
export function computePeriodChange(
  snapshots: SnapshotLike[],
  minGapHours = 20
): PeriodChange | null {
  if (snapshots.length < 2) return null;

  const sorted = [...snapshots].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
  const latest = sorted[0];

  /**
   * 直近から minGapHours 以上離れた最初の記録を比較対象にする。
   * 見つからない場合（記録が全部同日中など）は最も古い記録を使う。
   */
  const gapMs = minGapHours * 60 * 60 * 1000;
  const previous =
    sorted.slice(1).find(s => latest.capturedAt.getTime() - s.capturedAt.getTime() >= gapMs) ??
    sorted[sorted.length - 1];

  // 同一レコードしか無い場合は変化を出さない
  if (previous.capturedAt.getTime() === latest.capturedAt.getTime()) return null;

  const totalDelta = latest.totalValue - previous.totalValue;
  const costDelta = latest.totalCost - previous.totalCost;

  /**
   * 銘柄構成が変わったかの判定。
   *
   * 銘柄数の変化だけでなく取得原価の変化も見る。同じ銘柄数でも
   * 買い増し・一部売却があれば取得原価が動くため。
   * 取得原価の判定に小さな許容差を設けているのは、株数の小数計算や
   * 為替換算による誤差で厳密一致しないことがあるため。
   */
  const costTolerance = Math.max(1, previous.totalCost * 0.0001);
  const compositionChanged =
    latest.positionCount !== previous.positionCount || Math.abs(costDelta) > costTolerance;

  /**
   * 含み損益の差分が株価変動による増減。
   * (評価額 − 取得原価) の差を取ることで買い増し分が打ち消される。
   *
   * ただし銘柄を追加した場合、その銘柄が持ち込んだ含み損益も差分に入るため
   * 「この期間の株価変動」とは言えない。その場合は算出しない。
   */
  const gainDelta = compositionChanged ? null : totalDelta - costDelta;

  return {
    fromAt: previous.capturedAt,
    toAt: latest.capturedAt,
    days: Math.round((latest.capturedAt.getTime() - previous.capturedAt.getTime()) / DAY_MS),
    totalDelta,
    costDelta,
    gainDelta,
    gainPct:
      gainDelta !== null && previous.totalValue > 0
        ? (gainDelta / previous.totalValue) * 100
        : null,
    countDelta: latest.positionCount - previous.positionCount,
    compositionChanged,
  };
}
