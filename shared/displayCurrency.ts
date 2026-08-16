/**
 * 表示通貨の切り替え。
 *
 * これまで金額は「その株の現地通貨」で表示していたため、
 * 保有一覧に ¥4530万（トヨタ）と $14.5万（オラクル）が縦に並び、
 * 目で見て大小を比較できなかった（並び替え自体は円換算で行っていたので順序は正しい）。
 *
 * 表示と並び順の基準を揃えるため、金額の表示通貨を選べるようにする。
 * 「世界の株を横並びで見る」用途では USD が共通言語になるため既定は USD。
 *
 * ただし損益率は現地通貨ベースを維持する。
 * 円換算した率には為替変動が混ざり、「株で儲かったのか円安で儲かったのか」が
 * 区別できなくなるため。
 */
export const DISPLAY_CURRENCIES = ["USD", "JPY", "SGD", "LOCAL"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export const DISPLAY_CURRENCY_LABELS: Record<DisplayCurrency, string> = {
  USD: "米ドルに統一",
  JPY: "円に統一",
  SGD: "SGD に統一",
  LOCAL: "現地通貨のまま",
};

/** 選択の意図が伝わる短いラベル（切り替えボタン用） */
export const DISPLAY_CURRENCY_SHORT: Record<DisplayCurrency, string> = {
  USD: "USD",
  JPY: "円",
  SGD: "SGD",
  LOCAL: "現地",
};

export function isDisplayCurrency(v: unknown): v is DisplayCurrency {
  return typeof v === "string" && (DISPLAY_CURRENCIES as readonly string[]).includes(v);
}

/** 円換算に使うレート。株価更新と同時に自動取得している値を渡す */
export type FxRates = {
  usdJpy: number;
  sgdJpy: number;
};

/**
 * 円建ての金額を表示通貨に換算する。
 *
 * 内部の集計はすべて円（base）で積み上げているため、
 * 表示側では「円 → 表示通貨」の一方向の換算だけを行う。
 * これにより既存の計算結果に手を入れずに表示を切り替えられる。
 */
export function convertFromBase(
  baseJpy: number | null | undefined,
  target: DisplayCurrency,
  fx: FxRates
): number | null {
  if (baseJpy === null || baseJpy === undefined || Number.isNaN(baseJpy)) return null;
  switch (target) {
    case "JPY":
      return baseJpy;
    case "USD":
      return fx.usdJpy > 0 ? baseJpy / fx.usdJpy : null;
    case "SGD":
      return fx.sgdJpy > 0 ? baseJpy / fx.sgdJpy : null;
    /*
     * LOCAL は「換算しない」という選択なので、円換算値からは復元できない。
     * 呼び出し側が現地通貨の値をそのまま使うべきであることを示すため null を返す。
     */
    case "LOCAL":
      return null;
  }
}

/**
 * 表示に使う通貨コードを決める。
 * LOCAL のときだけ銘柄ごとの通貨を使う。
 */
export function resolveDisplayCurrencyCode(
  target: DisplayCurrency,
  localCurrency: string | null | undefined
): string {
  if (target === "LOCAL") return localCurrency || "JPY";
  return target;
}

/**
 * 補助表示（括弧内）に現地通貨を出すべきか判定する。
 *
 * 表示通貨と現地通貨が同じなら同じ数字が二度出るだけなので出さない。
 * 例: USD 表示のときの米国株は補助不要、日本株は「$284,343（¥4530万）」と出す。
 */
export function shouldShowLocalHint(
  target: DisplayCurrency,
  localCurrency: string | null | undefined
): boolean {
  if (target === "LOCAL") return false;
  if (!localCurrency) return false;
  return localCurrency !== target;
}
