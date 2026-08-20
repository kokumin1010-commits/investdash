/**
 * 前回記録からの変化。
 *
 * 長期保有が前提のため「前日比」は判断材料にならない。代わりに
 * 「一定期間前に記録した時点」からどう変わったかを見せる。
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
   * ただし期間中に銘柄数が変わった場合は null になる。追加した銘柄が
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
  /**
   * 実際に選ばれた期間の目安（狙った日数）。
   * 記録が足りず狙いより短い期間になった場合、画面で断りを入れるために使う。
   */
  targetDays: number;
  /** 狙った期間の記録が無く、手元で最も古い記録を使ったか */
  fellShort: boolean;
  /**
   * 銘柄数が同じ記録まで遡って比較したか。
   *
   * 狙った時点の記録が「登録作業の途中」だった場合、そのまま比べると
   * 常に「値動きを分離できません」になる。銘柄数が揃っている範囲で
   * 最も古い記録に切り替えたことを画面で断るために使う。
   */
  usedSameCompositionFallback: boolean;
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
 * 既定で狙う比較期間（日）。
 *
 * 月 1 回スクショを上げる使い方なので、1 週間前と比べるのが実態に合う。
 * 1 日前と比べると株価更新のたびに数字が変わり、長期の判断には使えない。
 */
export const DEFAULT_PERIOD_DAYS = 7;

/**
 * スナップショット列から「前回記録からの変化」を求める。
 *
 * @param snapshots 時刻の昇順・降順どちらでもよい。内部で降順に整える
 * @param targetDays 何日前と比べるか。既定 7 日。
 *
 * 【なぜ「N 時間以上離れた最初の記録」ではないのか】
 * 以前は「20 時間以上離れた最初の記録」を選んでいた。株価更新は 1 日 2 回
 * 走るため、最新が朝 6:37 なら 20 時間前を最初に満たすのは前日朝 6:40 で、
 * 毎回「1 日前」が選ばれ続ける。記録が増えるほど比較先も近づくので、
 * 何日経っても 1 日間のままになる。
 *
 * そこで「狙った日数に最も近い記録」を選ぶ方式に変える。7 日前を狙うなら
 * 7 日前付近の記録を取り、多少ずれても近いものを使う。記録がまだ
 * 7 日分たまっていない場合は最も古い記録を使い、その旨を fellShort で示す。
 */
export function computePeriodChange(
  snapshots: SnapshotLike[],
  targetDays = DEFAULT_PERIOD_DAYS
): PeriodChange | null {
  if (snapshots.length < 2) return null;

  const sorted = [...snapshots].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
  const latest = sorted[0];
  const latestMs = latest.capturedAt.getTime();

  /*
   * 狙った時点に最も近い記録を選ぶ。
   *
   * 同じ距離なら古い側を採る。狙いより新しい記録を採ると期間が短くなり、
   * 「1 週間の変化」と言いながら 5 日分しか見ていないことになる。
   */
  const targetMs = latestMs - targetDays * DAY_MS;
  const pickNearest = (candidates: SnapshotLike[]): SnapshotLike | null => {
    let best: SnapshotLike | null = null;
    let bestDist = Infinity;
    for (const s of candidates) {
      const dist = Math.abs(s.capturedAt.getTime() - targetMs);
      if (
        best === null ||
        dist < bestDist ||
        (dist === bestDist && s.capturedAt.getTime() < best.capturedAt.getTime())
      ) {
        bestDist = dist;
        best = s;
      }
    }
    return best;
  };

  const older = sorted.slice(1);
  let previous = pickNearest(older)!;
  let usedSameCompositionFallback = false;

  /*
   * 狙った時点の記録が「銘柄を登録している途中」だと、銘柄数が違うため
   * 常に「値動きを分離できません」になる。実データでは 8/14〜8/16 に
   * 75 → 103 → 107 → 112 と登録が進んでおり、1 週間前を狙うと
   * 必ず登録途中の記録に当たっていた。
   *
   * 登録作業は資産の増減ではないので、それが混じらない範囲で
   * 最も長く遡る方が知りたいこと（株価がいくら動いたか）に近い。
   * 銘柄数が今と同じ記録の中で最も古いものへ切り替える。
   */
  if (previous.positionCount !== latest.positionCount) {
    const sameComposition = older.filter(s => s.positionCount === latest.positionCount);
    if (sameComposition.length > 0) {
      // 銘柄数が揃っている中で最も古い記録（sorted は降順なので末尾）
      previous = sameComposition[sameComposition.length - 1];
      usedSameCompositionFallback = true;
    }
  }

  // 同一時刻しか無い場合は変化を出さない
  if (previous.capturedAt.getTime() === latestMs) return null;

  const oldest = sorted[sorted.length - 1];
  /*
   * 狙った期間の 8 割に届かない場合は「まだその期間分の記録がない」と扱う。
   * 7 日を狙って 2 日しか遡れないなら、それは 1 週間の変化ではない。
   * ぴったり一致は求めない（記録は 1 日 2 回なので数時間のずれは常に出る）。
   *
   * 銘柄数を揃えるために遡り先を変えた場合も、狙いより短ければ断りを入れる。
   * この場合は「記録が無い」のではなく「登録途中の記録を避けた」結果だが、
   * どちらも「狙った期間より短い」ことは変わらないため同じ扱いにする。
   */
  const actualDays = (latestMs - previous.capturedAt.getTime()) / DAY_MS;
  const fellShort =
    actualDays < targetDays * 0.8 &&
    (previous.capturedAt.getTime() === oldest.capturedAt.getTime() ||
      usedSameCompositionFallback);

  const totalDelta = latest.totalValue - previous.totalValue;
  const costDelta = latest.totalCost - previous.totalCost;

  /*
   * 銘柄構成が変わったかの判定。
   *
   * 【取得原価の変動では判定しない】
   * 以前は銘柄数の変化に加えて「取得原価が前回の 0.01% を超えて動いたら
   * 売買があった」と判定していた。しかし取得原価は最新の為替で円換算して
   * いるため、売買していなくても為替が動くだけで変動する。実データでは
   * 銘柄数 112 で一定の 7 区間のうち 6 区間が閾値を超えており（最大 0.28%）、
   * 毎回「売買があった」と誤判定して値動きを出せない状態だった。
   *
   * 為替による変動と実際の売買による変動は、取得原価の差だけでは区別できない。
   * 一方で銘柄数の変化は為替の影響を受けないので、こちらだけで判定する。
   *
   * 【同じ銘柄への買い増しは検知できない】
   * 銘柄数が変わらない買い増しは取り逃がす。ただしその場合でも
   * 含み損益の差（totalDelta - costDelta）は買い増し分が打ち消されるため、
   * 株価変動分としては概ね正しい値になる。取得単価の平均が動く分の
   * 誤差は残るが、為替のせいで毎回「判定できません」と出るより実用的。
   */
  const compositionChanged = latest.positionCount !== previous.positionCount;

  /*
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
    days: Math.round(actualDays),
    totalDelta,
    costDelta,
    gainDelta,
    gainPct:
      gainDelta !== null && previous.totalValue > 0
        ? (gainDelta / previous.totalValue) * 100
        : null,
    countDelta: latest.positionCount - previous.positionCount,
    compositionChanged,
    targetDays,
    fellShort,
    usedSameCompositionFallback,
  };
}
