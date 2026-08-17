/**
 * 通貨換算。
 *
 * 保有銘柄の価格は現地通貨（JPY / USD / SGD / HKD）で記録されている。総資産や
 * 構成比を出すには基準通貨（円）に揃える必要があるため、ここで一元化する。
 *
 * 換算処理を各所に散らすと、通貨を増やしたときに一部だけ未対応になり
 * （SGD を追加したときに実際に起きた）評価額が静かに間違う。
 */

export type FxRates = {
  /** 1 USD が何円か */
  usdJpy: number;
  /** 1 SGD が何円か */
  sgdJpy: number;
  /** 1 HKD が何円か */
  hkdJpy: number;
};

/** 為替レートが取れなかった場合に使う保守的な既定値 */
export const FX_FALLBACK: FxRates = { usdJpy: 150, sgdJpy: 115, hkdJpy: 19 };

/**
 * 現地通貨の金額を円に換算する。
 *
 * 対応していない通貨は換算できないため null を返す。呼び出し側で
 * 「換算できなかった」ことを判別できるようにし、レート 1 として
 * 混ぜてしまうのを防ぐ。
 *
 * @param amount 現地通貨の金額。null ならそのまま null
 * @param currency 通貨コード（大文字小文字は問わない）
 */
export function convertToJpy(
  amount: number | null,
  currency: string,
  rates: FxRates
): number | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  switch (currency.trim().toUpperCase()) {
    case "JPY":
      return amount;
    case "USD":
      return amount * rates.usdJpy;
    case "SGD":
      return amount * rates.sgdJpy;
    case "HKD":
      return amount * rates.hkdJpy;
    default:
      return null;
  }
}

/** 換算できない通貨はそのままの数値として扱う版（合計処理で欠損させたくない場合） */
export function convertToJpyOrSelf(
  amount: number,
  currency: string,
  rates: FxRates
): number {
  return convertToJpy(amount, currency, rates) ?? amount;
}

/** 為替レートとして妥当な範囲か。API 仕様変更やパース失敗を検知する */
export function isPlausibleRate(rate: number | null, min: number, max: number): boolean {
  return rate !== null && Number.isFinite(rate) && rate >= min && rate <= max;
}
