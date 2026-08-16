import { marketLabel, type Market } from "../../shared/investing";

/**
 * 国・市場別の資産集計。
 *
 * 米国株の損益は「株価の変動」と「為替の変動」が混ざる。円換算後の数字だけを
 * 見ると、株価が下がっていても円安で増えて見える（逆もある）ため、
 * 現地通貨ベースの損益も併せて持たせて切り分けられるようにする。
 */
export type MarketSlice = {
  key: Market;
  label: string;
  /** 円換算の評価額 */
  value: number;
  /** 総資産に対する構成比（%） */
  pct: number;
  /** 銘柄数（同一銘柄を複数口座で持つ場合は 1 と数える） */
  count: number;
  /** 円換算の取得原価 */
  cost: number;
  /** 円換算の含み損益 */
  pnl: number;
  /** 円換算の含み損益率（%）。取得原価が 0 なら null */
  pnlPct: number | null;
  /** 現地通貨。JP なら JPY、US なら USD */
  currency: string;
  /**
   * 現地通貨ベースの含み損益。円換算前の「株価の変動だけ」による損益。
   * 日本株では pnl と同じ値になる。
   */
  localPnl: number;
  /** 現地通貨ベースの含み損益率（%） */
  localPnlPct: number | null;
  /**
   * 現地通貨と基準通貨（円）が異なるか。
   * true の場合、円換算後の損益には為替変動も含まれることを画面で注意喚起する。
   *
   * 為替の影響額そのものは算出しない。正確に求めるには各銘柄を買った時点の
   * 為替レートが必要だが、証券アプリのスクリーンショットには含まれないため、
   * 現在レートで逆算すると必ず 0 になり誤解を招く。
   */
  isForeign: boolean;
  /** その市場から年間いくら配当が入るか（円換算・税引前） */
  dividendIncomeBase: number;
  /** その市場の配当利回り（%）。円換算の評価額に対する比率 */
  dividendYieldPct: number | null;
  /**
   * 月別の受取配当（円換算）。長さ 12（0 = 1 月）。
   * 日本株は 3 月・9 月、米国株は四半期ごとと傾向が異なるため、
   * 市場ごとに分けて見ると入金月の偏りの原因が分かる。
   */
  dividendMonthlyBase: number[];
};

type MarketInput = {
  market: Market;
  currency: string;
  /** 円換算の評価額。株価未取得なら null */
  marketValueBase: number | null;
  /** 円換算の取得原価 */
  costValueBase: number;
  /** 現地通貨の評価額。株価未取得なら null */
  marketValue: number | null;
  /** 現地通貨の取得原価 */
  costValue: number;
  /** 年間受取配当（円換算）。未取得なら null */
  dividend?: {
    annualIncomeBase: number | null;
    /** 月別の受取額（円換算）。長さ 12 */
    monthlyIncomeBase?: number[] | null;
  } | null;
};

/** 市場の表示順。日本株を先頭に、その他を末尾にする */
const MARKET_ORDER: Record<Market, number> = { JP: 0, US: 1, SG: 2, OTHER: 3 };

/**
 * 銘柄単位の保有から市場別の集計を作る。
 *
 * @param items 銘柄単位（同一銘柄を複数口座で持つ場合は合算済み）の保有
 * @param totalValueBase 構成比の分母になる総評価額（円換算）
 */
export function buildMarketSlices(items: MarketInput[], totalValueBase: number): MarketSlice[] {
  const map = new Map<
    MarketSlice["key"],
    {
      value: number;
      cost: number;
      count: number;
      localValue: number;
      localCost: number;
      currency: string;
      dividendIncome: number;
      dividendMonthly: number[];
    }
  >();

  for (const it of items) {
    const cur = map.get(it.market) ?? {
      value: 0,
      cost: 0,
      count: 0,
      localValue: 0,
      localCost: 0,
      currency: it.currency,
      dividendIncome: 0,
      // 12 か月分の受取額を足し込む器。銘柄ごとに加算する
      dividendMonthly: Array<number>(12).fill(0),
    };
    cur.value += it.marketValueBase ?? 0;
    cur.cost += it.costValueBase;
    cur.count += 1;
    cur.localValue += it.marketValue ?? 0;
    cur.localCost += it.costValue;
    cur.dividendIncome += it.dividend?.annualIncomeBase ?? 0;
    const monthly = it.dividend?.monthlyIncomeBase;
    if (monthly && monthly.length === 12) {
      for (let i = 0; i < 12; i++) cur.dividendMonthly[i] += monthly[i] ?? 0;
    }
    map.set(it.market, cur);
  }

  return Array.from(map.entries())
    .map(([key, v]) => {
      const pnl = v.value - v.cost;
      const localPnl = v.localValue - v.localCost;
      return {
        key,
        label: marketLabel(key),
        value: v.value,
        pct: totalValueBase > 0 ? (v.value / totalValueBase) * 100 : 0,
        count: v.count,
        cost: v.cost,
        pnl,
        pnlPct: v.cost > 0 ? (pnl / v.cost) * 100 : null,
        currency: v.currency,
        localPnl,
        localPnlPct: v.localCost > 0 ? (localPnl / v.localCost) * 100 : null,
        isForeign: v.currency !== "JPY",
        dividendIncomeBase: v.dividendIncome,
        dividendYieldPct: v.value > 0 ? (v.dividendIncome / v.value) * 100 : null,
        dividendMonthlyBase: v.dividendMonthly,
      };
    })
    .sort((a, b) => MARKET_ORDER[a.key] - MARKET_ORDER[b.key]);
}
