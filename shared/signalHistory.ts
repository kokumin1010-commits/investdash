/**
 * 分析履歴の並びを、読む側に意味のある形へ整える純関数。
 *
 * 【なぜ加工が必要か】
 * 履歴は株価更新やニュース取得のたびに積まれるため、双日は 5 日間で 13 件ある。
 * 全部を同じ重みで並べると、判定が変わっていない日の記録が大半を占め
 * 「いつ判断が変わったのか」が埋もれる。
 *
 * 見たいのは「HOLD だった銘柄が ADD に変わった日」であり、
 * 「HOLD が HOLD のままだった日」は変化を追う上では背景情報にすぎない。
 */

export type SignalHistoryInput = {
  id: number;
  action: string;
  confidence: number | null;
  rationale: string;
  priceAtSignal: string | number | null;
  createdAt: Date | string;
  wouldBuyNow?: string | null;
  wouldBuyNowReason?: string | null;
  priceVsValue?: string | null;
  priceVsValueReason?: string | null;
};

export type SignalHistoryRow = SignalHistoryInput & {
  /** 1 つ前（時系列で古い側）の判定。最古の記録では null */
  prevAction: string | null;
  /** 判定が前回と変わったか。変わった記録だけを追えば判断の変遷が読める */
  changed: boolean;
  /** 当時の株価から今の株価までの変化率（%）。どちらかが無ければ null */
  priceChangePct: number | null;
};

/** 文字列でも数値でも受け取り、数値化できないものは null にする */
function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 同一時刻の重複を除く。
 *
 * 実データでは同じ判定が同じ分に 2 件入っていた（8/18 22:46 が 2 件、
 * 8/17 22:37 と 22:36 など）。株価更新とニュース取得が近い時刻に走ると
 * どちらも分析を呼ぶため。履歴として並べる際に同じ内容が 2 行出ると
 * 「2 回判断が変わった」ように見えるので、同じ判定・同じ分のものは 1 件にする。
 */
export function dedupeSignals<T extends SignalHistoryInput>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const key = [
      r.action,
      String(toNum(r.priceAtSignal) ?? ""),
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * 新しい順に並んだ履歴を受け取り、変化の有無と値動きを付ける。
 *
 * @param rows 新しい順（降順）の履歴
 * @param currentPrice 今の株価。当時からどれだけ動いたかを出すために使う
 */
export function buildSignalHistory(
  rows: SignalHistoryInput[],
  currentPrice: number | null
): SignalHistoryRow[] {
  const deduped = dedupeSignals(rows);
  return deduped.map((r, i) => {
    /*
     * 配列は新しい順なので、1 つ前の判定は「次の要素」にある。
     * 最後の要素（最古）には前がないので null。
     */
    const prev = deduped[i + 1] ?? null;
    const at = toNum(r.priceAtSignal);
    return {
      ...r,
      prevAction: prev?.action ?? null,
      changed: prev !== null && prev.action !== r.action,
      priceChangePct:
        at !== null && at > 0 && currentPrice !== null ? ((currentPrice - at) / at) * 100 : null,
    };
  });
}

/**
 * 判定が変わった記録だけを抜き出す。
 *
 * 「いつ考えが変わったか」だけを追いたいときに使う。
 * 最古の記録は変化と見なさない（比較対象がないため）。
 */
export function changePointsOnly(rows: SignalHistoryRow[]): SignalHistoryRow[] {
  return rows.filter(r => r.changed);
}
