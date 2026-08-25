/**
 * 資産推移グラフの集計。
 *
 * 長期保有の判断に使えるようにするには、次の 2 つを区別する必要がある。
 *  - 銘柄を追加した（口座を登録した）ことによる増加
 *  - 保有している株の値動きによる増加
 *
 * この 2 つを混ぜると「3,738 万 → 8 億 1,156 万に増えた」のような、
 * 実態を表さない数字になってしまう。銘柄数が変わった点に印を付け、
 * 値動きだけの変化を別途計算する。
 */

import { jstDayKey } from "../../shared/jstDate";

export type TrendScale = "day" | "month";

export type SnapshotInput = {
  totalValue: number;
  totalCost: number;
  positionCount: number;
  /** 借入残高。記録が無い古いスナップショットでは null */
  borrowed: number | null;
  /** 純資産。記録が無い古いスナップショットでは null */
  netAssets: number | null;
  capturedAt: Date;
};

export type TrendPoint = {
  /** 表示用のラベル */
  date: string;
  /** 並び替えと期間判定に使う実際の時刻 */
  at: Date;
  /** 総評価額（借入で買った分を含む） */
  value: number;
  /** 取得原価 */
  cost: number;
  /** 純資産。借入の記録がない期間は null */
  netAssets: number | null;
  /** その期間末の銘柄数 */
  positionCount: number;
  /** 前の点から銘柄数が変わったか（登録作業があった期間） */
  positionChanged: boolean;
  /** 前の点からの銘柄数の増減 */
  positionDelta: number;
  /**
   * 値動きによる変化額。
   * 銘柄数が変わった期間は分離できないため null にする。
   * （追加された銘柄が持ち込む含み損益が混ざって誤った数字になる）
   */
  priceChange: number | null;
};

export type TrendResult = {
  points: TrendPoint[];
  /** 元の記録件数（粒度で丸める前） */
  snapshotCount: number;
  /** 記録の最初と最後 */
  firstAt: Date | null;
  lastAt: Date | null;
  /** 銘柄数が変わった点の数。多いと推移が登録作業に支配されている */
  changedPointCount: number;
  /**
   * 銘柄数が変わらなかった期間だけを合計した値動き。
   * 登録作業の影響を除いた「実際の値動き」を表す。
   */
  priceOnlyChange: number | null;
};

function bucketKey(d: Date, scale: TrendScale): string {
  const day = jstDayKey(d);
  return scale === "month" ? day.slice(0, 7) : day;
}

/**
 * 指定の粒度で集計する。各期間の最後の記録をその期間の代表値にする
 * （期末時点の資産を表すため）。
 */
export function buildAssetTrend(rows: SnapshotInput[], scale: TrendScale): TrendResult {
  if (rows.length === 0) {
    return {
      points: [],
      snapshotCount: 0,
      firstAt: null,
      lastAt: null,
      changedPointCount: 0,
      priceOnlyChange: null,
    };
  }

  const sorted = [...rows].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

  const byBucket = new Map<string, SnapshotInput>();
  for (const r of sorted) {
    // 後の記録で上書きするので、結果的に各期間の最終値が残る
    byBucket.set(bucketKey(r.capturedAt, scale), r);
  }

  const picked = Array.from(byBucket.values()).sort(
    (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime()
  );

  const points: TrendPoint[] = picked.map((r, i) => {
    const prev = i > 0 ? picked[i - 1] : null;
    const delta = prev ? r.positionCount - prev.positionCount : 0;
    const changed = prev !== null && delta !== 0;

    /*
     * 値動きによる変化は「評価額の変化 − 取得原価の変化」で求める。
     * 取得原価の変化は買い増し・売却による増減なので、これを引くと値動き分が残る。
     * ただし銘柄数が変わった期間は、追加銘柄が既存の含み損益を持ち込むため
     * この式では正しく分離できない。
     */
    let priceChange: number | null = null;
    if (prev && !changed) {
      priceChange = r.totalValue - prev.totalValue - (r.totalCost - prev.totalCost);
    }

    return {
      date:
        scale === "month"
          ? r.capturedAt.toLocaleDateString("ja-JP", {
              year: "2-digit",
              month: "numeric",
              timeZone: "Asia/Tokyo",
            })
          : r.capturedAt.toLocaleDateString("ja-JP", {
              month: "numeric",
              day: "numeric",
              timeZone: "Asia/Tokyo",
            }),
      at: r.capturedAt,
      value: r.totalValue,
      cost: r.totalCost,
      netAssets: r.netAssets,
      positionCount: r.positionCount,
      positionChanged: changed,
      positionDelta: delta,
      priceChange,
    };
  });

  const priceValues = points.map(p => p.priceChange).filter((v): v is number => v !== null);

  return {
    points,
    snapshotCount: rows.length,
    firstAt: sorted[0].capturedAt,
    lastAt: sorted[sorted.length - 1].capturedAt,
    changedPointCount: points.filter(p => p.positionChanged).length,
    priceOnlyChange: priceValues.length > 0 ? priceValues.reduce((a, b) => a + b, 0) : null,
  };
}

/**
 * 表示に使う粒度を決める。
 *
 * 記録が同じ月に固まっていると月次では点が 1 つしかできず、グラフが空になる。
 * 利用者から見ると「記録されていない」ように見えてしまうため、
 * 月次で描けないときは日次に落とす。
 */
export function resolveScale(
  rows: SnapshotInput[],
  requested: TrendScale
): { scale: TrendScale; fellBack: boolean } {
  if (requested === "day") return { scale: "day", fellBack: false };
  const monthly = buildAssetTrend(rows, "month");
  if (monthly.points.length >= 2) return { scale: "month", fellBack: false };
  const daily = buildAssetTrend(rows, "day");
  // 日次にしても 2 点に届かないなら月次のままにして「まだ描けない」と伝える
  if (daily.points.length >= 2) return { scale: "day", fellBack: true };
  return { scale: requested, fellBack: false };
}
