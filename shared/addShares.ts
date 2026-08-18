/**
 * 買い増し金額から「実際に何株買うか」を出す。
 *
 * 【なぜ金額だけでは足りないか】
 * 「1,191 万円買う」と言われても、発注画面で入れるのは株数なので
 * その場で割り算をすることになる。日本株は 100 株単位でしか買えないため、
 * 金額を株価で割った端数をそのまま出すと発注できない数字になる。
 *
 * 【単元株の扱い】
 * 日本株は 100 株単位が原則。米国株・SG 株は 1 株単位。
 * 香港株は銘柄ごとに単元が異なり（100 株・500 株・2,000 株など）、
 * 取得できるデータに単元の情報がないため 1 株単位として扱い、
 * 画面側で「単元を確認」と添える。誤った単元で計算した株数を
 * 断定して出すより、1 株単位で出して確認を促す方が安全。
 */
import type { Market } from "./investing";

/** 市場ごとの売買単位。HK は銘柄別で不明なため 1 とする */
export function lotSizeFor(market: Market): number {
  return market === "JP" ? 100 : 1;
}

/** 単元が銘柄ごとに異なり、株数の目安が正確でない市場か */
export function lotSizeUncertain(market: Market): boolean {
  return market === "HK";
}

/**
 * 金額に収まる最大の株数（単元の倍数）を返す。
 *
 * 金額を超えないよう切り捨てる。切り上げると提示した金額を超えて
 * 買うことになり、1 銘柄の上限（資産の 5%）を破る可能性がある。
 *
 * 1 単元も買えない場合は 0 を返す（「買えない」ことを伝えるため null にしない）。
 */
export function sharesForAmount(
  amountLocal: number,
  price: number,
  market: Market
): number | null {
  if (!Number.isFinite(amountLocal) || amountLocal <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  const lot = lotSizeFor(market);
  const rawShares = amountLocal / price;
  return Math.floor(rawShares / lot) * lot;
}

/**
 * 株数を単元に丸めた結果の実際の金額。
 *
 * 「1,191 万円」と言いながら 100 株単位に丸めると実際は 1,150 万円に
 * なることがある。表示する金額は丸めた後の実額にしないと、
 * 金額と株数の掛け算が合わず数字を信用できなくなる。
 */
export function actualAmount(shares: number, price: number): number | null {
  if (!Number.isFinite(shares) || shares <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  return shares * price;
}
