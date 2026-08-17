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
  fetchDividendHistory,
  fetchPriceHistory,
  fetchQuotes,
  fetchUsdJpyRate,
  fetchSgdJpyRate,
  fetchHkdJpyRate,
} from "./marketData";
import {
  annualIncome,
  dividendConcentration,
  dividendYield,
  emptyMonths,
  estimateFrequency,
  isImplausibleYield,
  peakDividendMonth,
  summarizeDividends,
  yieldOnCost,
  type DividendFrequency,
} from "./dividend";
import { buildNewsQuery, filterNoise, searchNews } from "./news";
import { calcPnlPct } from "../../shared/pnlLabel";
import {
  buildInterestAssetViews,
  summarizeInterestAssets,
  type InterestAssetView,
} from "./interestAssets";
import { groupPositionsBySymbol, type GroupedPosition } from "./groupPositions";
import { fillMissingSectors } from "./sectorFill";
import { buildMarketSlices, type MarketSlice } from "./marketSlices";
import { computePeriodChange, type PeriodChange } from "./periodChange";
import {
  buildDividendCalendar,
  type DividendCalendarMonth,
} from "./dividendCalendar";
import {
  computeBrokerLeverage,
  marginRiskLevel,
  type MarginRiskLevel,
} from "./leverage";
import {
  computeMarginInterest,
  evaluateCarry,
  type CarryVerdict,
} from "./marginInterest";
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
  /** 配当情報。未取得なら null */
  dividend: PositionDividendView | null;
};

/**
 * 保有 1 件分の配当情報。
 * 金額は税引前。実際の手取りは口座の所在国や個人の状況で変わるため、
 * 一律の税率で引かずに額面のまま扱う。
 */
export type PositionDividendView = {
  /** 1 株あたりの年間配当（現地通貨・直近 12 か月の実績・分割補正済み） */
  perShare: number;
  /** 年間受取額（現地通貨） */
  annualIncome: number;
  /** 年間受取額（円換算） */
  annualIncomeBase: number | null;
  /** 現在値に対する利回り（%） */
  yieldPct: number | null;
  /** 取得単価に対する利回り（%）。長期保有ではこちらが実感に近い */
  yieldOnCostPct: number | null;
  /** 直近 12 か月の支払回数 */
  count: number;
  frequency: DividendFrequency;
  lastDate: Date | null;
  lastAmount: number | null;
  updatedAt: Date | null;
  /**
   * 特別配当（記念配当）が含まれているか。
   * true なら年間配当は一時的に多く、来期も同額とは限らない。
   */
  hasSpecial: boolean;
  /** 特別配当を除いた 1 株あたり年間配当の推定 */
  recurringPerShare: number;
  /** 特別配当を除いた場合の利回り（%） */
  recurringYieldPct: number | null;
  /**
   * 利回りが実勢としてありえない水準（8% 超）か。
   * 支払が年 2 回の銘柄では特別配当を検出できないため、最後の安全網として持つ。
   */
  yieldNeedsCheck: boolean;
  /**
   * 月別の受取額（円換算、添字 0 = 1 月）。
   * 権利落ち月を基準にしている。データが無い銘柄は null。
   */
  monthlyIncomeBase: number[] | null;
  /**
   * 1 株あたりの月別配当（現地通貨、添字 0 = 1 月）。
   * 銘柄内訳で現地通貨の金額を出すために保持する。データが無い銘柄は null。
   */
  monthlyPerShare: number[] | null;
};

/** 配当の全体集計 */
export type DividendSummaryView = {
  /** 年間の受取配当合計（円換算・税引前） */
  annualIncomeBase: number;
  /** 株式時価に対する全体利回り（%） */
  yieldPct: number | null;
  /** 取得原価に対する全体利回り（%） */
  yieldOnCostPct: number | null;
  /** 月あたりの平均受取額（円） */
  monthlyAverageBase: number;
  /** 配当を出している銘柄数 */
  payingCount: number;
  /** 無配の銘柄数 */
  nonPayingCount: number;
  /** 配当情報が未取得の銘柄数 */
  unknownCount: number;
  /** 配当情報を最後に取得した時刻 */
  updatedAt: Date | null;
  /**
   * 特別配当を除いた年間受取額（円換算）。
   * 来期も続くと見込める配当の水準を表す。
   */
  recurringIncomeBase: number;
  /** 特別配当が含まれる銘柄数 */
  specialCount: number;
  /**
   * 月別の受取配当（円換算、添字 0 = 1 月）。
   * 直近 12 か月の実績を権利落ち月に振り分けて合算したもの。
   */
  monthlyIncomeBase: number[];
  /** 最も配当が多い月（0 = 1 月）。配当がなければ null */
  peakMonth: number | null;
  /**
   * 上位 3 か月が年間配当の何割を占めるか（0〜1）。
   * 毎月均等なら 0.25、少数の月に集中していれば 1 に近づく。
   */
  concentration: number | null;
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
  /** HKD/JPY レート。港股と富途香港の港元基金の円換算に使う */
  hkdJpyRate: number;
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
  /**
   * 利息で増える現金性資産（貨幣市場基金・現金宝）の円換算合計。
   *
   * 株式時価には含めない。元本がほぼ動かず利息で増える資産を
   * 株の含み損益に混ぜると「株で儲かったのか」が分からなくなるため。
   * 一方で純資産（自分のものである金額）には含める。
   */
  interestAssetsBase: number;
  /** 利息資産の 1 年間の見込み利息（円換算） */
  interestIncomeBase: number;
  /** 利息資産の加重平均年利回り（%）。無ければ null */
  interestRatePct: number | null;
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
  /** その口座から年間いくら配当が入るか（円換算・税引前） */
  dividendIncomeBase: number;
  /** その口座の配当利回り（%）。株式時価に対する比率 */
  dividendYieldPct: number | null;
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
  /**
   * 借入金利の計算結果。
   * 借入通貨の階層別テーブルから加重平均で求める。
   * 通貨の階層定義が無い場合は null（推測で計算しない）。
   */
  interest: MarginInterestView | null;
  /**
   * 配当と金利の比較。
   * 「借金の利息を配当で賄えているか」を判定する。
   * 金利が計算できない場合は null。
   */
  carry: CarryView | null;
};

/** 借入金利の計算結果（画面表示用） */
export type MarginInterestView = {
  /** 借入通貨（実際に借りている通貨。IBKR の表示通貨とは異なることがある） */
  currency: string;
  /** 借入額（借入通貨） */
  borrowed: number;
  /** 年間利息（借入通貨） */
  annualInterest: number;
  /** 年間利息（円換算） */
  annualInterestBase: number;
  /** 加重平均の年率（%） */
  effectiveRatePct: number;
  /** 階層別の内訳（計算根拠を画面で示すため） */
  breakdown: Array<{ amount: number; annualRatePct: number; interest: number }>;
  /**
   * 月初来の実績から年換算した利息（円）。
   * 計算値の妥当性を利用者が確認できるように併記する。
   * 月初来の日数が不明なので概算。
   */
  annualInterestFromActualBase: number | null;
};

/** 配当と金利の比較（画面表示用） */
export type CarryView = {
  /** その口座の年間配当（円換算・税引前） */
  annualDividendBase: number;
  /** 年間利息（円換算） */
  annualInterestBase: number;
  /** 差額（円）。プラスなら配当が金利を上回る */
  netCarryBase: number;
  /** 配当が金利の何倍か */
  coverageRatio: number | null;
  verdict: CarryVerdict;
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
  /** 配当の全体集計 */
  dividends: DividendSummaryView;
  /** 月別の配当の銘柄内訳（12 か月分。配当が無い月も要素として持つ） */
  dividendCalendar: DividendCalendarMonth[];
  /** 国・市場別の内訳。米国株は為替影響を切り分けられるようにしている */
  markets: MarketSlice[];
  brokers: BrokerSlice[];
  alerts: ConcentrationAlert[];
  /**
   * 利息で増える現金性資産（貨幣市場基金・現金宝）の明細。
   * 株式の一覧とは別に返す。
   */
  interestAssets: InterestAssetView[];
}> {
  const [
    rows,
    settings,
    signalMap,
    cards,
    allNews,
    snapshots,
    brokerBalances,
    interestAssetRows,
  ] = await Promise.all([
    db.listHoldings(userId),
    db.getSettings(userId),
    db.latestSignals(userId),
    db.listCards(userId),
    db.listNews(userId, { limit: 500 }),
    // 前回記録からの変化を出すために履歴を読む
    db.listSnapshots(userId, 120),
    // 信用取引の借入額。株式時価から差し引かないと総資産が過大になる
    db.listBrokerBalances(userId),
    // 利息で増える現金性資産（貨幣市場基金）。株式とは別枠で純資産に加える
    db.listInterestAssets(userId),
  ]);

  const rates: FxRates = {
    usdJpy: n(settings.usdJpyRate) ?? FX_FALLBACK.usdJpy,
    sgdJpy: n(settings.sgdJpyRate) ?? FX_FALLBACK.sgdJpy,
    hkdJpy: n(settings.hkdJpyRate) ?? FX_FALLBACK.hkdJpy,
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

  /*
   * 同一銘柄を複数口座で持つ場合、業種が片方のレコードにしか入っていないことがある。
   * 業種は企業プロファイル取得時にレコード単位で保存されるため、
   * 一方だけ未取得のまま残る（実データで F34・D05・7203.T など 8 件が該当した）。
   *
   * 業種は銘柄の属性で口座ごとに変わるものではないので、
   * 同じ銘柄の他レコードに入っている値をそのまま使う。DB は書き換えずに
   * 表示上だけ補うので、次回のプロファイル取得の対象からは外れない。
   */
  const sectorBySymbol = fillMissingSectors(rows);

  const partial = rows.map(h => {
    /** 自分のレコードに業種が無い場合に限り、同一銘柄の他レコードから借りる */
    const filled = h.sector ? undefined : sectorBySymbol.get(h.symbol);
    const quantity = n(h.quantity) ?? 0;
    const avgCost = n(h.avgCost) ?? 0;
    const currentPrice = n(h.currentPrice);
    const previousClose = n(h.previousClose);
    const marketValue = currentPrice === null ? null : currentPrice * quantity;
    const costValue = avgCost * quantity;
    const pnl = marketValue === null ? null : marketValue - costValue;
    /*
     * 取得原価がマイナスの銘柄（オプションのプレミアム受取が購入代金を上回った場合）は
     * 率を出さない。詳細は calcPnlPct のコメント参照。
     */
    const pnlPct = calcPnlPct(pnl, costValue);
    const dayChangePct =
      currentPrice === null || previousClose === null || previousClose === 0
        ? null
        : ((currentPrice - previousClose) / previousClose) * 100;
    const sig = signalMap.get(h.symbol);
    const newsStat = newsBySymbol.get(h.symbol) ?? { total: 0, negative: 0 };

    /*
     * 配当。annualDividend が null なら未取得、0 なら無配として区別する。
     * 利回りは Yahoo の値を使わず現在値から自分で計算する（基準日のずれを避ける）。
     */
    const perShare = n(h.annualDividend);
    const income = annualIncome(perShare, quantity);
    // 特別配当を除いた水準。列が無い古いレコードでは年間配当をそのまま使う
    const recurringPerShare = n(h.recurringDividend) ?? perShare ?? 0;
    const divYieldPct = dividendYield(perShare ?? 0, currentPrice);
    const dividend: PositionDividendView | null =
      perShare === null || income === null
        ? null
        : {
            perShare,
            annualIncome: income,
            annualIncomeBase: toBase(income, h.currency),
            yieldPct: divYieldPct,
            yieldOnCostPct: yieldOnCost(perShare, avgCost),
            count: h.dividendCount ?? 0,
            frequency: estimateFrequency(h.dividendCount ?? 0),
            lastDate: h.lastDividendDate,
            lastAmount: n(h.lastDividendAmount),
            updatedAt: h.dividendUpdatedAt,
            hasSpecial: h.hasSpecialDividend ?? false,
            recurringPerShare,
            recurringYieldPct: dividendYield(recurringPerShare, currentPrice),
            yieldNeedsCheck: isImplausibleYield(divYieldPct),
            monthlyIncomeBase: monthlyIncomeBase(h.monthlyDividends, quantity, h.currency, toBase),
            monthlyPerShare:
              h.monthlyDividends && h.monthlyDividends.length === 12
                ? h.monthlyDividends
                : null,
          };

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
      sector: h.sector ?? filled?.sector ?? null,
      industry: h.industry ?? filled?.industry ?? null,
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
      dividend,
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

  /*
   * 利息で増える現金性資産（貨幣市場基金・現金宝）。
   *
   * 株式時価（totalValueBase）には入れない。株価が上下する資産と
   * 元本がほぼ動かない資産を同じ枠に入れると、含み損益の意味が変わるため。
   * ただし「自分のものである金額」ではあるので純資産には加える。
   */
  const interestViews = buildInterestAssetViews(interestAssetRows, rates);
  const interestSummary = summarizeInterestAssets(interestViews);

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

    /*
     * 借入金利の計算。
     *
     * IBKR は口座の基軸通貨（SGD）に換算した借入額を表示するが、
     * 金利は**実際に借りている通貨**のレートが適用される。
     * 通貨別内訳（currencyBreakdown）にマイナス残高の通貨があれば
     * それを借入通貨として扱い、無ければ口座通貨で計算する。
     */
    const borrowCurrency = detectBorrowCurrency(bal.currencyBreakdown, bal.currency);
    const interestView = buildInterestView(
      borrowCurrency,
      lev.borrowed,
      lev.interestMtd,
      rates
    );

    /*
     * 配当と金利の比較。
     * その口座の保有銘柄から入る年間配当と、借入の年間利息を比べる。
     */
    const brokerDividendBase = positions
      .filter(p => p.broker === bal.broker)
      .reduce((acc, p) => acc + (p.dividend?.annualIncomeBase ?? 0), 0);
    const carryView =
      interestView === null
        ? null
        : (() => {
            const c = evaluateCarry(brokerDividendBase, interestView.annualInterestBase);
            return {
              annualDividendBase: c.annualDividendBase,
              annualInterestBase: c.annualInterestBase,
              netCarryBase: c.netCarryBase,
              coverageRatio: c.coverageRatio,
              verdict: c.verdict,
            };
          })();

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
      interest: interestView,
      carry: carryView,
    });
  }

  const summary: PortfolioSummary = {
    totalValueBase,
    totalCostBase,
    totalPnl: totalValueBase - totalCostBase,
    totalPnlPct: calcPnlPct(totalValueBase - totalCostBase, totalCostBase),
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
    hkdJpyRate: rates.hkdJpy,
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
    /*
     * 純資産に利息資産を加える。富途香港の現金宝のように
     * 株ではないが自分の資産である現金性資産を落とすと純資産が過小になる。
     */
    netAssetsBase: totalValueBase + cashBalance + interestSummary.totalBase - totalBorrowedBase,
    /*
     * 全体のレバレッジ。株式時価 ÷ 純資産で求める。
     * 借入がなければ 1.0 前後になり、借入があると 1 を超える。
     */
    overallLeverage:
      totalValueBase + cashBalance + interestSummary.totalBase - totalBorrowedBase > 0
        ? totalValueBase /
          (totalValueBase + cashBalance + interestSummary.totalBase - totalBorrowedBase)
        : null,
    interestAssetsBase: interestSummary.totalBase,
    interestIncomeBase: interestSummary.projectedAnnualIncomeBase,
    interestRatePct: interestSummary.weightedRatePct,
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
     * 配当の全体集計。銘柄単位ではなく口座レコード単位で合計する
     * （同一銘柄を複数口座で持っていれば、その分だけ配当も増えるため）。
     */
    dividends: buildDividendSummary(positions, groups, totalValueBase, totalCostBase),
    /**
     * 月別の配当の銘柄内訳。どの月にどの銘柄から配当が入るかを見るため、
     * 口座レコード単位で保持する（同一銘柄を複数口座で持つ場合は分けて出す）。
     */
    dividendCalendar: buildDividendCalendar(positions),
    /**
     * 国・市場別の内訳。銘柄単位（groups）を集計対象にすることで、
     * 同一銘柄を複数口座で持っていても銘柄数を二重に数えない。
     */
    markets: buildMarketSlices(groups, totalValueBase),
    brokers: Array.from(brokerMap.entries())
      .map(([key, v]) => {
        /** その口座から年間いくら配当が入るか（円換算） */
        const dividendIncomeBase = positions
          .filter(p => p.broker === key)
          .reduce((acc, p) => acc + (p.dividend?.annualIncomeBase ?? 0), 0);
        return {
          key,
          label: BROKER_LABELS[key as Broker] ?? key,
          value: v.value,
          pct: totalValueBase > 0 ? (v.value / totalValueBase) * 100 : 0,
          count: v.count,
          /** 口座単位の含み損益。口座ごとの成績を比較できるようにする */
          pnl: v.value - v.cost,
          pnlPct: calcPnlPct(v.value - v.cost, v.cost),
          /** 借入がある口座のみ信用情報を付ける（現物口座は null） */
          leverage: leverageByBroker.get(key) ?? null,
          dividendIncomeBase,
          dividendYieldPct: v.value > 0 ? (dividendIncomeBase / v.value) * 100 : null,
        };
      })
      .sort((a, b) => b.value - a.value),
    alerts: alerts.sort((a, b) => b.pct - a.pct),
    /*
     * 利息資産（貨幣市場基金）の明細。額の大きい順に並べる。
     * 株式の positions とは意味が違うので別のキーで返す。
     */
    interestAssets: interestViews.sort((a, b) => (b.amountBase ?? 0) - (a.amountBase ?? 0)),
  };
}

/**
 * 配当の全体集計を作る。
 *
 * 銘柄数のカウントは銘柄単位（groups）で行い、金額は口座レコード単位で合計する。
 * 「配当を出す銘柄が何件あるか」は銘柄で数えたいが、
 * 「年間いくら入るか」は保有株数の合計に比例するため。
 */
function buildDividendSummary(
  positions: PositionView[],
  groups: GroupedPosition[],
  totalValueBase: number,
  totalCostBase: number
): DividendSummaryView {
  const annualIncomeBase = positions.reduce(
    (acc, p) => acc + (p.dividend?.annualIncomeBase ?? 0),
    0
  );

  /*
   * 月別の合計。各保有の月別受取額（既に円換算済み）を足し込む。
   * 口座レコード単位で足すため、同じ銘柄を複数口座で持っていても
   * それぞれの株数分が正しく反映される。
   */
  const monthlyTotals = emptyMonths();
  for (const p of positions) {
    const m = p.dividend?.monthlyIncomeBase;
    if (!m) continue;
    for (let i = 0; i < 12; i++) {
      if (Number.isFinite(m[i])) monthlyTotals[i] += m[i];
    }
  }

  /*
   * 特別配当を除いた受取額。円換算は annualIncomeBase と同じ比率で按分する
   * （為替レートを再計算せずに済むよう、1 株配当の比で割り戻す）。
   */
  let recurringIncomeBase = 0;
  let specialCount = 0;
  for (const p of positions) {
    const d = p.dividend;
    if (!d || d.annualIncomeBase === null) continue;
    if (d.perShare > 0 && d.recurringPerShare !== d.perShare) {
      recurringIncomeBase += d.annualIncomeBase * (d.recurringPerShare / d.perShare);
    } else {
      recurringIncomeBase += d.annualIncomeBase;
    }
  }
  for (const g of groups) {
    if (g.entries.some(e => e.dividend?.hasSpecial)) specialCount += 1;
  }

  /*
   * 銘柄単位の分類。同一銘柄を複数口座で持っていても 1 件と数える。
   * 配当情報は銘柄に紐づくので、どの口座のレコードを見ても同じ値になる。
   */
  let payingCount = 0;
  let nonPayingCount = 0;
  let unknownCount = 0;
  for (const g of groups) {
    const div = g.entries.find(e => e.dividend !== null)?.dividend;
    if (!div) {
      unknownCount += 1;
    } else if (div.perShare > 0) {
      payingCount += 1;
    } else {
      nonPayingCount += 1;
    }
  }

  // 最後に取得した時刻は最も新しいものを採る
  let updatedAt: Date | null = null;
  for (const p of positions) {
    const t = p.dividend?.updatedAt ?? null;
    if (t && (updatedAt === null || t > updatedAt)) updatedAt = t;
  }

  return {
    annualIncomeBase,
    yieldPct: totalValueBase > 0 ? (annualIncomeBase / totalValueBase) * 100 : null,
    yieldOnCostPct: totalCostBase > 0 ? (annualIncomeBase / totalCostBase) * 100 : null,
    monthlyAverageBase: annualIncomeBase / 12,
    payingCount,
    nonPayingCount,
    unknownCount,
    updatedAt,
    recurringIncomeBase,
    specialCount,
    monthlyIncomeBase: monthlyTotals,
    peakMonth: peakDividendMonth(monthlyTotals),
    concentration: dividendConcentration(monthlyTotals),
  };
}

/**
 * 1 株あたりの月別配当を、保有株数と為替を掛けて円換算した月別受取額にする。
 *
 * 換算できない通貨（想定外の通貨）や月別データが無い銘柄は null を返し、
 * 「0 円」と「不明」を混同しないようにする。
 *
 * @param monthly DB に保存された 1 株あたりの月別配当（12 要素）
 * @param quantity 保有株数
 * @param currency 銘柄の通貨
 * @param toBase 現地通貨 → 円の換算関数（呼び出し側の為替レートを使う）
 */
function monthlyIncomeBase(
  monthly: number[] | null,
  quantity: number,
  currency: string,
  toBase: (value: number | null, currency: string) => number | null
): number[] | null {
  if (!monthly || monthly.length !== 12) return null;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const out = emptyMonths();
  for (let m = 0; m < 12; m++) {
    const perShare = monthly[m];
    if (!Number.isFinite(perShare) || perShare <= 0) continue;
    const base = toBase(perShare * quantity, currency);
    if (base === null) return null; // 換算できない通貨は月別も出さない
    out[m] = base;
  }
  /*
   * すべての月が 0 でも配列を返す。無配の銘柄を「不明（null）」ではなく
   * 「12 か月すべて 0」として扱いたいため。
   */
  return out;
}

/**
 * 実際に借りている通貨を判定する。
 *
 * IBKR は基軸通貨（SGD）に換算した借入額を表示するが、金利は借入通貨の
 * レートで決まる。通貨別内訳のうち**最も大きなマイナス残高**を持つ通貨を
 * 借入通貨とみなす。内訳が無い場合は口座通貨で借りているものとして扱う。
 *
 * @param breakdownJson currencyBreakdown 列の JSON 文字列
 * @param fallback 内訳が無い場合に使う通貨（口座の基軸通貨）
 */
export function detectBorrowCurrency(
  breakdownJson: string | null,
  fallback: string
): string {
  if (!breakdownJson) return fallback;
  try {
    const parsed = JSON.parse(breakdownJson) as Record<string, unknown>;
    let worst: { currency: string; amount: number } | null = null;
    for (const [key, value] of Object.entries(parsed)) {
      // 検算用に入れた補助キー（__reportedPositionValue など）は通貨ではない
      if (key.startsWith("__")) continue;
      const amount = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(amount) || amount >= 0) continue;
      if (worst === null || amount < worst.amount) worst = { currency: key, amount };
    }
    return worst?.currency ?? fallback;
  } catch {
    // 壊れた JSON が入っていても評価額の計算は続けたい
    return fallback;
  }
}

/**
 * 借入金利の計算結果を画面表示用に組み立てる。
 *
 * 借入額は円換算済みの値（borrowedBase）で渡されるため、
 * 借入通貨に戻してから階層に当てる。階層の区切りは借入通貨の
 * 金額で定義されているので、円のまま当てると誤った階層になる。
 *
 * @param borrowCurrency 実際に借りている通貨
 * @param borrowedBase 借入額（円換算、正の数）
 * @param interestMtdBase 月初来の支払利息（円換算、負値）
 */
function buildInterestView(
  borrowCurrency: string,
  borrowedBase: number,
  interestMtdBase: number,
  rates: FxRates
): MarginInterestView | null {
  if (borrowedBase <= 0) return null;

  /*
   * 円換算額を借入通貨に戻す。JPY 借入なら換算は不要。
   * 1 単位が何円かを求めて割り戻す。
   */
  const unitInJpy = convertToJpy(1, borrowCurrency, rates);
  if (unitInJpy === null || unitInJpy <= 0) return null;
  const borrowedLocal = borrowedBase / unitInJpy;

  const result = computeMarginInterest(borrowedLocal, borrowCurrency);
  if (result === null) return null;

  /*
   * 実績からの年換算。月初来利息は「今月 1 日から今日まで」の累計なので、
   * 経過日数で割って 365 倍する。月初の 1〜2 日は日数が少なく誤差が大きいため、
   * 3 日未満は算出しない。
   */
  const dayOfMonth = new Date().getDate();
  const annualInterestFromActualBase =
    dayOfMonth >= 3 && interestMtdBase !== 0
      ? (Math.abs(interestMtdBase) / dayOfMonth) * 365
      : null;

  return {
    currency: result.currency,
    borrowed: result.borrowed,
    annualInterest: result.annualInterest,
    annualInterestBase: result.annualInterest * unitInJpy,
    effectiveRatePct: result.effectiveRatePct,
    breakdown: result.breakdown,
    annualInterestFromActualBase,
  };
}

/**
 * 保有・ウォッチリスト全銘柄の株価を更新する。
 */
export async function syncPrices(userId: number): Promise<{
  updated: number;
  failed: string[];
  /** 更新できた為替レート。取得に失敗した通貨は null */
  fxRates: { usdJpy: number | null; sgdJpy: number | null; hkdJpy: number | null };
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
        /*
         * 借入と純資産も残す。信用取引があると総評価額は実質の資産より大きく出るため、
         * 後から純資産の推移を復元できるようにしておく。
         */
        borrowed: summary.totalBorrowedBase.toFixed(2),
        netAssets: summary.netAssetsBase.toFixed(2),
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
): Promise<{ usdJpy: number | null; sgdJpy: number | null; hkdJpy: number | null }> {
  if (!enabled) return { usdJpy: null, sgdJpy: null, hkdJpy: null };

  /*
   * 通貨ごとに個別に扱う。1 つの取得に失敗しても、他が更新できたほうが
   * 評価額は正確になる。
   */
  const [usdResult, sgdResult, hkdResult] = await Promise.allSettled([
    fetchUsdJpyRate(),
    fetchSgdJpyRate(),
    fetchHkdJpyRate(),
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
  /*
    HKD は米ドルペッグ（1 USD ≒ 7.75〜7.85 HKD）なので、HKD/JPY は
    USD/JPY のおよそ 8 分の 1 になる。桁違いの値を弾くために範囲を絞る。
  */
  const hkdJpy = pick(hkdResult, "HKD/JPY", 5, 60);

  const patch: {
    usdJpyRate?: string;
    sgdJpyRate?: string;
    hkdJpyRate?: string;
    fxRateUpdatedAt?: Date;
  } = {};
  if (usdJpy !== null) patch.usdJpyRate = usdJpy.toFixed(4);
  if (sgdJpy !== null) patch.sgdJpyRate = sgdJpy.toFixed(4);
  if (hkdJpy !== null) patch.hkdJpyRate = hkdJpy.toFixed(4);

  if (Object.keys(patch).length > 0) {
    patch.fxRateUpdatedAt = new Date();
    try {
      await db.updateSettings(userId, patch);
    } catch (error) {
      console.warn("[portfolio] 為替レートの保存に失敗:", error);
      return { usdJpy: null, sgdJpy: null, hkdJpy: null };
    }
  }

  return { usdJpy, sgdJpy, hkdJpy };
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
/**
 * 配当情報を取得して保有銘柄に保存する。
 *
 * 配当は年に 1〜4 回しか変わらないため株価とは別サイクルで更新する。
 * 同一銘柄を複数口座で持つ場合は API を 1 回だけ呼び、全レコードに反映する。
 *
 * @param force true なら取得済みの銘柄も再取得する
 * @param offset 分割実行用の開始位置（本番の 180 秒制限対策）
 * @param batchSize 1 回で処理する銘柄数
 */
export async function syncDividends(
  userId: number,
  options: { force?: boolean; offset?: number; batchSize?: number } = {}
): Promise<{
  updated: number;
  failed: string[];
  /** 処理した銘柄数（重複排除後） */
  processed: number;
  /** 対象の総銘柄数 */
  total: number;
  /** 次に渡すべき offset。null なら完了 */
  nextOffset: number | null;
}> {
  const { force = false, offset = 0, batchSize = 20 } = options;
  const hs = await db.listHoldings(userId);

  /*
   * 銘柄単位で重複排除する。同じ銘柄を複数口座で持っていても
   * 配当額（1 株あたり）は同じなので API 呼び出しは 1 回で済む。
   */
  const bySymbol = new Map<string, typeof hs>();
  for (const h of hs) {
    const list = bySymbol.get(h.symbol) ?? [];
    list.push(h);
    bySymbol.set(h.symbol, list);
  }

  // 未取得のものを優先し、force 指定時は全件を対象にする
  const allSymbols = Array.from(bySymbol.keys());
  const targets = force
    ? allSymbols
    : allSymbols.filter(s => bySymbol.get(s)!.some(h => h.dividendUpdatedAt === null));

  const total = targets.length;
  const slice = targets.slice(offset, offset + batchSize);
  if (slice.length === 0) {
    return { updated: 0, failed: [], processed: 0, total, nextOffset: null };
  }

  const failed: string[] = [];
  let updated = 0;
  const now = new Date();

  // Autoscale の 1 vCPU を考慮して同時実行を控えめにする
  const concurrency = 4;
  for (let i = 0; i < slice.length; i += concurrency) {
    const batch = slice.slice(i, i + concurrency);
    const histories = await Promise.all(
      batch.map(async symbol => ({ symbol, history: await fetchDividendHistory(symbol) }))
    );

    for (const { symbol, history } of histories) {
      if (!history) {
        failed.push(symbol);
        continue;
      }
      const summary = summarizeDividends(history.dividends, history.splits, now);
      const rows = bySymbol.get(symbol) ?? [];
      for (const h of rows) {
        await db.updateHolding(userId, h.id, {
          annualDividend: summary.annualDividend.toFixed(6),
          dividendCount: summary.count,
          hasSpecialDividend: summary.hasSpecialDividend,
          recurringDividend: summary.recurringDividend.toFixed(6),
          monthlyDividends: summary.monthlyDividends,
          lastDividendDate: summary.lastDate ?? undefined,
          lastDividendAmount:
            summary.lastAmount === null ? undefined : summary.lastAmount.toFixed(6),
          dividendUpdatedAt: now,
        });
        updated += 1;
      }
    }
  }

  const consumed = offset + slice.length;
  return {
    updated,
    failed: Array.from(new Set(failed)),
    processed: slice.length,
    total,
    nextOffset: consumed < total ? consumed : null,
  };
}
