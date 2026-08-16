/**
 * 借入金利（マージンローン）の計算。
 *
 * IBKR の金利は**階層別の加重平均**で決まる（累進課税と同じ方式）。
 * 公式説明: "IBKR uses a blended rate based on the tiers below. For example,
 * for a balance over USD 1,000,000, the first 100,000 is charged at the Tier I
 * rate, the next 900,000 at the Tier II rate, etc."
 *
 * つまり 2.29 億円を借りていても全額に最上位の利率が適用されるわけではなく、
 * 最初の 1,100 万円は 2.330%、次の 1 億 300 万円は 1.830% と段階的に計算する。
 * 最上位の利率だけで概算すると年間の利息を 30 万円ほど過小に見積もることになる。
 *
 * また金利は**借入通貨**のレートで決まる。IBKR の画面は基軸通貨（SGD）に
 * 換算した額を表示するが、実際に借りているのが日本円なら JPY のレートが適用される。
 *
 * 詳細と出典は docs/ibkr-margin-interest.md を参照。
 */

/** 金利の階層 1 段分 */
export type InterestTier = {
  /** この階層の上限額（借入通貨）。null は上限なし */
  upTo: number | null;
  /** 年率（%）。ベンチマークレートを含んだ実効値 */
  annualRatePct: number;
};

/**
 * IBKR Pro の階層別金利（2026-08-16 時点）。
 *
 * 通貨ごとにベンチマークレートと階層の区切りが異なる。
 * ここに定義がない通貨は金利を計算せず「不明」として扱う
 * （推測値で計算すると誤った判断につながるため）。
 */
export const IBKR_MARGIN_TIERS: Record<string, InterestTier[]> = {
  /*
   * JPY: ベンチマーク 0.830%。階層のスプレッドは +1.5% / +1.0% / +0.75% / +0.5%。
   */
  JPY: [
    { upTo: 11_000_000, annualRatePct: 2.33 },
    { upTo: 114_000_000, annualRatePct: 1.83 },
    { upTo: 5_700_000_000, annualRatePct: 1.58 },
    { upTo: 23_000_000_000, annualRatePct: 1.33 },
    { upTo: null, annualRatePct: 1.33 },
  ],
  /* USD: ベンチマーク 4.33%。参考として持つ（現在は JPY 借入のみ） */
  USD: [
    { upTo: 100_000, annualRatePct: 5.83 },
    { upTo: 1_000_000, annualRatePct: 5.33 },
    { upTo: 50_000_000, annualRatePct: 5.08 },
    { upTo: 200_000_000, annualRatePct: 4.83 },
    { upTo: null, annualRatePct: 4.83 },
  ],
  /* SGD: ベンチマーク 1.319%。参考として持つ */
  SGD: [
    { upTo: 130_000, annualRatePct: 2.819 },
    { upTo: 1_300_000, annualRatePct: 2.319 },
    { upTo: 65_000_000, annualRatePct: 2.069 },
    { upTo: null, annualRatePct: 1.819 },
  ],
};

export type MarginInterestResult = {
  /** 借入額（借入通貨、正の数） */
  borrowed: number;
  /** 借入通貨 */
  currency: string;
  /** 年間の支払利息（借入通貨） */
  annualInterest: number;
  /**
   * 加重平均の年率（%）。
   * 「実際に何 % で借りているか」を一つの数字で示す。
   */
  effectiveRatePct: number;
  /** 階層ごとの内訳（画面で計算根拠を示すため） */
  breakdown: Array<{
    /** この階層に割り当てられた額 */
    amount: number;
    annualRatePct: number;
    /** この階層分の年間利息 */
    interest: number;
  }>;
};

/**
 * 階層別の加重平均で年間利息を計算する。
 *
 * @param borrowed 借入額（正の数）。0 以下なら利息 0
 * @param currency 借入通貨
 * @param tiers 階層テーブル。省略時は通貨に応じた IBKR の既定値
 * @returns 通貨の階層定義が無い場合は null
 */
export function computeMarginInterest(
  borrowed: number,
  currency: string,
  tiers?: InterestTier[]
): MarginInterestResult | null {
  const code = currency.trim().toUpperCase();
  const table = tiers ?? IBKR_MARGIN_TIERS[code];
  if (!table || table.length === 0) return null;
  if (!Number.isFinite(borrowed) || borrowed <= 0) {
    return {
      borrowed: 0,
      currency: code,
      annualInterest: 0,
      effectiveRatePct: 0,
      breakdown: [],
    };
  }

  const breakdown: MarginInterestResult["breakdown"] = [];
  let remaining = borrowed;
  let lowerBound = 0;
  let annualInterest = 0;

  for (const tier of table) {
    if (remaining <= 0) break;
    /*
     * この階層が受け持てる幅。upTo は「借入総額の累計」に対する境界なので、
     * 直前の境界を引いて幅を出す。上限なしの階層は残り全部を受け持つ。
     */
    const capacity = tier.upTo === null ? remaining : Math.max(0, tier.upTo - lowerBound);
    if (capacity <= 0) {
      lowerBound = tier.upTo ?? lowerBound;
      continue;
    }
    const amount = Math.min(remaining, capacity);
    const interest = amount * (tier.annualRatePct / 100);
    breakdown.push({ amount, annualRatePct: tier.annualRatePct, interest });
    annualInterest += interest;
    remaining -= amount;
    lowerBound = tier.upTo ?? lowerBound;
  }

  return {
    borrowed,
    currency: code,
    annualInterest,
    effectiveRatePct: (annualInterest / borrowed) * 100,
    breakdown,
  };
}

/*
 * 判定コードとそのラベル・配色は shared/investing.ts に置き、画面と共通で使う。
 * ここで別に定義すると、片方だけ値を増やしたときに表示が欠ける
 * （MarginRisk で実際に起きたため同じ形に揃えている）。
 */
import type { CarryVerdictCode } from "../../shared/investing";

export type CarryVerdict = CarryVerdictCode;

export type CarryResult = {
  /** 年間の受取配当（基準通貨・税引前） */
  annualDividendBase: number;
  /** 年間の支払利息（基準通貨） */
  annualInterestBase: number;
  /** 差額。プラスなら配当が金利を上回っている */
  netCarryBase: number;
  /**
   * 配当が金利の何倍か。
   * 1.0 なら配当がちょうど金利を賄える水準。
   * 金利が 0 の場合は null（比率が定義できない）。
   */
  coverageRatio: number | null;
  verdict: CarryVerdict;
};

/**
 * 配当が金利負担を上回っているかを判定する。
 *
 * しきい値の考え方:
 * - 1.2 倍以上 … 配当だけで金利を余裕をもって賄える（POSITIVE）
 * - 1.0〜1.2 倍 … 賄えてはいるが余裕が小さい。減配や金利上昇で逆転する（THIN）
 * - 1.0 倍未満 … 配当だけでは足りず、差額は株価上昇で回収する必要がある（NEGATIVE）
 *
 * NEGATIVE でも即座に問題とは限らない（値上がり益を狙う戦略なら想定内）が、
 * 「持っているだけで現金が出ていく状態」であることは把握しておく必要がある。
 */
export function evaluateCarry(
  annualDividendBase: number,
  annualInterestBase: number
): CarryResult {
  const netCarryBase = annualDividendBase - annualInterestBase;
  const coverageRatio =
    annualInterestBase > 0 ? annualDividendBase / annualInterestBase : null;

  let verdict: CarryVerdict;
  if (annualInterestBase <= 0) {
    // 借入がなければ配当はすべて手取り
    verdict = "POSITIVE";
  } else if (coverageRatio !== null && coverageRatio >= 1.2) {
    verdict = "POSITIVE";
  } else if (coverageRatio !== null && coverageRatio >= 1.0) {
    verdict = "THIN";
  } else {
    verdict = "NEGATIVE";
  }

  return { annualDividendBase, annualInterestBase, netCarryBase, coverageRatio, verdict };
}
