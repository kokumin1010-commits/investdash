import type { Broker, Market } from "../../shared/investing";

/**
 * 月別配当の銘柄内訳（配当カレンダー）。
 *
 * 「3 月に 650 万円入る」だけでは、どの銘柄がその金額を作っているのか分からない。
 * 減配リスクの確認や、特定の月に依存しすぎていないかの判断には
 * 銘柄まで下りた内訳が必要になる。
 *
 * 権利落ち月を基準にしている点は月別合計と同じ。実際の入金は
 * 権利確定から 2〜3 か月後になるため、画面側で注記する。
 */

/** その月に配当を出す保有 1 件分 */
export type DividendCalendarEntry = {
  /** holdings の id。同一銘柄を複数口座で持つ場合は口座ごとに別レコード */
  holdingId: number;
  symbol: string;
  tickerCode: string;
  name: string;
  market: Market;
  broker: Broker;
  currency: string;
  /** その月の受取額（現地通貨） */
  amount: number;
  /** その月の受取額（円換算） */
  amountBase: number;
  /** その月の受取額が年間受取額の何割か（0〜1）。年 1 回なら 1 */
  shareOfAnnual: number | null;
  /** 特別配当が含まれる銘柄か。含む場合は来期も同額とは限らない */
  hasSpecial: boolean;
  /** 利回りが実勢としてありえない水準か */
  yieldNeedsCheck: boolean;
};

/** 1 か月分のまとめ */
export type DividendCalendarMonth = {
  /** 0 = 1 月 */
  month: number;
  /** その月の合計受取額（円換算） */
  totalBase: number;
  /** 年間配当に対するその月の割合（%）。年間が 0 なら null */
  pctOfAnnual: number | null;
  /** 金額の大きい順に並んだ銘柄内訳 */
  entries: DividendCalendarEntry[];
};

/** 集計の入力。PositionView から必要な項目だけを受け取る */
export type CalendarInput = {
  id: number;
  symbol: string;
  tickerCode: string;
  name: string;
  market: Market;
  broker: Broker;
  currency: string;
  quantity: number;
  dividend: {
    /** 1 株あたりの月別配当（現地通貨・12 要素）。無ければ null */
    monthlyPerShare: number[] | null;
    /** 月別の受取額（円換算・12 要素）。無ければ null */
    monthlyIncomeBase: number[] | null;
    annualIncomeBase: number | null;
    hasSpecial: boolean;
    yieldNeedsCheck: boolean;
  } | null;
};

/**
 * 保有一覧から月別の銘柄内訳を作る。
 *
 * 12 か月分の配列を必ず返す（配当が無い月は entries が空）。
 * 「その月は配当が無い」ことも情報なので、月を落とさない。
 *
 * @param items 口座レコード単位の保有
 */
export function buildDividendCalendar(items: CalendarInput[]): DividendCalendarMonth[] {
  const months: DividendCalendarMonth[] = Array.from({ length: 12 }, (_, month) => ({
    month,
    totalBase: 0,
    pctOfAnnual: null,
    entries: [],
  }));

  for (const it of items) {
    const d = it.dividend;
    if (!d) continue;
    const monthlyBase = d.monthlyIncomeBase;
    if (!monthlyBase || monthlyBase.length !== 12) continue;

    const perShare = d.monthlyPerShare;
    const annual = d.annualIncomeBase;

    for (let m = 0; m < 12; m++) {
      const base = monthlyBase[m];
      if (!Number.isFinite(base) || base <= 0) continue;

      /*
       * 現地通貨の額は 1 株配当 × 株数で求める。円換算額から逆算すると
       * 為替レートを再度持ち回る必要があり、丸め誤差も乗るため使わない。
       */
      const local =
        perShare && perShare.length === 12 && Number.isFinite(perShare[m])
          ? perShare[m] * it.quantity
          : base;

      months[m].totalBase += base;
      months[m].entries.push({
        holdingId: it.id,
        symbol: it.symbol,
        tickerCode: it.tickerCode,
        name: it.name,
        market: it.market,
        broker: it.broker,
        currency: it.currency,
        amount: local,
        amountBase: base,
        shareOfAnnual: annual !== null && annual > 0 ? base / annual : null,
        hasSpecial: d.hasSpecial,
        yieldNeedsCheck: d.yieldNeedsCheck,
      });
    }
  }

  // 年間合計は 12 か月の合計から求める（呼び出し側と一致することを保証する）
  const annualTotal = months.reduce((acc, m) => acc + m.totalBase, 0);

  for (const m of months) {
    m.entries.sort((a, b) => b.amountBase - a.amountBase);
    m.pctOfAnnual = annualTotal > 0 ? (m.totalBase / annualTotal) * 100 : null;
  }

  return months;
}
