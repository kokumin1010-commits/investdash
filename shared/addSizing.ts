/**
 * 1 回の買い増しに充てる金額を資産全体から決める。
 *
 * 【なぜ固定額にしないか】
 * 「1 回 100 万円」のような固定額は、資産が増えても減っても同じ額を
 * 出すことになる。純資産 7.26 億円に対する 100 万円は 0.14% で影響が
 * 無いに等しく、逆に資産が縮んだ局面では過大になる。
 *
 * 【何を基準にするか】
 * 現金性資産（貨幣市場基金 9,405 万円・利回り 3.46%）を原資の上限とし、
 * その一部を 1 回分とする。借入をこれ以上増やす前提にはしない。借入の
 * 実効金利 1.73% は現金の利回り 3.46% を下回っているので、現金を崩す
 * より借入を使う方が数字の上では有利に見えるが、それはレバレッジを
 * 上げる判断であり「1 回いくら買うか」とは別の意思決定になる。
 * ここでは既存の余力の中で配分を決めることに限定する。
 *
 * 【段階的に買う前提】
 * 1 回で使い切らない。価格帯プランは 3〜4 段に分かれているので、
 * 原資を段数で割った額が 1 段分になる。全額を 1 回で入れると、
 * さらに下がったときに買う余力がなくなる。
 */

/** 1 銘柄に許容する構成比の上限（%）。これを超える買い増しは勧めない */
export const MAX_POSITION_SHARE_PCT = 5;

/** 想定する買い増しの段数。価格帯プランの標準的な段数に合わせる */
export const ADD_STEPS = 4;

/**
 * 現金性資産のうち買い増しに回してよい割合（%）。
 *
 * 全額を株に回すと、追証や生活費の緩衝が無くなる。現金の利回りが
 * 3.46% で借入金利を上回っている状況では、現金を残すこと自体に
 * 意味がある（借入を返さずに置いておく方が有利という判断と同じ理屈）。
 */
export const DEPLOYABLE_CASH_PCT = 50;

export type AddSizing = {
  /** 買い増しに回せる原資（基準通貨） */
  deployableBase: number;
  /** 1 段あたりの金額（基準通貨） */
  perStepBase: number;
  /** この銘柄の現在の構成比（%）。未保有なら 0 */
  currentSharePct: number;
  /** 上限までに追加できる金額（基準通貨）。既に超えているなら 0 */
  roomToCapBase: number;
  /**
   * 実際に提案してよい 1 回分の金額。
   * 1 段分と上限までの余地の小さい方。上限を超える提案はしない。
   */
  suggestedBase: number;
  /** 上限に達しているか。true なら買い増しではなく他の銘柄を検討すべき */
  atCap: boolean;
};

/**
 * @param totalValueBase 株式時価の合計（基準通貨）
 * @param interestAssetsBase 現金性資産（基準通貨）
 * @param cashBase 証券口座の預り金（基準通貨）
 * @param holdingValueBase この銘柄の評価額（基準通貨）。未保有なら 0
 */
export function computeAddSizing(
  totalValueBase: number,
  interestAssetsBase: number,
  cashBase: number,
  holdingValueBase: number
): AddSizing | null {
  if (!Number.isFinite(totalValueBase) || totalValueBase <= 0) return null;

  const cashPool = Math.max(0, (interestAssetsBase || 0) + (cashBase || 0));
  const deployableBase = (cashPool * DEPLOYABLE_CASH_PCT) / 100;
  const perStepBase = deployableBase / ADD_STEPS;

  const currentSharePct = ((holdingValueBase || 0) / totalValueBase) * 100;

  /*
   * 上限までの余地は「買い増した後の構成比」で考える。
   * 分母（全体）も増えるため、単純に上限 % × 現在の全体 − 現在額 とすると
   * 実際には上限を超えない額まで小さく出る。
   *
   *   (holding + x) / (total + x) = cap/100
   *   → x = (cap/100 × total − holding) / (1 − cap/100)
   */
  const cap = MAX_POSITION_SHARE_PCT / 100;
  const rawRoom = (cap * totalValueBase - (holdingValueBase || 0)) / (1 - cap);
  const roomToCapBase = Math.max(0, rawRoom);

  return {
    deployableBase,
    perStepBase,
    currentSharePct,
    roomToCapBase,
    suggestedBase: Math.min(perStepBase, roomToCapBase),
    atCap: roomToCapBase <= 0,
  };
}
