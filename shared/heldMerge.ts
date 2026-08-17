/**
 * ウォッチリストと保有の突き合わせ。
 *
 * 【なぜ必要か】
 * AI の候補提案から一括で登録すると、既に持っている銘柄が
 * ウォッチリストに入ることがある。買った後に外し忘れる場合もある。
 * 「まだ持っていない」前提で目標価格を見ていると、実際には保有済みで
 * 買い増しの判断をすべき銘柄を新規購入として扱ってしまう。
 */

export type HeldPosition = {
  symbol: string;
  quantity: number;
  avgCost: number;
  broker: string;
};

export type HeldSummary = {
  quantity: number;
  /** 株数で重み付けした取得単価。単純平均だと少額の口座が過大に効く */
  avgCost: number;
  brokers: string[];
};

/** 同じ銘柄を複数口座で持っている場合を 1 件に畳む */
export function mergeHeldPositions(positions: HeldPosition[]): Map<string, HeldSummary> {
  const acc = new Map<string, { quantity: number; costTotal: number; brokers: string[] }>();
  for (const p of positions) {
    const cur = acc.get(p.symbol);
    if (cur) {
      cur.quantity += p.quantity;
      cur.costTotal += p.quantity * p.avgCost;
      if (!cur.brokers.includes(p.broker)) cur.brokers.push(p.broker);
    } else {
      acc.set(p.symbol, {
        quantity: p.quantity,
        costTotal: p.quantity * p.avgCost,
        brokers: [p.broker],
      });
    }
  }
  const out = new Map<string, HeldSummary>();
  acc.forEach((v, symbol) => {
    out.set(symbol, {
      quantity: v.quantity,
      avgCost: v.quantity > 0 ? v.costTotal / v.quantity : 0,
      brokers: v.brokers,
    });
  });
  return out;
}

/**
 * 保有している場合の損益率（%）。
 *
 * 取得原価が 0 以下の銘柄（原価回収済み）では率に意味がないため null。
 * 率で比較すると「+8,000%」のような数字になり、他の銘柄と並べられない。
 */
export function heldPnlPct(avgCost: number | null, price: number | null): number | null {
  if (avgCost === null || price === null || avgCost <= 0) return null;
  return ((price - avgCost) / avgCost) * 100;
}
