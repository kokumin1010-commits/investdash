/**
 * 利息で増える現金性資産（貨幣市場基金・現金宝など）の集計。
 *
 * 株式と分けて扱う理由:
 *   1. 元本がほぼ動かないので「含み損益」という考え方が当てはまらない
 *   2. 収益の源泉が利率であり、減配リスクのある配当とは性質が違う
 *   3. 借入と比べるべき相手であり、株式時価に混ぜると
 *      レバレッジの実態（借金で株を買っているのか現金を置いているのか）が見えなくなる
 *
 * 富途香港の現金宝は年約 3.4% で毎日利息が付き、元本に組み入れられる（複利）。
 */
import type { InterestAsset } from "../../drizzle/schema";
import { convertToJpy, type FxRates } from "./fx";

/** 1 年を何日として複利計算するか。日次で付利される商品なので 365 日で扱う */
const DAYS_PER_YEAR = 365;

export type InterestAssetView = {
  id: number;
  broker: string;
  name: string;
  currency: string;
  /** 現在の評価額（現地通貨） */
  amount: number;
  /** 円換算した評価額。レートが無い通貨では null */
  amountBase: number | null;
  /** 記録時点の年換算利回り（%） */
  annualRatePct: number | null;
  /** 前日の受取利息（現地通貨） */
  dailyIncome: number | null;
  /** 累計収益（現地通貨） */
  cumulativeIncome: number | null;
  /** 累計収益の円換算 */
  cumulativeIncomeBase: number | null;
  /**
   * 表示中の利率で 1 年持ち続けた場合の見込み利息（現地通貨）。
   * 複利なら日次複利、単利なら単純計算。
   */
  projectedAnnualIncome: number | null;
  /** 見込み利息の円換算 */
  projectedAnnualIncomeBase: number | null;
  /** 前日利息から逆算した実績利回り（%）。記録値との食い違いに気付くために出す */
  impliedRatePct: number | null;
  compounding: boolean;
  capturedAt: Date;
  notes: string | null;
};

export type InterestAssetSummary = {
  /** 円換算した合計評価額 */
  totalBase: number;
  /** 1 年間の見込み利息（円換算） */
  projectedAnnualIncomeBase: number;
  /** 加重平均の年利回り（%）。円換算した額で重みを付ける */
  weightedRatePct: number | null;
  /** 累計収益の合計（円換算） */
  cumulativeIncomeBase: number;
  /** 通貨別の内訳 */
  byCurrency: { currency: string; amount: number; amountBase: number }[];
  /** 換算できなかった通貨があるか（合計が実態より小さくなる） */
  hasUnconvertible: boolean;
  count: number;
};

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 年利から 1 年分の見込み利息を出す。
 *
 * 複利の場合は日次で元本に組み入れられるため、
 * 表示利率（年換算）をそのまま掛けるより多くなる。
 * 例: 3.4% を日次複利で回すと実質 3.4585%。
 */
export function projectAnnualIncome(
  amount: number,
  annualRatePct: number | null,
  compounding: boolean
): number | null {
  if (annualRatePct === null || !Number.isFinite(annualRatePct)) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const r = annualRatePct / 100;
  if (!compounding) return amount * r;
  const daily = r / DAYS_PER_YEAR;
  return amount * (Math.pow(1 + daily, DAYS_PER_YEAR) - 1);
}

/**
 * 前日の受取利息から年利を逆算する。
 *
 * 記録した利率が古くなっていたり、入力を間違えていた場合に
 * 実績とのずれで気付けるようにする。
 */
export function impliedAnnualRate(amount: number, dailyIncome: number | null): number | null {
  if (dailyIncome === null || !Number.isFinite(dailyIncome)) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return (dailyIncome / amount) * DAYS_PER_YEAR * 100;
}

export function buildInterestAssetViews(
  rows: InterestAsset[],
  fx: FxRates
): InterestAssetView[] {
  return rows.map(r => {
    const amount = num(r.amount) ?? 0;
    const annualRatePct = num(r.annualRatePct);
    const dailyIncome = num(r.dailyIncome);
    const cumulativeIncome = num(r.cumulativeIncome);
    const projected = projectAnnualIncome(amount, annualRatePct, r.compounding);
    return {
      id: r.id,
      broker: r.broker,
      name: r.name,
      currency: r.currency,
      amount,
      amountBase: convertToJpy(amount, r.currency, fx),
      annualRatePct,
      dailyIncome,
      cumulativeIncome,
      cumulativeIncomeBase: convertToJpy(cumulativeIncome, r.currency, fx),
      projectedAnnualIncome: projected,
      projectedAnnualIncomeBase: convertToJpy(projected, r.currency, fx),
      impliedRatePct: impliedAnnualRate(amount, dailyIncome),
      compounding: r.compounding,
      capturedAt: r.capturedAt,
      notes: r.notes,
    };
  });
}

export function summarizeInterestAssets(views: InterestAssetView[]): InterestAssetSummary {
  let totalBase = 0;
  let projectedBase = 0;
  let cumulativeBase = 0;
  let hasUnconvertible = false;
  const byCurrency = new Map<string, { amount: number; amountBase: number }>();

  for (const v of views) {
    if (v.amountBase === null) {
      // レートが無い通貨は合計に入れない。1 円として混ぜると総資産が壊れるため
      hasUnconvertible = true;
    } else {
      totalBase += v.amountBase;
    }
    if (v.projectedAnnualIncomeBase !== null) projectedBase += v.projectedAnnualIncomeBase;
    if (v.cumulativeIncomeBase !== null) cumulativeBase += v.cumulativeIncomeBase;

    const cur = v.currency.toUpperCase();
    const prev = byCurrency.get(cur) ?? { amount: 0, amountBase: 0 };
    byCurrency.set(cur, {
      amount: prev.amount + v.amount,
      amountBase: prev.amountBase + (v.amountBase ?? 0),
    });
  }

  return {
    totalBase,
    projectedAnnualIncomeBase: projectedBase,
    // 見込み利息 ÷ 元本。額で重みを付けた平均になる
    weightedRatePct: totalBase > 0 ? (projectedBase / totalBase) * 100 : null,
    cumulativeIncomeBase: cumulativeBase,
    byCurrency: Array.from(byCurrency.entries())
      .map(([currency, v]) => ({ currency, ...v }))
      .sort((a, b) => b.amountBase - a.amountBase),
    hasUnconvertible,
    count: views.length,
  };
}
