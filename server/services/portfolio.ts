import type { Holding, WatchlistItem } from "../../drizzle/schema";
import * as db from "../db";
import {
  analyzeNewsBatch,
  generateSignal,
  generateWatchSignal,
  type SignalContext,
} from "./analysis";
import {
  fetchCompanyProfile,
  fetchPriceHistory,
  fetchQuotes,
  fetchUsdJpyRate,
  fetchSgdJpyRate,
} from "./marketData";
import { buildNewsQuery, filterNoise, searchNews } from "./news";
import { groupPositionsBySymbol, type GroupedPosition } from "./groupPositions";
import { buildMarketSlices, type MarketSlice } from "./marketSlices";
import { computePeriodChange, type PeriodChange } from "./periodChange";
import {
  computeBrokerLeverage,
  marginRiskLevel,
  type MarginRiskLevel,
} from "./leverage";
import { BROKER_LABELS, type Broker } from "../../shared/investing";
import type { Market } from "../../shared/investing";
import { FX_FALLBACK, convertToJpy, isPlausibleRate, type FxRates } from "./fx";

/**
 * 保有ポジションとウォッチリストに対する横断処理。
 * ルーターから呼ばれるユースケース層。
 */

const n = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

export type PositionView = {
  id: number;
  symbol: string;
  tickerCode: string;
  name: string;
  market: Market;
  currency: string;
  /** どの証券プラットフォームで保有しているか */
  broker: Broker;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  previousClose: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  businessSummary: string | null;
  /** 現地通貨での評価額 */
  marketValue: number | null;
  costValue: number;
  pnl: number | null;
  pnlPct: number | null;
  dayChangePct: number | null;
  /** 基準通貨（JPY）換算の評価額 */
  marketValueBase: number | null;
  costValueBase: number;
  weightPct: number | null;
  priceUpdatedAt: Date | null;
  hasCard: boolean;
  signal: {
    action: "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT";
    confidence: number | null;
    rationale: string;
    createdAt: Date;
  } | null;
  newsCount: number;
  negativeNewsCount: number;
};

export type PortfolioSummary = {
  totalValueBase: number;
  totalCostBase: number;
  totalPnl: number;
  totalPnlPct: number | null;
  dayChangeBase: number | null;
  dayChangePct: number | null;
  /**
   * 保有している「銘柄」の数。同一銘柄を複数の証券口座で持っていても 1 と数える。
   * 口座ごとのレコード数は positions.length を参照する。
   */
  positionCount: number;
  cashBalance: number;
  totalAssets: number;
  baseCurrency: string;
  usdJpyRate: number;
  /** SGD/JPY レート。SGX 銘柄と IBKR の SGD 建て残高の円換算に使う */
  sgdJpyRate: number;
  /** 為替レートを自動取得しているか。false なら手動設定値 */
  fxAutoUpdate: boolean;
  /** 為替レートを最後に自動取得できた時刻。null なら手動値のまま */
  fxRateUpdatedAt: Date | null;
  lastPriceSyncAt: Date | null;
  lastNewsSyncAt: Date | null;
  /** 価格未取得の銘柄数 */
  missingPriceCount: number;
  /**
   * 前回記録からの変化。長期保有では前日比よりこちらが判断に役立つ。
   * スナップショットが 2 件未満の場合は null。
   */
  periodChange: PeriodChange | null;
  /**
   * 信用取引の借入合計（円換算、正の数）。
   * 現物のみなら 0。IBKR のように借入して株を買っている口座があると正の値になる。
   */
  totalBorrowedBase: number;
  /**
   * 純資産（円換算）= 株式時価 + 現金 − 借入。
   * 借入がある場合、株式時価をそのまま資産と見なすと過大になるため、
   * 実際に自分のものである金額をこちらで表す。
   */
  netAssetsBase: number;
  /**
   * 全体のレバレッジ倍率 = 株式時価 ÷ 純資産。
   * 借入がなければ 1.0 前後。純資産が 0 以下なら null。
   */
  overallLeverage: number | null;
};

export type SectorSlice = { key: string; label: string; value: number; pct: number; count: number };

/** 証券プラットフォーム別の内訳。口座ごとの成績を比較できるよう損益も持たせる */
export type BrokerSlice = SectorSlice & {
  pnl: number;
  pnlPct: number | null;
  /**
   * 信用取引の情報。借入がある口座（IBKR など）でのみ入る。
   * 現物のみの口座では null。
   */
  leverage: BrokerLeverageView | null;
};

/**
 * 口座の信用取引の状況（すべて円換算）。
 * 元の口座通貨（IBKR なら SGD）ではなく円で持つのは、
 * 他の口座と並べて総資産を判断できるようにするため。
 */
export type BrokerLeverageView = {
  /** 口座の基軸通貨（記録用） */
  currency: string;
  /** 借入額（円換算、正の数） */
  borrowedBase: number;
  /** 余剰現金（円換算） */
  freeCashBase: number;
  /** 純資産（円換算）= 株式時価 − 借入 + 余剰現金 */
  netValueBase: number;
  /** レバレッジ倍率。純資産が 0 以下なら null */
  leverage: number | null;
  /** 維持証拠金（円換算） */
  maintenanceMarginBase: number;
  /** 証拠金余力（円換算）。マイナスなら追証 */
  marginCushionBase: number | null;
  /** 証拠金維持率（%）。100 を下回ると追証 */
  marginRatioPct: number | null;
  /** 追証に至るまでの株価下落率（%） */
  dropToMarginCallPct: number | null;
  /** 月初来の支払利息（円換算、負値） */
  interestMtdBase: number;
  /** 追証リスクの警告レベル */
  riskLevel: MarginRiskLevel;
};

export type ConcentrationAlert = {
  level: "HIGH" | "MEDIUM";
  kind: "POSITION" | "SECTOR" | "CURRENCY";
  label: string;
  pct: number;
  threshold: number;
  message: string;
};

/**
 * 保有一覧を計算済みビューに変換する。
 */
export async function buildPortfolio(userId: number): Promise<{
  positions: PositionView[];
  /** 同一銘柄を複数口座で保有する場合にまとめた合計ビュー */
  groups: GroupedPosition[];
  summary: PortfolioSummary;
  sectors: SectorSlice[];
  currencies: SectorSlice[];
  /** 国・市場別の内訳。米国株は為替影響を切り分けられるようにしている */
  markets: MarketSlice[];
  brokers: BrokerSlice[];
  alerts: ConcentrationAlert[];
}> {
  const [rows, settings, signalMap, cards, allNews, snapshots, brokerBalances] = await Promise.all([
    db.listHoldings(userId),
    db.getSettings(userId),
    db.latestSignals(userId),
    db.listCards(userId),
    db.listNews(userId, { limit: 500 }),
    // 前回記録からの変化を出すために履歴を読む
    db.listSnapshots(userId, 120),
    // 信用取引の借入額。株式時価から差し引かないと総資産が過大になる
    db.listBrokerBalances(userId),
  ]);

  const rates: FxRates = {
    usdJpy: n(settings.usdJpyRate) ?? FX_FALLBACK.usdJpy,
    sgdJpy: n(settings.sgdJpyRate) ?? FX_FALLBACK.sgdJpy,
  };
  const cardSymbols = new Set(cards.map(c => c.symbol));

  const newsBySymbol = new Map<string, { total: number; negative: number }>();
  for (const item of allNews) {
    const entry = newsBySymbol.get(item.symbol) ?? { total: 0, negative: 0 };
    entry.total += 1;
    if (item.sentiment === "NEGATIVE" && (item.impactScore ?? 0) >= 40) entry.negative += 1;
    newsBySymbol.set(item.symbol, entry);
  }

  /*
   * 円換算。未対応通貨は convertToJpy が null を返すので、
   * 合計を欠損させたくない箇所では呼び出し側で現地通貨の値にフォールバックする。
   */
  const toBase = (value: number | null, currency: string): number | null =>
    convertToJpy(value, currency, rates);

  const partial = rows.map(h => {
    const quantity = n(h.quantity) ?? 0;
    const avgCost = n(h.avgCost) ?? 0;
    const currentPrice = n(h.currentPrice);
    const previousClose = n(h.previousClose);
    const marketValue = currentPrice === null ? null : currentPrice * quantity;
    const costValue = avgCost * quantity;
    const pnl = marketValue === null ? null : marketValue - costValue;
    const pnlPct = pnl === null || costValue === 0 ? null : (pnl / costValue) * 100;
    const dayChangePct =
      currentPrice === null || previousClose === null || previousClose === 0
        ? null
        : ((currentPrice - previousClose) / previousClose) * 100;
    const sig = signalMap.get(h.symbol);
    const newsStat = newsBySymbol.get(h.symbol) ?? { total: 0, negative: 0 };

    return {
      id: h.id,
      symbol: h.symbol,
      tickerCode: h.tickerCode,
      name: h.name,
      market: h.market,
      currency: h.currency,
      broker: h.broker,
      quantity,
      avgCost,
      currentPrice,
      previousClose,
      fiftyTwoWeekHigh: n(h.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: n(h.fiftyTwoWeekLow),
      sector: h.sector,
      industry: h.industry,
      website: h.website,
      businessSummary: h.businessSummary,
      marketValue,
      costValue,
      pnl,
      pnlPct,
      dayChangePct,
      marketValueBase: toBase(marketValue, h.currency),
      costValueBase: toBase(costValue, h.currency) ?? costValue,
      weightPct: null as number | null,
      priceUpdatedAt: h.priceUpdatedAt,
      hasCard: cardSymbols.has(h.symbol),
      signal: sig
        ? {
            action: sig.action,
            confidence: sig.confidence,
            rationale: sig.rationale,
            createdAt: sig.createdAt,
          }
        : null,
      newsCount: newsStat.total,
      negativeNewsCount: newsStat.negative,
    } satisfies PositionView;
  });

  const totalValueBase = partial.reduce((acc, p) => acc + (p.marketValueBase ?? 0), 0);
  const totalCostBase = partial.reduce((acc, p) => acc + p.costValueBase, 0);

  const positions = partial
    .map(p => ({
      ...p,
      weightPct:
        totalValueBase > 0 && p.marketValueBase !== null
          ? (p.marketValueBase / totalValueBase) * 100
          : null,
    }))
    .sort((a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0));

  const prevValueBase = partial.reduce((acc, p) => {
    if (p.previousClose === null) return acc + (p.marketValueBase ?? 0);
    const prev = p.previousClose * p.quantity;
    return acc + (toBase(prev, p.currency) ?? prev);
  }, 0);

  const dayChangeBase = prevValueBase > 0 ? totalValueBase - prevValueBase : null;
  const cashBalance = n(settings.cashBalance) ?? 0;

  /**
   * 同一銘柄を複数の証券口座で保有している場合の合計ビュー。
   * 銘柄数の表示やシグナル判定はこちらを基準にする。
   */
  const groups = groupPositionsBySymbol(positions, totalValueBase);

  /* ---------------- 信用取引（借入）の反映 ---------------- */

  /*
   * 口座別の株式時価を先に出す。レバレッジは「株式時価 ÷ 純資産」で求めるため、
   * その口座が実際に保有している株の評価額が必要になる。
   */
  const positionValueByBroker = new Map<string, number>();
  for (const p of positions) {
    positionValueByBroker.set(
      p.broker,
      (positionValueByBroker.get(p.broker) ?? 0) + (p.marketValueBase ?? 0)
    );
  }

  const leverageByBroker = new Map<string, BrokerLeverageView>();
  let totalBorrowedBase = 0;

  for (const bal of brokerBalances) {
    const cash = n(bal.cashBalance) ?? 0;
    // 借入がなく証拠金も無い口座（現物のみ）は信用情報を持たせない
    const margin = n(bal.maintenanceMargin) ?? 0;
    if (cash >= 0 && margin <= 0) continue;

    const positionValueBase = positionValueByBroker.get(bal.broker) ?? 0;
    /*
     * 借入・証拠金は口座通貨で記録されているので円に換算する。
     * 株式時価（positionValueBase）は既に円換算済みなので、
     * ここでは現金・証拠金・利息だけを換算すればよい。
     */
    const toAccountBase = (amount: number): number =>
      convertToJpy(amount, bal.currency, rates) ?? amount;
    const cashBase = toAccountBase(cash);
    const marginBase = toAccountBase(margin);
    const interestBase = toAccountBase(n(bal.interestMtd) ?? 0);

    const lev = computeBrokerLeverage({
      broker: bal.broker,
      currency: bal.currency,
      positionValue: positionValueBase,
      cashBalance: cashBase,
      maintenanceMargin: marginBase,
      interestMtd: interestBase,
    });

    totalBorrowedBase += lev.borrowed;
    leverageByBroker.set(bal.broker, {
      currency: bal.currency,
      borrowedBase: lev.borrowed,
      freeCashBase: lev.freeCash,
      netValueBase: lev.netValue,
      leverage: lev.leverage,
      maintenanceMarginBase: lev.maintenanceMargin,
      marginCushionBase: lev.marginCushion,
      marginRatioPct: lev.marginRatioPct,
      dropToMarginCallPct: lev.dropToMarginCallPct,
      interestMtdBase: lev.interestMtd,
      riskLevel: marginRiskLevel(lev),
    });
  }

  const summary: PortfolioSummary = {
    totalValueBase,
    totalCostBase,
    totalPnl: totalValueBase - totalCostBase,
    totalPnlPct:
      totalCostBase > 0 ? ((totalValueBase - totalCostBase) / totalCostBase) * 100 : null,
    dayChangeBase,
    dayChangePct:
      dayChangeBase !== null && prevValueBase > 0 ? (dayChangeBase / prevValueBase) * 100 : null,
    // 同一銘柄を複数口座で持つ場合、レコード数ではなく銘柄数を表示する
    positionCount: groups.length,
    cashBalance,
    totalAssets: totalValueBase + cashBalance,
    baseCurrency: settings.baseCurrency,
    usdJpyRate: rates.usdJpy,
    sgdJpyRate: rates.sgdJpy,
    fxAutoUpdate: settings.fxAutoUpdate,
    fxRateUpdatedAt: settings.fxRateUpdatedAt,
    lastPriceSyncAt: settings.lastPriceSyncAt,
    lastNewsSyncAt: settings.lastNewsSyncAt,
    missingPriceCount: positions.filter(p => p.currentPrice === null).length,
    /**
     * 長期保有では前日比より「前回記録からの変化」が判断に役立つ。
     * 買い増しによる増加と株価変動による増加を分けて持つ。
     */
    periodChange: computePeriodChange(
      snapshots.map(s => ({
        totalValue: n(s.totalValue) ?? 0,
        totalCost: n(s.totalCost) ?? 0,
        positionCount: s.positionCount,
        capturedAt: s.capturedAt,
      }))
    ),
    totalBorrowedBase,
    netAssetsBase: totalValueBase + cashBalance - totalBorrowedBase,
    /*
     * 全体のレバレッジ。株式時価 ÷ 純資産で求める。
     * 借入がなければ 1.0 前後になり、借入があると 1 を超える。
     */
    overallLeverage:
      totalValueBase + cashBalance - totalBorrowedBase > 0
        ? totalValueBase / (totalValueBase + cashBalance - totalBorrowedBase)
        : null,
  };

  /* --- 分布集計 --- */
  const sectorMap = new Map<string, { value: number; count: number }>();
  const currencyMap = new Map<string, { value: number; count: number }>();
  const brokerMap = new Map<string, { value: number; count: number; cost: number }>();

  for (const p of positions) {
    const v = p.marketValueBase ?? 0;
    const sKey = p.sector ?? "未分類";
    const s = sectorMap.get(sKey) ?? { value: 0, count: 0 };
    s.value += v;
    s.count += 1;
    sectorMap.set(sKey, s);

    const c = currencyMap.get(p.currency) ?? { value: 0, count: 0 };
    c.value += v;
    c.count += 1;
    currencyMap.set(p.currency, c);

    const b = brokerMap.get(p.broker) ?? { value: 0, count: 0, cost: 0 };
    b.value += v;
    b.count += 1;
    b.cost += p.costValueBase;
    brokerMap.set(p.broker, b);
  }

  const toSlices = (m: Map<string, { value: number; count: number }>): SectorSlice[] =>
    Array.from(m.entries())
      .map(([key, v]) => ({
        key,
        label: key,
        value: v.value,
        pct: totalValueBase > 0 ? (v.value / totalValueBase) * 100 : 0,
        count: v.count,
      }))
      .sort((a, b) => b.value - a.value);

  /* --- 集中度アラート --- */
  const alerts: ConcentrationAlert[] = [];
  const posThreshold = settings.concentrationThreshold;
  const secThreshold = settings.sectorConcentrationThreshold;

  // 集中リスクは口座をまたいだ合計で判定する。
  // 口座別に見ると個々は小さくても、同一銘柄の合計では大きな比率になることがある。
  for (const g of groups) {
    if (g.weightPct !== null && g.weightPct >= posThreshold) {
      const accountNote = g.isSplit ? `${g.entries.length} 口座の合計で` : "";
      alerts.push({
        level: g.weightPct >= posThreshold * 1.5 ? "HIGH" : "MEDIUM",
        kind: "POSITION",
        label: g.name,
        pct: g.weightPct,
        threshold: posThreshold,
        message: `${g.name} が${accountNote}資産の ${g.weightPct.toFixed(1)}% を占めています（しきい値 ${posThreshold}%）。単一銘柄への集中リスクを確認してください。`,
      });
    }
  }

  for (const s of toSlices(sectorMap)) {
    if (s.pct >= secThreshold && s.key !== "未分類") {
      alerts.push({
        level: s.pct >= secThreshold * 1.4 ? "HIGH" : "MEDIUM",
        kind: "SECTOR",
        label: s.key,
        pct: s.pct,
        threshold: secThreshold,
        message: `${s.key} セクターが ${s.pct.toFixed(1)}%（${s.count} 銘柄）を占めています（しきい値 ${secThreshold}%）。業種分散を確認してください。`,
      });
    }
  }

  return {
    positions,
    groups,
    summary,
    sectors: toSlices(sectorMap),
    currencies: toSlices(currencyMap),
    /**
     * 国・市場別の内訳。銘柄単位（groups）を集計対象にすることで、
     * 同一銘柄を複数口座で持っていても銘柄数を二重に数えない。
     */
    markets: buildMarketSlices(groups, totalValueBase),
    brokers: Array.from(brokerMap.entries())
      .map(([key, v]) => ({
        key,
        label: BROKER_LABELS[key as Broker] ?? key,
        value: v.value,
        pct: totalValueBase > 0 ? (v.value / totalValueBase) * 100 : 0,
        count: v.count,
        /** 口座単位の含み損益。口座ごとの成績を比較できるようにする */
        pnl: v.value - v.cost,
        pnlPct: v.cost > 0 ? ((v.value - v.cost) / v.cost) * 100 : null,
        /** 借入がある口座のみ信用情報を付ける（現物口座は null） */
        leverage: leverageByBroker.get(key) ?? null,
      }))
      .sort((a, b) => b.value - a.value),
    alerts: alerts.sort((a, b) => b.pct - a.pct),
  };
}

/**
 * 保有・ウォッチリスト全銘柄の株価を更新する。
 */
export async function syncPrices(userId: number): Promise<{
  updated: number;
  failed: string[];
  /** 更新できた為替レート。取得に失敗した通貨は null */
  fxRates: { usdJpy: number | null; sgdJpy: number | null };
}> {
  const [hs, ws, settings] = await Promise.all([
    db.listHoldings(userId),
    db.listWatchlist(userId),
    db.getSettings(userId),
  ]);

  /**
   * 為替レートは株価と同じタイミングで更新する。
   * 手動で固定したい場合に備えて fxAutoUpdate で切れるようにし、
   * 取得に失敗しても既存の設定値を維持する（0 で上書きして評価額を壊さない）。
   */
  const fxRates = await syncFxRate(userId, settings?.fxAutoUpdate ?? true);

  /**
   * 同一銘柄を複数の証券口座で保有している場合、株価は 1 回だけ取得すればよい。
   * 重複を排除して外部 API への無駄なリクエストを避ける。
   * 更新自体はレコードごとに行うため、全口座に反映される。
   */
  const symbols = Array.from(new Set([...hs.map(h => h.symbol), ...ws.map(w => w.symbol)]));
  if (symbols.length === 0) {
    await db.updateSettings(userId, { lastPriceSyncAt: new Date() });
    return { updated: 0, failed: [], fxRates };
  }

  const quotes = await fetchQuotes(symbols);
  const failed: string[] = [];
  let updated = 0;
  const now = new Date();

  for (const h of hs) {
    const q = quotes.get(h.symbol);
    if (!q || q.price === null) {
      failed.push(h.symbol);
      continue;
    }
    await db.updateHolding(userId, h.id, {
      currentPrice: String(q.price),
      previousClose: q.previousClose === null ? undefined : String(q.previousClose),
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh === null ? undefined : String(q.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: q.fiftyTwoWeekLow === null ? undefined : String(q.fiftyTwoWeekLow),
      currency: q.currency,
      priceUpdatedAt: now,
    });
    updated += 1;
  }

  for (const w of ws) {
    const q = quotes.get(w.symbol);
    if (!q || q.price === null) {
      failed.push(w.symbol);
      continue;
    }
    await db.updateWatchItem(userId, w.id, {
      currentPrice: String(q.price),
      previousClose: q.previousClose === null ? undefined : String(q.previousClose),
      currency: q.currency,
      priceUpdatedAt: now,
    });
    updated += 1;
  }

  await db.updateSettings(userId, { lastPriceSyncAt: now });

  // ポートフォリオ推移用のスナップショットを保存
  try {
    const { summary } = await buildPortfolio(userId);
    if (summary.positionCount > 0) {
      await db.insertSnapshot({
        userId,
        totalValue: summary.totalValueBase.toFixed(2),
        totalCost: summary.totalCostBase.toFixed(2),
        positionCount: summary.positionCount,
      });
    }
  } catch (error) {
    console.warn("[portfolio] snapshot failed:", error);
  }

  return { updated, failed: Array.from(new Set(failed)), fxRates };
}

/**
 * USD/JPY レートを取得して設定に保存する。
 *
 * 失敗時は既存の設定値を保持したまま null を返す。為替レートは評価額の
 * 計算に直接使われるため、取得できなかったときに 0 や既定値で上書きすると
 * 米国株の評価額が一気に壊れる。そのため「更新しない」を安全側の挙動とする。
 *
 * @param enabled false の場合は取得せず、手動設定値をそのまま使う
 */
export async function syncFxRate(
  userId: number,
  enabled = true
): Promise<{ usdJpy: number | null; sgdJpy: number | null }> {
  if (!enabled) return { usdJpy: null, sgdJpy: null };

  /*
   * USD/JPY と SGD/JPY を個別に扱う。片方の取得に失敗しても、
   * もう片方は更新できたほうが評価額は正確になる。
   */
  const [usdResult, sgdResult] = await Promise.allSettled([
    fetchUsdJpyRate(),
    fetchSgdJpyRate(),
  ]);

  const pick = (
    result: PromiseSettledResult<number | null>,
    label: string,
    min: number,
    max: number
  ): number | null => {
    if (result.status === "rejected") {
      console.warn(`[portfolio] ${label} の取得に失敗:`, result.reason);
      return null;
    }
    // 明らかに異常な値は採用しない（API 仕様変更やパース失敗の検知）
    if (!isPlausibleRate(result.value, min, max)) {
      console.warn(`[portfolio] ${label} が想定範囲外のため更新をスキップ: ${result.value}`);
      return null;
    }
    return result.value;
  };

  const usdJpy = pick(usdResult, "USD/JPY", 50, 500);
  // SGD/JPY は USD/JPY の 7〜8 割程度で推移するため、より狭い範囲で検査する
  const sgdJpy = pick(sgdResult, "SGD/JPY", 40, 400);

  const patch: { usdJpyRate?: string; sgdJpyRate?: string; fxRateUpdatedAt?: Date } = {};
  if (usdJpy !== null) patch.usdJpyRate = usdJpy.toFixed(4);
  if (sgdJpy !== null) patch.sgdJpyRate = sgdJpy.toFixed(4);

  if (Object.keys(patch).length > 0) {
    patch.fxRateUpdatedAt = new Date();
    try {
      await db.updateSettings(userId, patch);
    } catch (error) {
      console.warn("[portfolio] 為替レートの保存に失敗:", error);
      return { usdJpy: null, sgdJpy: null };
    }
  }

  return { usdJpy, sgdJpy };
}

/**
 * 企業プロファイル（セクター等）が未取得の銘柄を補完する。
 */
export async function enrichProfiles(userId: number, force = false): Promise<number> {
  const hs = await db.listHoldings(userId);
  const targets = force ? hs : hs.filter(h => !h.sector || !h.profileUpdatedAt);
  let count = 0;

  for (const h of targets.slice(0, 20)) {
    const p = await fetchCompanyProfile(h.symbol);
    if (!p) continue;
    await db.updateHolding(userId, h.id, {
      sector: p.sector ?? undefined,
      industry: p.industry ?? undefined,
      website: p.website ?? undefined,
      businessSummary: p.businessSummary ?? undefined,
      profileUpdatedAt: new Date(),
    });
    count += 1;
  }

  const ws = await db.listWatchlist(userId);
  for (const w of (force ? ws : ws.filter(x => !x.sector)).slice(0, 20)) {
    const p = await fetchCompanyProfile(w.symbol);
    if (!p) continue;
    await db.updateWatchItem(userId, w.id, {
      sector: p.sector ?? undefined,
      industry: p.industry ?? undefined,
    });
    count += 1;
  }

  return count;
}

type NewsTarget = { symbol: string; name: string; tickerCode: string; market: Market };

/**
 * 指定銘柄のニュースを取得し、AI 判定して保存する。
 */
export async function syncNewsForTargets(
  userId: number,
  targets: NewsTarget[],
  opts: { windowDays?: number } = {}
): Promise<{ fetched: number; analyzed: number }> {
  let fetched = 0;
  let analyzed = 0;

  for (const t of targets) {
    try {
      const query = buildNewsQuery(t);
      const raw = filterNoise(
        await searchNews(query, { market: t.market, windowDays: opts.windowDays ?? 30, limit: 14 })
      );
      if (raw.length === 0) continue;

      const existing = await db.existingNewsHashes(
        userId,
        raw.map(r => r.urlHash)
      );
      const fresh = raw.filter(r => !existing.has(r.urlHash));
      if (fresh.length === 0) continue;

      await db.insertNews(
        fresh.map(r => ({
          userId,
          symbol: t.symbol,
          title: r.title,
          url: r.url,
          urlHash: r.urlHash,
          source: r.source ?? undefined,
          publishedAt: r.publishedAt ?? undefined,
        }))
      );
      fetched += fresh.length;

      const verdicts = await analyzeNewsBatch(t.name, fresh);
      for (const v of verdicts) {
        await db.updateNewsVerdict(userId, v.urlHash, {
          sentiment: v.sentiment,
          impactScore: v.impactScore,
          summary: v.summary,
          reasoning: v.reasoning,
        });
        analyzed += 1;
      }
    } catch (error) {
      console.warn(`[portfolio] news sync failed for ${t.symbol}:`, error);
    }
  }

  await db.updateSettings(userId, { lastNewsSyncAt: new Date() });
  return { fetched, analyzed };
}

/**
 * ユーザーの保有＋ウォッチリスト銘柄のニュースを取得・分析する。
 *
 * 本番のリクエスト上限は 180 秒。27 銘柄では実測 12 分以上かかるため、
 * `offset` / `batchSize` を渡して分割実行できるようにしている。
 * `batchSize` 省略時は全件処理（定期実行 Heartbeat 用）。
 */
export async function syncNewsForUser(
  userId: number,
  options?: { offset?: number; batchSize?: number }
): Promise<{
  fetched: number;
  analyzed: number;
  total: number;
  processed: number;
  nextOffset: number | null;
}> {
  const [hs, ws] = await Promise.all([db.listHoldings(userId), db.listWatchlist(userId)]);
  /**
   * ニュースは銘柄単位。同一銘柄を複数の証券口座で保有していても
   * 検索・分析は 1 回で足りるため、シンボルで重複を排除する。
   * 重複したまま処理すると AI 利用枠を二重に消費してしまう。
   */
  const seen = new Set<string>();
  const targets: NewsTarget[] = [];
  for (const x of [...hs, ...ws]) {
    if (seen.has(x.symbol)) continue;
    seen.add(x.symbol);
    targets.push({ symbol: x.symbol, name: x.name, tickerCode: x.tickerCode, market: x.market });
  }

  const total = targets.length;
  const offset = options?.offset ?? 0;
  // batchSize 未指定なら全件（定期実行 Heartbeat はタイムアウト制約が緩いため）
  const batch =
    options?.batchSize === undefined
      ? targets.slice(offset)
      : targets.slice(offset, offset + options.batchSize);

  const result = await syncNewsForTargets(userId, batch);
  const processed = offset + batch.length;

  return {
    ...result,
    total,
    processed,
    nextOffset: processed >= total ? null : processed,
  };
}

/**
 * 1 銘柄のシグナルを生成して保存する。
 */
export async function regenerateSignal(userId: number, holding: Holding) {
  const [card, news, portfolio, history] = await Promise.all([
    db.getCard(userId, holding.symbol),
    db.listNews(userId, { symbol: holding.symbol, limit: 12 }),
    buildPortfolio(userId),
    fetchPriceHistory(holding.symbol, "6mo", "1d"),
  ]);
  /**
   * シグナルは銘柄単位。同一銘柄を複数の証券口座で保有している場合は
   * 口座ごとに別々の判断が出ると混乱するため、口座をまたいだ合計ポジションで判定する。
   * 株数・取得単価・損益率・構成比はすべて合計値を使う。
   */
  const view = portfolio.groups.find(g => g.symbol === holding.symbol);
  /** 口座をまたいでいる場合は、AI に口座別の状況も伝える */
  const accountBreakdown =
    view && view.isSplit
      ? view.entries.map(e => ({
          broker: e.broker,
          quantity: e.quantity,
          avgCost: e.avgCost,
          pnlPct: e.pnlPct,
        }))
      : null;
  const returnOver = (days: number): number | null => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const cutoff = last.t - days * 24 * 60 * 60 * 1000;
    const base = history.find(b => b.t >= cutoff);
    if (!base || base.c === 0) return null;
    return ((last.c - base.c) / base.c) * 100;
  };

  const ctx: SignalContext = {
    name: holding.name,
    symbol: holding.symbol,
    currency: holding.currency,
    // 合計株数・加重平均取得単価。取得できない場合は当該レコードの値にフォールバック
    quantity: view?.quantity ?? Number(holding.quantity),
    avgCost: view?.avgCost ?? Number(holding.avgCost),
    currentPrice: view?.currentPrice ?? null,
    pnlPct: view?.pnlPct ?? null,
    weightPct: view?.weightPct ?? null,
    sector: holding.sector,
    industry: holding.industry,
    fiftyTwoWeekHigh: view?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: view?.fiftyTwoWeekLow ?? null,
    return1m: returnOver(30),
    return3m: returnOver(90),
    accountBreakdown,
    card: card
      ? {
          buyReason: card.buyReason,
          coreThesis: card.coreThesis,
          valuationAssumption: card.valuationAssumption,
          fairValue: card.fairValue ? Number(card.fairValue) : null,
          keyFinancials: card.keyFinancials,
          exitConditions: card.exitConditions,
          risks: card.risks,
        }
      : null,
    news: news.map(x => ({
      title: x.title,
      sentiment: x.sentiment,
      impactScore: x.impactScore,
      summary: x.summary,
      publishedAt: x.publishedAt,
    })),
  };

  const result = await generateSignal(ctx);

  await db.insertSignal({
    userId,
    symbol: holding.symbol,
    action: result.action,
    confidence: result.confidence,
    rationale: result.rationale,
    factors: result.factors,
    priceAtSignal: view?.currentPrice !== null && view?.currentPrice !== undefined ? String(view.currentPrice) : undefined,
    pnlPctAtSignal: view?.pnlPct !== null && view?.pnlPct !== undefined ? view.pnlPct.toFixed(4) : undefined,
    scope: "HOLDING",
  });

  return result;
}

export async function regenerateWatchSignal(userId: number, item: WatchlistItem) {
  const news = await db.listNews(userId, { symbol: item.symbol, limit: 10 });
  const result = await generateWatchSignal({
    name: item.name,
    symbol: item.symbol,
    currency: item.currency,
    currentPrice: item.currentPrice ? Number(item.currentPrice) : null,
    targetPrice: item.targetPrice ? Number(item.targetPrice) : null,
    buyConditions: item.buyConditions,
    watchReason: item.watchReason,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    news: news.map(x => ({
      title: x.title,
      sentiment: x.sentiment,
      impactScore: x.impactScore,
      summary: x.summary,
    })),
  });

  await db.insertSignal({
    userId,
    symbol: item.symbol,
    action: result.action,
    confidence: result.confidence,
    rationale: result.rationale,
    factors: result.factors,
    priceAtSignal: item.currentPrice ?? undefined,
    scope: "WATCHLIST",
  });

  return result;
}
