export type DividendDetailInput = {
  quantity: number;
  perShare: number;
  annualIncomeBase: number | null;
  yieldPct: number | null;
  recurringPerShare: number;
  recurringYieldPct: number | null;
  hasSpecial: boolean;
  updatedAt: Date | string | null;
};

export type DividendDetailView = {
  status: "UNKNOWN" | "NONE" | "PAYING";
  forecastPerShare: number | null;
  forecastYieldPct: number | null;
  annualIncomeLocal: number | null;
  annualIncomeBase: number | null;
  hasSpecial: boolean;
  basisLabel: string;
  updatedAt: Date | string | null;
};

/**
 * 持仓详情展示用的配当数字。
 *
 * 当前数据库保存的是直近 12 个月支付实绩，不是公司指导值。因此“予想”采用
 * 特别配当剔除后的 recurring 水准，并始终把基准写成实绩ベース。
 */
export function buildDividendDetailView(
  dividend: DividendDetailInput | null
): DividendDetailView {
  if (!dividend) {
    return {
      status: "UNKNOWN",
      forecastPerShare: null,
      forecastYieldPct: null,
      annualIncomeLocal: null,
      annualIncomeBase: null,
      hasSpecial: false,
      basisLabel: "配当データ未取得",
      updatedAt: null,
    };
  }

  const forecastPerShare = Math.max(0, dividend.recurringPerShare);
  const annualIncomeLocal = forecastPerShare * Math.max(0, dividend.quantity);
  const annualIncomeBase =
    dividend.annualIncomeBase === null
      ? null
      : dividend.perShare > 0
        ? dividend.annualIncomeBase * (forecastPerShare / dividend.perShare)
        : 0;

  return {
    status: forecastPerShare > 0 ? "PAYING" : "NONE",
    forecastPerShare,
    forecastYieldPct: dividend.recurringYieldPct ?? dividend.yieldPct,
    annualIncomeLocal,
    annualIncomeBase,
    hasSpecial: dividend.hasSpecial,
    basisLabel: dividend.hasSpecial
      ? "直近12か月実績ベース・特別配当除外・税引前"
      : "直近12か月実績ベース・税引前",
    updatedAt: dividend.updatedAt,
  };
}
