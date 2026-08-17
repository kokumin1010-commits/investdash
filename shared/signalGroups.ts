/**
 * シグナル別の銘柄一覧を作る。
 *
 * 件数（ADD 25 / HOLD 42）だけを出すと「どの銘柄か」が分からず、
 * 結局保有一覧を開いて探すことになるため、シグナルごとに銘柄を持たせる。
 */
import type { SignalAction } from "./investing";

/** 並べ替えに必要な最小限の形。画面側の型に依存させない */
export type SignalGroupItem = {
  symbol: string;
  signalAction: SignalAction | null;
  /** 評価額（基準通貨）。取得できていなければ null */
  marketValueBase: number | null;
};

/**
 * シグナルごとに銘柄をまとめ、各シグナル内を評価額の大きい順に並べる。
 *
 * 同じ ADD でも 2,000 万円の銘柄と 20 万円の銘柄では検討の優先度が違うため、
 * 金額の大きいものを先に出す。評価額が取れていない銘柄は最後に回す
 * （0 として扱うと、たまたま株価が取れなかった銘柄が最下位に沈むが、
 *  金額が分からないものを上位に置いても判断材料にならないため妥当）。
 */
export function groupBySignal<T extends SignalGroupItem>(items: T[]): Map<SignalAction, T[]> {
  const bySignal = new Map<SignalAction, T[]>();
  for (const item of items) {
    if (!item.signalAction) continue;
    const list = bySignal.get(item.signalAction) ?? [];
    list.push(item);
    bySignal.set(item.signalAction, list);
  }
  bySignal.forEach(list => {
    list.sort((a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0));
  });
  return bySignal;
}

/**
 * 最初に開いておくシグナル。
 *
 * 判断が必要なものを優先する。静観（HOLD）が一番多いからといって
 * それを既定にすると、何もしなくてよい銘柄が最初に出てしまう。
 */
export function pickDefaultSignal(
  bySignal: Map<SignalAction, unknown[]>,
): SignalAction | null {
  const priority: SignalAction[] = ["ADD", "REDUCE", "EXIT", "WATCH", "HOLD"];
  return priority.find(a => (bySignal.get(a)?.length ?? 0) > 0) ?? null;
}
