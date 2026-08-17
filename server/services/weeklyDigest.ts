/**
 * 週次レポートの材料を集める。
 *
 * 112 銘柄すべてを AI に渡すと 1 回の生成で 40 分以上かかり、cron の
 * 2 分制限に収まらない。そこで「今週語るべきこと」を機械的に絞り、
 * AI に渡すのは絞った結果だけにする。AI 呼び出しは 1 回で終わる。
 *
 * 絞り込みは数値で決められることだけを扱う（判定が変わった、株価が
 * 大きく動いた、影響度の高いニュースが出た）。何を意味するかの解釈は
 * AI に任せる。
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../db";
import * as db from "../db";
import { bandTransitions, newsItems } from "../../drizzle/schema";
import { classifyTransition, type BandState } from "../../shared/bandTransition";
import { listPlanOverview } from "./priceBandService";

/** 株価の変動をレポートに載せる下限（%）。これ未満は「動いていない」扱い */
export const PRICE_MOVE_THRESHOLD_PCT = 8;
/**
 * ニュースをレポートに載せる影響度の下限。
 * impactScore は 0〜100 なので、上位に相当する 70 を境にする。
 */
export const NEWS_IMPACT_THRESHOLD = 70;
/** AI に渡す銘柄数の上限。多すぎると生成が長くなり読む側も追えない */
export const MAX_TOPICS = 12;

export type DigestTopic = {
  symbol: string;
  name: string;
  /** なぜ取り上げるのか（機械的な理由） */
  reasons: string[];
  currentPrice: number | null;
  currency: string;
  /** 今の段 */
  actionLabel: string | null;
  /** 次の段まで何 %（下がる方向を負で表す） */
  nextGapPct: number | null;
  nextActionLabel: string | null;
  /** 期間中の判定変化 */
  transitions: { description: string; importance: string; at: Date }[];
  /** 期間中の重要ニュース */
  news: { title: string; summary: string | null; impactScore: number | null; sentiment: string | null }[];
  /**
   * 評価額（現地通貨）。規模の大小を AI に伝えるために持つ。
   * 通貨が混ざるので単純な大小比較には使えないが、並び順の目安として使う。
   */
  valueLocal: number | null;
  /** 判断を要するか */
  needsAction: boolean;
};

export type DigestInput = {
  periodStart: Date;
  periodEnd: Date;
  /** 資産の全体像 */
  overview: {
    stockValueJpy: number;
    borrowedJpy: number;
    netAssetsJpy: number;
    leverage: number | null;
    annualDividendJpy: number;
    holdingsCount: number;
    /** 利息で増える現金性資産（現金宝など） */
    interestAssetsJpy: number;
  };
  /** 買い増し圏にいる銘柄の数 */
  buyZoneCount: number;
  topics: DigestTopic[];
  /** 取り上げる材料がなかった場合の理由 */
  quietReason: string | null;
};

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できません");
  return d;
}

/**
 * 期間内の材料を集めて絞る。
 *
 * @param days 何日分を対象にするか（週次なら 7）
 */
export async function buildDigestInput(userId: number, days = 7): Promise<DigestInput> {
  const d = await requireDb();
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);

  const [overview, holdings, transitionRows, newsRows] = await Promise.all([
    listPlanOverview(userId),
    db.listHoldings(userId),
    d
      .select()
      .from(bandTransitions)
      .where(and(eq(bandTransitions.userId, userId), gte(bandTransitions.createdAt, periodStart)))
      .orderBy(desc(bandTransitions.createdAt)),
    d
      .select()
      .from(newsItems)
      .where(and(eq(newsItems.userId, userId), gte(newsItems.publishedAt, periodStart)))
      .orderBy(desc(newsItems.impactScore)),
  ]);

  /*
   * 銘柄ごとの評価額（円）。同じ銘柄を複数口座で持つ場合は合算する。
   * 規模が分からないと「1 万円の銘柄」と「4500 万円の銘柄」を
   * 同じ重みで書いてしまう。
   */
  const valueBySymbol = new Map<string, number>();
  const nameBySymbol = new Map<string, string>();
  for (const h of holdings) {
    if (!nameBySymbol.has(h.symbol)) nameBySymbol.set(h.symbol, h.name);
    /*
     * 評価額は保存されていないので株数 × 現在値で出す。
     * 円換算はしない（AI には通貨も併せて渡すため、規模の比較は
     * プロンプト側で通貨を明示して伝える）。
     */
    const price = h.currentPrice === null ? null : Number(h.currentPrice);
    const v = price === null ? 0 : Number(h.quantity) * price;
    valueBySymbol.set(h.symbol, (valueBySymbol.get(h.symbol) ?? 0) + v);
  }

  const topicBySymbol = new Map<string, DigestTopic>();
  const ensureTopic = (symbol: string): DigestTopic => {
    const existing = topicBySymbol.get(symbol);
    if (existing) return existing;
    const ov = overview.find(o => o.symbol === symbol);
    const topic: DigestTopic = {
      symbol,
      name: nameBySymbol.get(symbol) ?? symbol,
      reasons: [],
      currentPrice: ov?.currentPrice ?? null,
      currency: ov?.currency ?? "",
      actionLabel: ov?.actionLabel ?? null,
      nextGapPct: ov?.nextGapPct ?? null,
      nextActionLabel: ov?.nextActionLabel ?? null,
      transitions: [],
      news: [],
      valueLocal: valueBySymbol.get(symbol) ?? null,
      needsAction: false,
    };
    topicBySymbol.set(symbol, topic);
    return topic;
  };

  /* 1) 判定が変わった銘柄 */
  for (const row of transitionRows) {
    const prev: BandState | null =
      row.fromAction === null && row.fromLabel === null
        ? null
        : { action: row.fromAction, label: row.fromLabel, outsideDirection: null };
    const next: BandState = {
      action: row.toAction,
      label: row.toLabel,
      outsideDirection: row.outsideDirection,
    };
    const importance = classifyTransition(prev, next);
    /*
     * 静観のままの記録は載せない。初回の一括記録で 107 件出ており、
     * これを載せると本当に変わったものが埋もれる。
     */
    if (importance === "LOW") continue;

    const topic = ensureTopic(row.symbol);
    topic.transitions.push({
      description: row.toLabel ?? "不明",
      importance,
      at: row.createdAt,
    });
    if (!topic.reasons.includes("判定が変わった")) topic.reasons.push("判定が変わった");
    if (importance === "HIGH") topic.needsAction = true;
  }

  /* 2) 買い増し圏にいる銘柄（判定が変わっていなくても、入っている間は毎回載せる） */
  for (const ov of overview) {
    if (ov.action !== "ADD_SMALL" && ov.action !== "ADD_MAIN") continue;
    const topic = ensureTopic(ov.symbol);
    if (!topic.reasons.includes("買い増しの価格帯にいる")) {
      topic.reasons.push("買い増しの価格帯にいる");
    }
    topic.needsAction = true;
  }

  /* 3) 確認が必要／懸念が見つかっている銘柄 */
  for (const ov of overview) {
    if (ov.concernCount > 0) {
      const topic = ensureTopic(ov.symbol);
      topic.reasons.push(`懸念材料 ${ov.concernCount} 件`);
      topic.needsAction = true;
    } else if (ov.needsCheck) {
      const topic = ensureTopic(ov.symbol);
      topic.reasons.push("確認項目が未照合");
    }
  }

  /* 4) 影響度の高いニュースが出た銘柄 */
  for (const n of newsRows) {
    if ((n.impactScore ?? 0) < NEWS_IMPACT_THRESHOLD) continue;
    if (!n.symbol) continue;
    // 保有していない銘柄のニュースは載せない（ウォッチリストは別途扱う）
    if (!valueBySymbol.has(n.symbol)) continue;

    const topic = ensureTopic(n.symbol);
    // 1 銘柄あたり 3 件まで。同じ銘柄のニュースで埋まると他が入らない
    if (topic.news.length >= 3) continue;
    topic.news.push({
      title: n.title,
      summary: n.summary,
      impactScore: n.impactScore,
      sentiment: n.sentiment,
    });
    if (!topic.reasons.includes("影響度の高いニュース")) {
      topic.reasons.push("影響度の高いニュース");
    }
  }

  /*
   * 並び順は「判断が必要 → 評価額が大きい」。
   * 上限で切るとき、金額の大きい銘柄が落ちると意味がない。
   */
  const topics = Array.from(topicBySymbol.values())
    .sort((a, b) => {
      if (a.needsAction !== b.needsAction) return a.needsAction ? -1 : 1;
      return (b.valueLocal ?? 0) - (a.valueLocal ?? 0);
    })
    .slice(0, MAX_TOPICS);

  const portfolio = await (await import("./portfolio")).buildPortfolio(userId);
  const buyZoneCount = overview.filter(
    o => o.action === "ADD_SMALL" || o.action === "ADD_MAIN"
  ).length;

  return {
    periodStart,
    periodEnd,
    overview: {
      stockValueJpy: portfolio.summary.totalValueBase,
      borrowedJpy: portfolio.summary.totalBorrowedBase,
      netAssetsJpy: portfolio.summary.netAssetsBase,
      leverage: portfolio.summary.overallLeverage,
      annualDividendJpy: portfolio.dividends?.annualIncomeBase ?? 0,
      holdingsCount: holdings.length,
      interestAssetsJpy: portfolio.summary.interestAssetsBase,
    },
    buyZoneCount,
    topics,
    quietReason:
      topics.length === 0
        ? "判定の変化・買い増し圏の銘柄・影響度の高いニュースのいずれもありませんでした"
        : null,
  };
}
