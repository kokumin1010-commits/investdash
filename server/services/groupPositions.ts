import type { PositionView } from "./portfolio";
import { calcPnlPct } from "../../shared/pnlLabel";
import { computeAddSizing } from "../../shared/addSizing";
import { actualAmount, sharesForAmount } from "../../shared/addShares";

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
  /**
   * 評価損益の円換算。
   * 表示通貨を切り替えるとき損益額も揃えないと
   * 「評価額は USD・損益は現地通貨」という不統一が生じるため持たせる。
   */
  pnlBase: number | null;
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
  /**
   * 配当の合算。1 株あたりの配当額は銘柄共通だが、
   * 受取額は保有株数に比例するため口座をまたいで合計する。
   * 未取得なら null。
   */
  dividend: GroupedDividend | null;
  /**
   * ADD（買い増し）と判定された銘柄に対する「いくら買い増すか」の目安。
   *
   * ADD 以外では null。シグナルが HOLD や REDUCE の銘柄に金額を出すと
   * 「買ってよい」と誤解される。判定と金額は必ず同じ向きに揃える。
   */
  addPlan: GroupedAddPlan | null;
};

export type GroupedAddPlan = {
  /** 1 回に充てる金額（円）。上限に達している場合は 0 */
  amountBase: number;
  /** 現地通貨での金額。現在値が未取得なら null */
  amountLocal: number | null;
  /** 買い増す株数。単元・現在値が未取得なら null */
  shares: number | null;
  /** 買い増し後の構成比（%）。金額が 0 なら現状のまま */
  afterSharePct: number | null;
  /** 1 銘柄の上限に達しているか。true なら買い増しを勧めない */
  atCap: boolean;
  /** 上限までに追加できる金額（円） */
  roomToCapBase: number;
};

export type GroupedDividend = {
  /** 1 株あたりの年間配当（現地通貨・税引前） */
  perShare: number;
  /** 全口座合計の年間受取額（現地通貨） */
  annualIncome: number;
  /** 全口座合計の年間受取額（円換算） */
  annualIncomeBase: number | null;
  /** 現在値に対する利回り（%） */
  yieldPct: number | null;
  /** 加重平均取得単価に対する利回り（%） */
  yieldOnCostPct: number | null;
  count: number;
  lastDate: Date | null;
  /** 特別配当が含まれているか */
  hasSpecial: boolean;
  /** 利回りが実勢としてありえない水準（8% 超）か */
  yieldNeedsCheck: boolean;
  /** 特別配当を除いた場合の利回り（%） */
  recurringYieldPct: number | null;
  /**
   * 全口座合計の月別受取額（円換算、添字 0 = 1 月）。
   * どの口座も月別データを持たない場合は null。
   */
  monthlyIncomeBase: number[] | null;
};

/** 合計 = 各口座の単純合計。null（価格未取得）は 0 として扱わず null を伝播させない */
function sumOrNull(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

/**
 * 月別配当を口座をまたいで合算する。
 * ひとつも月別データが無ければ null（「不明」）を返す。
 */
function sumMonthly(lists: (number[] | null)[]): number[] | null {
  const known = lists.filter((v): v is number[] => Array.isArray(v) && v.length === 12);
  if (known.length === 0) return null;
  const out = Array.from({ length: 12 }, () => 0);
  for (const list of known) {
    for (let m = 0; m < 12; m++) {
      if (Number.isFinite(list[m])) out[m] += list[m];
    }
  }
  return out;
}

/**
 * 保有ポジションをシンボル単位でまとめる。
 *
 * 並び順は合計評価額の降順。口座内訳も評価額の降順で並べる。
 */
export function groupPositionsBySymbol(
  positions: PositionView[],
  totalValueBase: number,
  addSizingInput?: { interestAssetsBase: number; cashBase: number }
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

    /*
     * 配当の合算。1 株あたりの配当額は銘柄共通なので代表値を採り、
     * 受取額は各口座の株数に応じた額を足し合わせる。
     * 取得原価に対する利回りは加重平均取得単価を使う。
     */
    const divEntry = entries.find(e => e.dividend !== null)?.dividend ?? null;
    const avgCostForYield = quantity > 0 ? costValue / quantity : 0;
    const dividend = divEntry
      ? {
          perShare: divEntry.perShare,
          annualIncome: divEntry.perShare * quantity,
          annualIncomeBase: sumOrNull(entries.map(e => e.dividend?.annualIncomeBase ?? null)),
          yieldPct:
            currentPrice !== null && currentPrice > 0
              ? (divEntry.perShare / currentPrice) * 100
              : null,
          yieldOnCostPct:
            avgCostForYield > 0 ? (divEntry.perShare / avgCostForYield) * 100 : null,
          count: divEntry.count,
          lastDate: divEntry.lastDate,
          hasSpecial: divEntry.hasSpecial,
          yieldNeedsCheck: divEntry.yieldNeedsCheck,
          recurringYieldPct: divEntry.recurringYieldPct,
          monthlyIncomeBase: sumMonthly(entries.map(e => e.dividend?.monthlyIncomeBase ?? null)),
        }
      : null;

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
      /*
       * 取得原価がマイナスの銘柄は率を出さない。
       * 同一銘柄を複数口座で持つ場合、合算した原価がマイナスになることもある
       * （富途香港の AMD のようにプレミアム受取が購入代金を上回るケース）。
       */
      pnlPct: calcPnlPct(pnl, costValue),
      dayChangePct,
      marketValueBase,
      costValueBase,
      /*
       * 円換算の損益は「円換算の評価額 − 円換算の取得原価」で求める。
       * 現地通貨の損益に今のレートを掛ける方法だと、
       * 取得時と現在で異なるレートが混ざって二重計算になるため採らない。
       */
      pnlBase: marketValueBase === null ? null : marketValueBase - costValueBase,
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
      dividend,
      addPlan: null as GroupedAddPlan | null,
    } satisfies GroupedPosition;
  });

  const sorted = groups.sort((a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0));

  /*
   * ADD と判定された銘柄に「いくら買い増すか」を付ける。
   *
   * 原資（現金性資産と預り金）が渡されていない呼び出しでは付けない。
   * 原資が分からないまま金額を出すと根拠のない数字になる。
   */
  if (!addSizingInput) return sorted;

  for (const g of sorted) {
    if (g.signal?.action !== "ADD") continue;
    g.addPlan = buildAddPlan(g, totalValueBase, addSizingInput);
  }

  return sorted;
}

/**
 * 1 銘柄あたりの買い増し金額と株数を組み立てる。
 *
 * 金額の算定そのものは買い増し提案（AI）と同じ computeAddSizing を使う。
 * 別の計算式を持たせると、同じ銘柄で保有一覧と提案の金額が食い違い
 * どちらを信じればよいか分からなくなる。
 */
function buildAddPlan(
  g: GroupedPosition,
  totalValueBase: number,
  input: { interestAssetsBase: number; cashBase: number }
): GroupedAddPlan | null {
  const sizing = computeAddSizing(
    totalValueBase,
    input.interestAssetsBase,
    input.cashBase,
    g.marketValueBase ?? 0
  );
  if (!sizing) return null;

  /*
   * 円建ての金額を現地通貨に直す。円 → 現地の換算率は
   * 「その銘柄の円換算評価額 ÷ 現地通貨評価額」から逆算する。
   * 為替レートを引数で受け取らずに済み、評価額と必ず整合する。
   */
  const rate =
    g.marketValue !== null && g.marketValue > 0 && g.marketValueBase !== null
      ? g.marketValueBase / g.marketValue
      : null;
  const amountLocalRaw = rate !== null && rate > 0 ? sizing.suggestedBase / rate : null;

  const shares =
    amountLocalRaw !== null && g.currentPrice !== null
      ? sharesForAmount(amountLocalRaw, g.currentPrice, g.market)
      : null;

  /*
   * 表示する金額は単元に丸めた後の実額にする。
   * 「1,191 万円」と出しながら 100 株単位に丸めた実額が 1,150 万円だと、
   * 金額と株数の掛け算が合わず数字を信用できなくなる。
   */
  const amountLocal =
    shares !== null && shares > 0 && g.currentPrice !== null
      ? actualAmount(shares, g.currentPrice)
      : amountLocalRaw;
  const amountBase =
    amountLocal !== null && rate !== null ? amountLocal * rate : sizing.suggestedBase;

  /*
   * 上限に達している銘柄は金額 0・株数 0 で返す。
   * 金額を 0 にしながら株数を「不明（null）」にすると、
   * 画面側で「株数が取得できていない」のか「買えない」のか区別できない。
   */
  if (sizing.atCap || amountBase <= 0) {
    return {
      amountBase: 0,
      amountLocal: 0,
      shares: 0,
      afterSharePct: g.weightPct,
      atCap: true,
      roomToCapBase: sizing.roomToCapBase,
    };
  }

  return {
    amountBase,
    amountLocal,
    shares,
    afterSharePct:
      totalValueBase > 0
        ? (((g.marketValueBase ?? 0) + amountBase) / (totalValueBase + amountBase)) * 100
        : null,
    atCap: sizing.atCap,
    roomToCapBase: sizing.roomToCapBase,
  };
}
