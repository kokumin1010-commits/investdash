/**
 * 買い増しプランの判定が変わったかどうかを判断する。
 *
 * この画面は月 1 回程度しか開かない前提のため、その間に株価が
 * 買い増し圏まで下がって戻っていても気付けない。判定が切り替わった
 * 時点だけを残すことで「8/20 に打診買い圏に入り 8/25 に抜けた」と
 * 後から追えるようにする。
 *
 * DB に依存しない純関数にして、変化の判定だけをテストできるようにする。
 */
import type { BandAction } from "./priceBands";

/** ある時点の判定 */
export type BandState = {
  /** 現在いる段の行動。帯の外なら null */
  action: BandAction | null;
  /** 段の説明。段を編集しても当時の文言が分かるように保存する */
  label: string | null;
  /** 帯の外にいる方向。帯の中なら null */
  outsideDirection: "ABOVE" | "BELOW" | null;
};

/**
 * 判定が変わったか。
 *
 * 株価が動いただけでは記録しない。同じ段の中で株価が上下しても
 * とるべき行動は変わらないため、記録すると変化した時点が埋もれて読めなくなる。
 */
export function hasStateChanged(prev: BandState | null, next: BandState): boolean {
  // 初回は「変化」として記録する。基準がないと次回以降の比較ができない
  if (prev === null) return true;
  if (prev.action !== next.action) return true;
  /*
   * 帯の外に出た方向も変化として扱う。
   * 上に抜けた（高すぎて対象外）と下に抜けた（想定より下落）は
   * どちらも action が null になるので、方向を見ないと区別できない。
   */
  if (prev.outsideDirection !== next.outsideDirection) return true;
  return false;
}

/**
 * 判定の変化がどれだけ重要かを分類する。
 *
 * 週次レポートで「今週の変化」として出すとき、静観のままの銘柄と
 * 買い増し圏に入った銘柄を同じ重みで並べると読み飛ばされる。
 */
export type TransitionImportance = "HIGH" | "MEDIUM" | "LOW";

/** 行動の重み。数字が大きいほど判断を要する */
const ACTION_WEIGHT: Record<BandAction, number> = {
  HOLD: 0,
  VERIFY: 2,
  ADD_SMALL: 2,
  REDUCE: 3,
  ADD_MAIN: 3,
};

export function classifyTransition(prev: BandState | null, next: BandState): TransitionImportance {
  const nextWeight = next.action ? ACTION_WEIGHT[next.action] : 0;
  const prevWeight = prev?.action ? ACTION_WEIGHT[prev.action] : 0;

  /*
   * 主力買い増し・減らす（重み 3）に入ったら必ず高い。
   * 金額の大きい行動なので、見逃すと機会損失や損失拡大につながる。
   */
  if (nextWeight >= 3) return "HIGH";
  /*
   * 打診買い・要確認（重み 2）は、静観から入ったときだけ高い。
   * 主力買い増し圏から戻ってきた場合は「行動の必要度が下がった」ので低い。
   */
  if (nextWeight === 2) return prevWeight < nextWeight ? "HIGH" : "MEDIUM";
  /*
   * 買い増し圏から静観に戻った、あるいは帯の外に出た場合は中。
   * 「買い場を逃した」ことを知る意味はあるが、今すぐ動く必要はない。
   */
  if (prevWeight >= 2) return "MEDIUM";
  return "LOW";
}

/**
 * 変化を人が読める 1 行にする。
 *
 * 「HOLD → ADD_SMALL」のような記号のままでは意味が伝わらないため、
 * 段の説明（label）を使って文章にする。
 */
export function describeTransition(prev: BandState | null, next: BandState): string {
  const outsideText = (dir: "ABOVE" | "BELOW") =>
    dir === "ABOVE" ? "価格帯より上（対象外）" : "価格帯より下（想定を超える下落）";

  const fromText = prev
    ? prev.outsideDirection
      ? outsideText(prev.outsideDirection)
      : (prev.label ?? "不明")
    : null;
  const toText = next.outsideDirection
    ? outsideText(next.outsideDirection)
    : (next.label ?? "不明");

  if (fromText === null) return `記録を開始: ${toText}`;
  return `${fromText} → ${toText}`;
}
