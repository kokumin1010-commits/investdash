/**
 * 借入金利と現金性資産の利回りの差（キャリー）を判定する。
 *
 * 「借入を返すか、現金で置いておくか」という判断に使う。
 * 現金の利回りが借入金利を上回っていれば、返済せず現金で置いた方が得。
 * 下回っていれば、その現金を返済に充てた方が利息の負担が減る。
 *
 * 画面側で式を書かずにここへ集約する。同じ計算が複数の画面に散ると、
 * 片方だけ符号を間違えても気付けない（有利と不利が逆に出る類の誤りは
 * 数字を見ただけでは判別しづらい）。
 */

export type CarrySpread = {
  /** 現金の利回りが借入金利以上か。true なら現金で置く方が有利 */
  favorable: boolean;
  /** 金利差（年率 %）。有利なら正、不利なら負 */
  spreadPct: number;
  /**
   * 金利差を金額に換算した年間の損得（基準通貨）。
   * 率だけでは規模が伝わらない。5.9 億円に対する 1.7% は年 1,000 万円規模になる。
   */
  spreadAmountBase: number;
};

/**
 * @param borrowingRatePct 借入の実効金利（年率 %）
 * @param cashRatePct 現金性資産の利回り（年率 %）
 * @param cashAssetsBase 現金性資産の額（基準通貨）
 */
export function computeCarrySpread(
  borrowingRatePct: number,
  cashRatePct: number,
  cashAssetsBase: number,
): CarrySpread | null {
  if (!Number.isFinite(borrowingRatePct) || !Number.isFinite(cashRatePct)) return null;
  if (!Number.isFinite(cashAssetsBase)) return null;

  const spreadPct = cashRatePct - borrowingRatePct;
  return {
    /*
     * 同率のときは有利側に含める。返済には手間と機会損失（現金の柔軟性を失う）が
     * 伴うため、損得が同じなら現金のまま置いておく判断が妥当。
     */
    favorable: spreadPct >= 0,
    spreadPct,
    spreadAmountBase: (cashAssetsBase * spreadPct) / 100,
  };
}
