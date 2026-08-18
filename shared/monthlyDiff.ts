/**
 * 月ごとの保有記録から売買の差分を求める（純関数）。
 *
 * 保有は「今の状態」しか持たないため、月ごとの記録を突き合わせないと
 * 「新しく買った」「売った」「株数を増やした」を区別できない。
 * 円換算額が増えていても、それが値上がりなのか買い増しなのかが分からないと
 * 判断を誤る（値上がりだと思って安心していたら実は買い増していただけ、など）。
 */

export type MonthlyHoldingRow = {
  symbol: string;
  name: string;
  broker: string;
  quantity: number;
  avgCost: number;
  price: number | null;
  valueJpy: number | null;
};

export type DiffKind = "NEW" | "SOLD" | "ADDED" | "REDUCED" | "SAME";

export type MonthlyDiffRow = {
  symbol: string;
  name: string;
  broker: string;
  kind: DiffKind;
  /** 前月の株数（新規なら 0） */
  prevQuantity: number;
  /** 当月の株数（売却済みなら 0） */
  currQuantity: number;
  /** 株数の変化 */
  quantityDelta: number;
  /** 前月の評価額（JPY） */
  prevValueJpy: number | null;
  /** 当月の評価額（JPY） */
  currValueJpy: number | null;
  /** 評価額の変化（JPY） */
  valueDeltaJpy: number | null;
};

/**
 * 株数が同じかどうかの判定に持たせる余裕（0.5%）。
 *
 * 配当再投資や端株の調整で 0.01 株だけ動くことがあり、
 * これを「買い増し」と数えると本当の売買が埋もれる。
 */
const QTY_TOLERANCE = 0.005;

function keyOf(row: { symbol: string; broker: string }): string {
  return `${row.symbol}::${row.broker}`;
}

/**
 * 前月と当月の明細を突き合わせて差分を出す。
 *
 * 口座ごとに突き合わせるのは、同じ銘柄を複数口座で持っている場合に
 * 「IBKR で売って楽天で買った」という動きを潰さないため。
 * 銘柄単位で合計すると株数が同じに見えて変化が消える。
 */
export function diffMonthlyHoldings(
  prev: MonthlyHoldingRow[],
  curr: MonthlyHoldingRow[]
): MonthlyDiffRow[] {
  const prevMap = new Map<string, MonthlyHoldingRow>();
  for (const r of prev) prevMap.set(keyOf(r), r);
  const currMap = new Map<string, MonthlyHoldingRow>();
  for (const r of curr) currMap.set(keyOf(r), r);

  const keys = new Set<string>();
  prevMap.forEach((_v, k) => keys.add(k));
  currMap.forEach((_v, k) => keys.add(k));

  const out: MonthlyDiffRow[] = [];
  keys.forEach(k => {
    const p = prevMap.get(k);
    const c = currMap.get(k);
    const prevQty = p?.quantity ?? 0;
    const currQty = c?.quantity ?? 0;
    const delta = currQty - prevQty;

    let kind: DiffKind;
    if (!p && c) kind = "NEW";
    else if (p && !c) kind = "SOLD";
    else {
      // 相対で見る。1,000 株の銘柄と 1 株の銘柄で同じ絶対値を使うと
      // 大株数の銘柄の小さな調整を売買と誤認する。
      const basis = Math.max(prevQty, 1e-9);
      const ratio = Math.abs(delta) / basis;
      if (ratio <= QTY_TOLERANCE) kind = "SAME";
      else if (delta > 0) kind = "ADDED";
      else kind = "REDUCED";
    }

    const prevValue = p?.valueJpy ?? null;
    const currValue = c?.valueJpy ?? null;
    out.push({
      symbol: (c ?? p)!.symbol,
      name: (c ?? p)!.name,
      broker: (c ?? p)!.broker,
      kind,
      prevQuantity: prevQty,
      currQuantity: currQty,
      quantityDelta: delta,
      prevValueJpy: prevValue,
      currValueJpy: currValue,
      valueDeltaJpy:
        prevValue !== null && currValue !== null ? currValue - prevValue : null,
    });
  });

  // 変化のあったものを先に、金額の大きい順に並べる。
  // 変化なしが 100 件以上あるため、これを先に出すと肝心の売買が見えない。
  const rank: Record<DiffKind, number> = {
    NEW: 0,
    SOLD: 1,
    ADDED: 2,
    REDUCED: 3,
    SAME: 4,
  };
  return out.sort((a, b) => {
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
    const av = Math.abs(a.currValueJpy ?? a.prevValueJpy ?? 0);
    const bv = Math.abs(b.currValueJpy ?? b.prevValueJpy ?? 0);
    return bv - av;
  });
}

export type MonthlyChangeBreakdown = {
  /** 評価額の総変化 */
  totalDeltaJpy: number;
  /** 新規購入による増加 */
  newBuyJpy: number;
  /** 売却による減少（負の値） */
  soldJpy: number;
  /** 買い増しによる増加（取得原価の増加分で測る） */
  addedCostJpy: number;
  /** 一部売却による減少 */
  reducedJpy: number;
  /** 保有を変えていない銘柄の値動きによる増減 */
  priceMoveJpy: number;
};

/**
 * 評価額の変化を「売買によるもの」と「値動きによるもの」に分ける。
 *
 * これがないと「資産が 1 億円増えた」が値上がりなのか入金なのか分からない。
 * 長期保有では後者（値動き）だけが実力を表すため、区別する必要がある。
 */
export function breakdownMonthlyChange(rows: MonthlyDiffRow[]): MonthlyChangeBreakdown {
  let newBuy = 0;
  let sold = 0;
  let addedCost = 0;
  let reduced = 0;
  let priceMove = 0;
  let total = 0;

  for (const r of rows) {
    const prev = r.prevValueJpy ?? 0;
    const curr = r.currValueJpy ?? 0;
    total += curr - prev;

    if (r.kind === "NEW") newBuy += curr;
    else if (r.kind === "SOLD") sold -= prev;
    else if (r.kind === "SAME") priceMove += curr - prev;
    else if (r.kind === "ADDED") {
      /*
       * 買い増した分の増加は「増えた株数 × 当月の株価」で見積もる。
       * 差額の全部を買い増しに数えると、同時に起きた値上がり分まで
       * 買い増しに含まれてしまう。
       */
      const unit = r.currQuantity > 0 ? curr / r.currQuantity : 0;
      const buyPart = r.quantityDelta * unit;
      addedCost += buyPart;
      priceMove += curr - prev - buyPart;
    } else if (r.kind === "REDUCED") {
      const unit = r.prevQuantity > 0 ? prev / r.prevQuantity : 0;
      const sellPart = r.quantityDelta * unit; // 負の値
      reduced += sellPart;
      priceMove += curr - prev - sellPart;
    }
  }

  return {
    totalDeltaJpy: total,
    newBuyJpy: newBuy,
    soldJpy: sold,
    addedCostJpy: addedCost,
    reducedJpy: reduced,
    priceMoveJpy: priceMove,
  };
}

/** 対象月の文字列（例: "2026-07"）を作る。JST の暦月で判断する。 */
export function periodYmOf(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** 1 つ前の月を返す（例: "2026-07" → "2026-06"）。 */
export function previousPeriodYm(ym: string): string {
  const [ys, ms] = ym.split("-");
  let y = Number(ys);
  let m = Number(ms) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}
