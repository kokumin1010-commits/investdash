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
