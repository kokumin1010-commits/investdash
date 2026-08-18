/**
 * 長期の株価騰落率を計算する。
 *
 * 【なぜ必要か】
 * これまでシグナル判定に渡していたのは 1 か月・3 か月の騰落率だけだった。
 * この短さでは「一時的に下がった」ことしか分からず、
 * 「価格の伸びが企業の中身の伸びを追い越していないか」という判断ができない。
 *
 * 取得単価は判断に使わない。$20 で買ったか $80 で買ったかは、
 * 今この値段で買うかどうかとは無関係である。代わりに
 * 「株価がこの期間にどれだけ伸びたか」を出し、
 * 中身（利益）が同じ速さで伸びたかを AI に問う材料にする。
 *
 * 【なぜ月足を使うか】
 * 5 年分を日足で取ると約 1,250 本になり、AI に渡すトークンも増える。
 * 長期の伸びを見るのに日々の上下は不要なので月足（61 本）で足りる。
 */

export type PriceBar = {
  /** ミリ秒のエポック時刻 */
  t: number;
  /** 終値 */
  c: number;
};

export type LongTermReturns = {
  /** 1 年の騰落率（%）。データが足りない場合は null */
  pct1y: number | null;
  /** 3 年の騰落率（%） */
  pct3y: number | null;
  /** 5 年の騰落率（%） */
  pct5y: number | null;
  /** 年率換算した 5 年の伸び（%）。複利で均した値 */
  cagr5y: number | null;
  /** 実際に使えた期間の長さ（年）。5 年未満の上場銘柄を見分けるため */
  coveredYears: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 指定した年数前を基準にした騰落率を求める。
 *
 * 基準日ぴったりのデータが無い場合は、その日以降で最初に見つかる足を使う。
 * 月足なので最大 1 か月ずれるが、5 年の伸びを見る目的では影響が小さい。
 *
 * 許容範囲を超えて古いデータしか無い場合は null を返す。
 * 3 年分しかない銘柄で「5 年で +80%」と出すと、実際より短い期間の
 * 値動きを長期の実績として誤読してしまう。
 */
function returnOverYears(bars: PriceBar[], years: number): number | null {
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const cutoff = last.t - years * 365 * DAY_MS;
  // 基準日以降で最初の足を探す
  const base = bars.find(b => b.t >= cutoff);
  if (!base || base.c === 0) return null;
  // 基準の足が新しすぎる場合（データが足りない）は出さない。
  // 許容は 6 か月まで。5 年を求めて 4.5 年分しか無いなら近似として使う。
  const coveredMs = last.t - base.t;
  const requiredMs = years * 365 * DAY_MS;
  if (coveredMs < requiredMs - 183 * DAY_MS) return null;
  return ((last.c - base.c) / base.c) * 100;
}

/**
 * 月足の株価から長期の騰落率を組み立てる。
 */
export function computeLongTermReturns(bars: PriceBar[]): LongTermReturns {
  const sorted = [...bars].filter(b => Number.isFinite(b.c) && b.c > 0).sort((a, b) => a.t - b.t);

  if (sorted.length < 2) {
    return { pct1y: null, pct3y: null, pct5y: null, cagr5y: null, coveredYears: null };
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const coveredYears = (last.t - first.t) / (365 * DAY_MS);

  const pct5y = returnOverYears(sorted, 5);
  // 年率換算は 5 年が揃っている場合のみ。短い期間を年率にすると
  // 直近の急騰がそのまま「年率 120%」のように見えて判断を誤らせる。
  const cagr5y =
    pct5y === null ? null : (Math.pow(1 + pct5y / 100, 1 / 5) - 1) * 100;

  return {
    pct1y: returnOverYears(sorted, 1),
    pct3y: returnOverYears(sorted, 3),
    pct5y,
    cagr5y,
    coveredYears: Math.round(coveredYears * 10) / 10,
  };
}

/**
 * 騰落率を AI に渡す文にする。
 *
 * 取得できなかった期間は「データ未取得」と明記する。
 * 黙って省くと AI が「5 年の実績は良好」のように推測で埋めてしまう。
 */
export function formatLongTermReturns(r: LongTermReturns): string {
  const fmt = (v: number | null): string =>
    v === null ? "データ未取得" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  const lines = [
    `- 1 年の株価騰落: ${fmt(r.pct1y)}`,
    `- 3 年の株価騰落: ${fmt(r.pct3y)}`,
    `- 5 年の株価騰落: ${fmt(r.pct5y)}`,
  ];
  if (r.cagr5y !== null) {
    lines.push(`- 5 年の年率換算: ${fmt(r.cagr5y)}（複利で均した値）`);
  }
  if (r.coveredYears !== null && r.coveredYears < 4.5) {
    lines.push(
      `- 取得できた株価の期間: 約 ${r.coveredYears} 年（5 年に満たないため長期の伸びは判断材料にしない）`
    );
  }
  return lines.join("\n");
}
