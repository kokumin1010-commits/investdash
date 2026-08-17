/**
 * 「買いたい値段」が現在値からどれだけ離れているかを判定する。
 *
 * ウォッチリストの目的は買い場を逃さないことなので、目標価格が極端に低いと
 * 目的そのものが達成できない。実測では INPEX の目標が 1,900 円に対し
 * 現在値 3,765 円（-49.5%）で、半値になるのを待つのは実質「買わない」と同じ。
 * その状態を「待っている」と見えたままにしておくと、機会損失に気付けない。
 *
 * 画面とサーバーの両方で同じ判定が必要なため純関数として切り出す。
 * 同じ式を 2 か所に書くと、片方だけ閾値を変えたときに画面の警告と
 * 作り直しの対象がずれる（警告は出るのに作り直しても直らない状態になる）。
 */

/** 目標価格の距離の区分 */
export type TargetDistanceLevel =
  /** 目標価格が未設定。距離は測れない */
  | "NO_TARGET"
  /** 現在値が目標以下。すでに買える水準 */
  | "REACHED"
  /** 現実的に届く範囲（0% 〜 -20%） */
  | "NEAR"
  /** 待つには遠い（-20% 〜 -30%）。届く可能性はあるが年単位になりうる */
  | "FAR"
  /** 遠すぎる（-30% 超）。待つことが実質「買わない」と同じ */
  | "TOO_FAR"
  /** 目標が現在値より高い（+10% 超）。下がるのを待つ意味がない */
  | "ABOVE_MARKET";

export type TargetDistance = {
  level: TargetDistanceLevel;
  /** 現在値から目標までの変化率（%）。負なら「あと N% 下がれば届く」 */
  gapPct: number | null;
  /** 作り直しを検討すべきか（TOO_FAR / ABOVE_MARKET） */
  needsRework: boolean;
};

/** 遠すぎるとみなす下落率の境目（%） */
export const TOO_FAR_THRESHOLD_PCT = -30;
/** 遠いとみなす下落率の境目（%） */
export const FAR_THRESHOLD_PCT = -20;
/**
 * 目標が現在値より高いと見なす境目（%）。
 * 0% ちょうどで切ると、株価が動いた直後に到達済みの銘柄が
 * 「目標が高すぎる」側に落ちて警告が点滅する。日々の値動きの幅を考えて
 * +10% までは到達済みとして扱う。
 */
export const ABOVE_MARKET_THRESHOLD_PCT = 10;

/**
 * @param currentPrice 現在値（現地通貨）
 * @param targetPrice 買いたい値段（現地通貨）。未設定なら null
 */
export function computeTargetDistance(
  currentPrice: number | null,
  targetPrice: number | null,
): TargetDistance {
  if (
    targetPrice === null ||
    currentPrice === null ||
    !Number.isFinite(targetPrice) ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return { level: "NO_TARGET", gapPct: null, needsRework: false };
  }

  /*
   * 分母は現在値にする。目標価格を分母にすると、現在 3,765 / 目標 1,900 で
   * -49.5% ではなく +98.2% という数字になり、「あと何 % 下がれば届くか」という
   * 実感と食い違う。注文の判断に使えない数字にはしない。
   */
  const gapPct = ((targetPrice - currentPrice) / currentPrice) * 100;

  if (gapPct > ABOVE_MARKET_THRESHOLD_PCT) {
    return { level: "ABOVE_MARKET", gapPct, needsRework: true };
  }
  if (gapPct >= 0) {
    return { level: "REACHED", gapPct, needsRework: false };
  }
  if (gapPct <= TOO_FAR_THRESHOLD_PCT) {
    return { level: "TOO_FAR", gapPct, needsRework: true };
  }
  if (gapPct <= FAR_THRESHOLD_PCT) {
    /*
     * FAR は警告するが作り直しの対象にはしない。-20% 台の調整は
     * 数年単位で見れば実際に起きるため、機械的に書き換えると
     * 本人が意図して置いた慎重な水準を壊してしまう。
     */
    return { level: "FAR", gapPct, needsRework: false };
  }
  return { level: "NEAR", gapPct, needsRework: false };
}

/** 区分の短い説明（画面のバッジに出す） */
export const TARGET_DISTANCE_LABELS: Record<TargetDistanceLevel, string> = {
  NO_TARGET: "目標なし",
  REACHED: "到達",
  NEAR: "現実的",
  FAR: "やや遠い",
  TOO_FAR: "遠すぎる",
  ABOVE_MARKET: "現在値より高い",
};

/** なぜ作り直すべきかの説明。数字だけ出しても何をすべきか分からない */
export function targetDistanceNote(d: TargetDistance): string | null {
  switch (d.level) {
    case "TOO_FAR":
      return `現在値から ${Math.abs(d.gapPct ?? 0).toFixed(1)}% 下がるのを待つ設定です。この水準まで待つことは実質「買わない」に近く、買い場を逃す恐れがあります。`;
    case "ABOVE_MARKET":
      return "目標価格が現在値より高いため、下がるのを待つ意味がありません。目標を見直してください。";
    case "FAR":
      return `届くまで ${Math.abs(d.gapPct ?? 0).toFixed(1)}% の下落が必要です。時間がかかる可能性を踏まえて判断してください。`;
    default:
      return null;
  }
}
