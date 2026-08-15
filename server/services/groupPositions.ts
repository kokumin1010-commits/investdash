import type { PositionView } from "./portfolio";

/**
 * 同一銘柄を複数の証券口座で保有している場合の合算ビュー。
 *
 * 例: ヤクルトを moomoo で 400 株、楽天 iSPEED で 1,800 株保有している場合、
 * 合計 2,200 株の 1 グループとして扱い、内訳に口座ごとの 2 件を持つ。
 *
 * 投資判断では両方の視点が必要になる。
 * - 合計: その銘柄に全体でいくら賭けているか（集中リスクの把握）
 * - 内訳: どちらの口座の買いが儲かっているか（口座ごとの成績）
 */
export type GroupedPosition = {
  symbol: string;
  tickerCode: string;
  name: string;
  market: PositionView["market"];
  currency: string;
  sector: string | null;
  industry: string | null;
  /** 合計株数 */
  quantity: number;
  /** 加重平均取得単価。総取得額 ÷ 総株数 */
  avgCost: number;
  currentPrice: number | null;
  /** 52 週高値・安値。同一銘柄なので口座に依存しない */
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** 合計評価額（現地通貨） */
  marketValue: number | null;
  costValue: number;
  pnl: number | null;
  pnlPct: number | null;
  dayChangePct: number | null;
  /** 合計評価額（基準通貨 JPY 換算） */
  marketValueBase: number | null;
  costValueBase: number;
  /** ポートフォリオ全体に対する構成比 */
  weightPct: number | null;
  /** この銘柄を保有している口座の一覧（評価額の降順） */
  brokers: PositionView["broker"][];
  /** 口座ごとの明細。1 件だけなら口座をまたいでいない */
  entries: PositionView[];
  /** 複数口座にまたがっているか */
  isSplit: boolean;
  /**
   * シグナル・ニュース・投資カードは銘柄単位の情報なので、
   * どの口座で持っていても同じものを参照する
   */
  signal: PositionView["signal"];
  hasCard: boolean;
  newsCount: number;
  negativeNewsCount: number;
  priceUpdatedAt: Date | null;
};

/** 合計 = 各口座の単純合計。null（価格未取得）は 0 として扱わず null を伝播させない */
function sumOrNull(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

/**
 * 保有ポジションをシンボル単位でまとめる。
 *
 * 並び順は合計評価額の降順。口座内訳も評価額の降順で並べる。
 */
export function groupPositionsBySymbol(
  positions: PositionView[],
  totalValueBase: number
): GroupedPosition[] {
  const bySymbol = new Map<string, PositionView[]>();
  for (const p of positions) {
    const list = bySymbol.get(p.symbol) ?? [];
    list.push(p);
    bySymbol.set(p.symbol, list);
  }

  const groups = Array.from(bySymbol.values()).map(entriesRaw => {
    // 内訳は評価額の大きい口座から並べる
    const entries = [...entriesRaw].sort(
      (a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0)
    );
    const head = entries[0];

    const quantity = entries.reduce((acc, e) => acc + e.quantity, 0);
    const costValue = entries.reduce((acc, e) => acc + e.costValue, 0);
    const costValueBase = entries.reduce((acc, e) => acc + e.costValueBase, 0);
    const marketValue = sumOrNull(entries.map(e => e.marketValue));
    const marketValueBase = sumOrNull(entries.map(e => e.marketValueBase));
    const pnl = marketValue === null ? null : marketValue - costValue;

    // 現在値は同一銘柄なのでどの口座でも同じ。取得できているものを採用する
    const currentPrice = entries.find(e => e.currentPrice !== null)?.currentPrice ?? null;
    const dayChangePct = entries.find(e => e.dayChangePct !== null)?.dayChangePct ?? null;
    const fiftyTwoWeekHigh = entries.find(e => e.fiftyTwoWeekHigh !== null)?.fiftyTwoWeekHigh ?? null;
    const fiftyTwoWeekLow = entries.find(e => e.fiftyTwoWeekLow !== null)?.fiftyTwoWeekLow ?? null;

    // 価格更新時刻は最も新しいものを代表とする
    const priceUpdatedAt = entries.reduce<Date | null>((acc, e) => {
      if (!e.priceUpdatedAt) return acc;
      if (!acc) return e.priceUpdatedAt;
      return e.priceUpdatedAt > acc ? e.priceUpdatedAt : acc;
    }, null);

    return {
      symbol: head.symbol,
      tickerCode: head.tickerCode,
      name: head.name,
      market: head.market,
      currency: head.currency,
      sector: entries.find(e => e.sector)?.sector ?? null,
      industry: entries.find(e => e.industry)?.industry ?? null,
      quantity,
      // 加重平均取得単価。口座ごとに単価が違うため単純平均では誤る
      avgCost: quantity > 0 ? costValue / quantity : 0,
      currentPrice,
      fiftyTwoWeekHigh,
      fiftyTwoWeekLow,
      marketValue,
      costValue,
      pnl,
      pnlPct: pnl === null || costValue === 0 ? null : (pnl / costValue) * 100,
      dayChangePct,
      marketValueBase,
      costValueBase,
      weightPct:
        totalValueBase > 0 && marketValueBase !== null
          ? (marketValueBase / totalValueBase) * 100
          : null,
      brokers: entries.map(e => e.broker),
      entries,
      isSplit: entries.length > 1,
      // 銘柄単位の情報はどの口座でも同じ。生成済みのものを拾う
      signal: entries.find(e => e.signal !== null)?.signal ?? null,
      hasCard: entries.some(e => e.hasCard),
      newsCount: Math.max(...entries.map(e => e.newsCount)),
      negativeNewsCount: Math.max(...entries.map(e => e.negativeNewsCount)),
      priceUpdatedAt,
    } satisfies GroupedPosition;
  });

  return groups.sort((a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0));
}
