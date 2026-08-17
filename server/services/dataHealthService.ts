/**
 * データの健全性チェック。
 *
 * 自動更新は稼働しているが、失敗した銘柄があっても気付けない状態だった。
 * 112 銘柄あるので 1〜2 銘柄が静かに古くなっても分からない。
 * 古い株価で買い増し圏を判定すると、実際には圏外なのに「買い場」と
 * 出てしまう。判断を誤らせる方向の不具合なので検知する。
 */
import * as db from "../db";
import {
  judgeFreshness,
  summarizeFreshness,
  type FreshnessLevel,
  type FreshnessSummary,
} from "../../shared/dataFreshness";

export type HealthItem = {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  /** 保有かウォッチリストか。対処が違う（ウォッチは登録間違いの可能性が高い） */
  held: boolean;
  currentPrice: number | null;
  priceUpdatedAt: Date | null;
  level: FreshnessLevel;
  label: string;
  hoursAgo: number | null;
  businessDaysAgo: number | null;
  /** 評価額（円）。大きい銘柄が古いほど影響が大きい */
  valueJpy: number | null;
};

export type DataHealth = {
  summary: FreshnessSummary;
  /** 対処が必要な銘柄のみ。正常なものは件数だけで足りる */
  problems: HealthItem[];
  /** 最後に株価更新が走った時刻 */
  lastSyncAt: Date | null;
  checkedAt: Date;
};

/**
 * 保有・ウォッチリストの株価鮮度をまとめて判定する。
 *
 * 同じ銘柄を複数口座で持っていても 1 件として数える。
 * 株価は銘柄単位で取得しているので、口座ごとに数えると
 * 「3 銘柄が古い」が「7 件が古い」に膨らんで実態が分からなくなる。
 */
export async function checkDataHealth(userId: number, now = new Date()): Promise<DataHealth> {
  const [holdings, watch, settings] = await Promise.all([
    db.listHoldings(userId),
    db.listWatchlist(userId),
    db.getSettings(userId),
  ]);

  const usdJpy = settings?.usdJpyRate ? Number(settings.usdJpyRate) : null;
  const sgdJpy = settings?.sgdJpyRate ? Number(settings.sgdJpyRate) : null;
  const hkdJpy = settings?.hkdJpyRate ? Number(settings.hkdJpyRate) : null;

  function toJpy(value: number, currency: string): number | null {
    if (currency === "JPY") return value;
    if (currency === "USD") return usdJpy !== null ? value * usdJpy : null;
    if (currency === "SGD") return sgdJpy !== null ? value * sgdJpy : null;
    if (currency === "HKD") return hkdJpy !== null ? value * hkdJpy : null;
    return null;
  }

  /** 銘柄単位に畳む。評価額は同じ銘柄の全口座を合算する */
  const bySymbol = new Map<string, HealthItem>();

  for (const h of holdings) {
    const price = h.currentPrice !== null ? Number(h.currentPrice) : null;
    const shares = Number(h.quantity);
    const value = price !== null ? toJpy(price * shares, h.currency) : null;
    const existing = bySymbol.get(h.symbol);
    if (existing) {
      // 評価額だけ足す。更新時刻は銘柄で共通なので最初のものを使う
      existing.valueJpy =
        existing.valueJpy !== null && value !== null ? existing.valueJpy + value : existing.valueJpy ?? value;
      continue;
    }
    const f = judgeFreshness(price, h.priceUpdatedAt ?? null, now);
    bySymbol.set(h.symbol, {
      symbol: h.symbol,
      name: h.name,
      market: h.market,
      currency: h.currency,
      held: true,
      currentPrice: price,
      priceUpdatedAt: h.priceUpdatedAt ?? null,
      level: f.level,
      label: f.label,
      hoursAgo: f.hoursAgo,
      businessDaysAgo: f.businessDaysAgo,
      valueJpy: value,
    });
  }

  for (const w of watch) {
    // 保有している銘柄は保有側の判定を優先する（同じ株価を見ているため）
    if (bySymbol.has(w.symbol)) continue;
    const price = w.currentPrice !== null ? Number(w.currentPrice) : null;
    const f = judgeFreshness(price, w.priceUpdatedAt ?? null, now);
    bySymbol.set(w.symbol, {
      symbol: w.symbol,
      name: w.name,
      market: w.market,
      currency: w.currency,
      held: false,
      currentPrice: price,
      priceUpdatedAt: w.priceUpdatedAt ?? null,
      level: f.level,
      label: f.label,
      hoursAgo: f.hoursAgo,
      businessDaysAgo: f.businessDaysAgo,
      valueJpy: null,
    });
  }

  const items = Array.from(bySymbol.values());
  const summary = summarizeFreshness(
    items.map(i => ({
      freshness: {
        level: i.level,
        hoursAgo: i.hoursAgo,
        businessDaysAgo: i.businessDaysAgo,
        label: i.label,
      },
      updatedAt: i.priceUpdatedAt,
    }))
  );

  /*
   * 対処が必要なものだけ返す。並びは「取得できていない → 古い」の順、
   * 同じ区分なら評価額の大きい順。金額が大きい銘柄が古いほど
   * 判断への影響が大きい。
   */
  const problems = items
    .filter(i => i.level !== "FRESH")
    .sort((a, b) => {
      if (a.level !== b.level) return a.level === "MISSING" ? -1 : 1;
      return (b.valueJpy ?? 0) - (a.valueJpy ?? 0);
    });

  return {
    summary,
    problems,
    lastSyncAt: settings?.lastPriceSyncAt ?? null,
    checkedAt: now,
  };
}
