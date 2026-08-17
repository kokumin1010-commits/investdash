/**
 * 投資カードの AI 下書きを保存するサービス層。
 *
 * 既存のカードを上書きしない。手で直した内容が AI の下書きで
 * 消えると、直す気力がなくなって使われなくなる。
 */
import * as db from "../db";
import { buildPortfolio } from "./portfolio";
import { fetchCompanyProfile } from "./marketData";
import { draftCard, CARD_MODEL, type CardDraftContext } from "./cardDrafter";
import { withAiRunLog } from "./aiRunLog";
import { normalizeSymbol } from "../../shared/investing";
import { extractCardFields, mergeField } from "./consultToCard";
import { getConsultation } from "./consultService";
import { listPlanOverview } from "./priceBandService";
import { isEarningsNews } from "../../shared/eventDetect";
import {
  CARD_TRIGGER_LABELS,
  selectCardTargets,
  type CardCandidate,
} from "../../shared/cardTrigger";

/**
 * カード自動生成のきっかけとして見るニュースの日数。
 *
 * 長く取ると古い決算で毎回生成対象になり続ける。
 * 短すぎると週末や取得失敗の日にきっかけを取り逃す。
 */
export const TRIGGER_NEWS_DAYS = 14;

/** 投資カードが実質的に空か（AI の下書き対象か）を判定する */
export function isCardEmpty(card: {
  buyReason: string | null;
  coreThesis: string | null;
  valuationAssumption: string | null;
  exitConditions: string | null;
  risks: string | null;
} | null): boolean {
  if (!card) return true;
  const filled = [
    card.buyReason,
    card.coreThesis,
    card.valuationAssumption,
    card.exitConditions,
    card.risks,
  ].filter(v => (v ?? "").trim().length > 0);
  return filled.length === 0;
}

/**
 * 1 銘柄の投資カードを AI に下書きさせて保存する。
 *
 * @param force すでに内容があっても上書きするか
 */
export async function draftCardForSymbol(
  userId: number,
  symbol: string,
  force = false
): Promise<{ symbol: string; created: boolean; reason?: string }> {
  const holdings = await db.listHoldings(userId);
  const rows = holdings.filter(h => h.symbol === symbol);
  if (rows.length === 0) throw new Error(`保有銘柄に ${symbol} が見つかりません`);
  const holding = rows[0];

  const existing = await db.getCard(userId, symbol);
  if (!force && !isCardEmpty(existing)) {
    return { symbol, created: false, reason: "すでに内容があるため上書きしません" };
  }

  const [news, portfolio, profile] = await Promise.all([
    db.listNews(userId, { symbol, limit: 8 }),
    buildPortfolio(userId),
    // 事業内容はカードの根拠として重要なので都度取得する
    fetchCompanyProfile(symbol).catch(() => null),
  ]);

  const view = portfolio.groups.find(g => g.symbol === symbol);
  const currentPrice = view?.currentPrice ?? null;
  const annualDividend = holding.annualDividend ? Number(holding.annualDividend) : null;
  const dividendYieldPct =
    annualDividend !== null && currentPrice !== null && currentPrice > 0
      ? (annualDividend / currentPrice) * 100
      : null;

  const ctx: CardDraftContext = {
    symbol,
    name: holding.name,
    market: normalizeSymbol(symbol).market,
    currency: holding.currency,
    sector: holding.sector,
    industry: holding.industry,
    businessSummary: profile?.businessSummary ?? null,
    quantity: view?.quantity ?? Number(holding.quantity),
    avgCost: view?.avgCost ?? Number(holding.avgCost),
    currentPrice,
    fiftyTwoWeekHigh: view?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: view?.fiftyTwoWeekLow ?? null,
    dividendYieldPct,
    annualDividendLocal: annualDividend,
    pnlPct: view?.pnlPct ?? null,
    weightPct: view?.weightPct ?? null,
    news: news.map(n => ({
      title: n.title,
      summary: n.summary,
      impactScore: n.impactScore,
    })),
  };

  const draft = await withAiRunLog(
    {
      userId,
      kind: "card_draft",
      symbol,
      model: CARD_MODEL,
      summarize: r => r.coreThesis.slice(0, 120),
    },
    async () => draftCard(ctx)
  );

  await db.upsertCard({
    userId,
    symbol,
    holdingId: holding.id,
    buyReason: draft.buyReason,
    coreThesis: draft.coreThesis,
    valuationAssumption: draft.valuationAssumption,
    exitConditions: draft.exitConditions,
    risks: draft.risks,
    horizon: draft.horizon,
    conviction: draft.conviction,
    // fairValue は AI に推定させない（根拠のない目標株価は判断を誤らせる）
  });

  return { symbol, created: true };
}

/**
 * カードが空の銘柄を評価額の大きい順に下書きする。
 */

/**
 * 相談の内容を投資カードに書き戻す。
 *
 * 相談では「何が崩れたら降りるか」が出るが、相談画面の中に埋もれると
 * 次に株価が動いたときに参照されない。カードに移せば AI シグナルも
 * その条件を判断材料に使う。
 *
 * @param mode append=既存に追記（既定） / overwrite=置き換え
 */
export async function applyConsultToCard(params: {
  userId: number;
  consultationId: number;
  mode?: "append" | "overwrite";
}): Promise<{
  symbol: string;
  applied: string[];
  skipped: string[];
  note: string | null;
}> {
  const { userId, consultationId, mode = "append" } = params;

  const detail = await getConsultation(userId, consultationId);
  if (!detail) throw new Error("相談が見つかりません");

  const symbol = detail.consultation.symbol;
  /*
   * 銘柄を指定しない相談（全体の方針など）はどのカードに書けばよいか
   * 決められない。勝手に選ぶと関係ない銘柄に書き込まれる。
   */
  if (!symbol) {
    throw new Error("この相談は銘柄を指定していないため、投資カードに反映できません");
  }

  const holdings = await db.listHoldings(userId);
  const holding = holdings.find(h => h.symbol === symbol);
  if (!holding) throw new Error(`保有銘柄に ${symbol} が見つかりません`);

  const extracted = await extractCardFields({
    userId,
    symbol,
    name: holding.name,
    turns: detail.messages.map(m => ({ role: m.role, content: m.content })),
  });

  const existing = await db.getCard(userId, symbol);
  const today = new Date().toLocaleDateString("ja-JP");

  const fields = [
    { key: "exitConditions", label: "エグジット条件" },
    { key: "risks", label: "想定リスク" },
    { key: "coreThesis", label: "コア投資ロジック" },
    { key: "valuationAssumption", label: "バリュエーション前提" },
  ] as const;

  const applied: string[] = [];
  const skipped: string[] = [];
  const next: Record<string, string | null> = {};

  for (const f of fields) {
    const value = extracted[f.key];
    if (!value) {
      skipped.push(f.label);
      next[f.key] = existing?.[f.key] ?? null;
      continue;
    }
    next[f.key] =
      mode === "overwrite" ? value : mergeField(existing?.[f.key], value, today);
    applied.push(f.label);
  }

  await db.upsertCard({
    userId,
    symbol,
    holdingId: holding.id,
    // 相談で触れていない項目は既存のまま残す（消すと手で書いた内容が失われる）
    buyReason: existing?.buyReason ?? null,
    coreThesis: next.coreThesis,
    valuationAssumption: next.valuationAssumption,
    exitConditions: next.exitConditions,
    risks: next.risks,
    keyFinancials: existing?.keyFinancials ?? null,
    fairValue: existing?.fairValue ?? null,
    horizon: existing?.horizon ?? null,
    conviction: existing?.conviction ?? null,
  });

  return { symbol, applied, skipped, note: extracted.note };
}

/**
 * （以下は既存の一括下書き）
 *
 * 評価額順にするのは、金額の大きい銘柄ほど判断を誤ったときの
 * 影響が大きいため。上限を設けるのは、全 112 銘柄を一度に回すと
 * 40 分以上かかり途中で失敗したときに何が終わったか分からなくなるため。
 */
export async function draftMissingCards(
  userId: number,
  limit = 10
): Promise<{ processed: number; created: number; failed: string[]; remaining: number }> {
  const [holdings, portfolio] = await Promise.all([
    db.listHoldings(userId),
    buildPortfolio(userId),
  ]);

  const symbols = Array.from(new Set(holdings.map(h => h.symbol)));
  const cards = await Promise.all(symbols.map(s => db.getCard(userId, s)));

  const empty = symbols.filter((_, i) => isCardEmpty(cards[i]));
  // 円換算の評価額で並べる。通貨が混在するため現地通貨では比較できない
  const valueOf = (s: string) =>
    portfolio.groups.find(g => g.symbol === s)?.marketValueBase ?? 0;
  empty.sort((a, b) => valueOf(b) - valueOf(a));

  const targets = empty.slice(0, limit);
  let created = 0;
  const failed: string[] = [];

  for (const symbol of targets) {
    try {
      const r = await draftCardForSymbol(userId, symbol, false);
      if (r.created) created += 1;
    } catch (error) {
      console.error(`[cardService] draft failed for ${symbol}:`, error);
      failed.push(symbol);
    }
  }

  return {
    processed: targets.length,
    created,
    failed,
    remaining: Math.max(0, empty.length - targets.length),
  };
}

/**
 * 「今カードが必要な銘柄」だけを自動で作る。
 *
 * 【なぜ全件ではないのか】
 * 112 銘柄を機械的に埋めると 40 分以上かかり、材料のない銘柄は
 * 一般論だけのカードになる。カードの目的は「株が下がったとき、
 * 当初の想定が崩れたのか単に下がっただけかを区別する」ことなので、
 * 判断が必要になった瞬間にその時点の情報で作られた方が正確。
 *
 * 買い増し圏に入った・決算が出た・重大なニュースが出た銘柄を選ぶ。
 * 選別は shared/cardTrigger.ts の純関数（DB を触らずテストできる）。
 */
export async function draftTriggeredCards(
  userId: number,
  limit = 5
): Promise<{
  processed: number;
  created: number;
  failed: string[];
  remaining: number;
  reasons: { symbol: string; reason: string; label: string }[];
}> {
  const [holdings, portfolio, plans] = await Promise.all([
    db.listHoldings(userId),
    buildPortfolio(userId),
    listPlanOverview(userId).catch(() => []),
  ]);

  const symbols = Array.from(new Set(holdings.map(h => h.symbol)));
  const cards = await Promise.all(symbols.map(s => db.getCard(userId, s)));
  const cardEmptyBySymbol = new Map(symbols.map((s, i) => [s, isCardEmpty(cards[i])]));

  /*
   * 直近のニュースだけを見る。過去のニュースで毎回生成すると、
   * 同じ決算をきっかけに何度も作られる（カードが空のままなら
   * 対象に残り続けるため）。
   */
  const since = new Date(Date.now() - TRIGGER_NEWS_DAYS * 86_400_000);
  const allNews = await db.listNews(userId, { limit: 1000 }).catch(() => []);
  const news = allNews.filter(n => {
    const at = n.publishedAt ?? n.createdAt;
    return at !== null && at.getTime() >= since.getTime();
  });
  const earningsSymbols = new Set<string>();
  const maxImpact = new Map<string, number>();
  for (const n of news) {
    if (isEarningsNews(n.title, n.summary)) earningsSymbols.add(n.symbol);
    const impact = n.impactScore ?? 0;
    const prev = maxImpact.get(n.symbol) ?? 0;
    if (impact > prev) maxImpact.set(n.symbol, impact);
  }

  const planBySymbol = new Map(plans.map(p => [p.symbol, p]));
  const valueOf = (s: string) =>
    portfolio.groups.find(g => g.symbol === s)?.marketValueBase ?? 0;

  const candidates: CardCandidate[] = symbols.map(s => ({
    symbol: s,
    cardEmpty: cardEmptyBySymbol.get(s) ?? true,
    valueJpy: valueOf(s),
    bandAction: planBySymbol.get(s)?.action ?? null,
    hasEarningsNews: earningsSymbols.has(s),
    maxImpact: maxImpact.get(s) ?? null,
  }));

  const { targets, remaining } = selectCardTargets(candidates, limit);

  let created = 0;
  const failed: string[] = [];
  for (const t of targets) {
    try {
      const r = await draftCardForSymbol(userId, t.symbol, false);
      if (r.created) created += 1;
    } catch (error) {
      console.error(`[cardService] triggered draft failed for ${t.symbol}:`, error);
      failed.push(t.symbol);
    }
  }

  return {
    processed: targets.length,
    created,
    failed,
    remaining,
    reasons: targets.map(t => ({
      symbol: t.symbol,
      reason: t.reason,
      label: CARD_TRIGGER_LABELS[t.reason],
    })),
  };
}
