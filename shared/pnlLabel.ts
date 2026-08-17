/**
 * 損益率から表示ラベルを決める。
 *
 * ユーザーから「+240.67% や 3.0% が何の数字か分からない」という指摘を受け、
 * 数字だけを並べず必ずラベルを添える方針にした。
 * 特に「注意が必要な銘柄」枠では含み益が大きい銘柄も並ぶため、
 * ラベルがないと「良い銘柄なのに注意枠にある」矛盾に見えてしまう。
 */
export function pnlLabel(pnlPct: number | null): string {
  if (pnlPct === null) return "含み損益";
  return pnlPct < 0 ? "含み損" : "含み益";
}

/**
 * 損益率を求める。取得原価がマイナスまたは 0 のときは率を出さない。
 *
 * 富途香港の AMD のように、オプションのプレミアム受取が購入代金を上回ると
 * 取得原価がマイナスになる（150 株で総原価 −5,773.16 ドル）。
 * この状態で率を計算すると 82,931.66 ÷ (−5,773.16) = −1,436% となり、
 * 含み益が出ているのに大きな損失のように見えてしまう。
 * 並び替えの順序も壊れるため、率は算出せず null を返す。
 *
 * 金額（含み損益）は正しく計算できるので、そちらは通常どおり扱う。
 * 率が出ない理由は画面側で「原価回収済み」と示す。
 */
export function calcPnlPct(pnl: number | null, costValue: number): number | null {
  if (pnl === null) return null;
  if (costValue <= 0) return null;
  return (pnl / costValue) * 100;
}

/**
 * 取得原価がマイナスかどうか。「原価回収済み」の表示判定に使う。
 *
 * 率が null になる理由は 2 通りある（株価が未取得 / 原価がマイナス）。
 * 前者は「データがない」、後者は「回収済みで率に意味がない」で意味が違うため、
 * 画面で書き分けられるように判定を分けて持つ。
 */
export function isCostRecovered(costValue: number | null | undefined): boolean {
  return costValue !== null && costValue !== undefined && costValue < 0;
}
