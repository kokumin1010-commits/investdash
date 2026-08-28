import { and, desc, eq, inArray } from "drizzle-orm";
import { addProposals } from "../../drizzle/schema";
import * as db from "../db";
import { getDb } from "../db";
import { generateProposal } from "./addProposalService";
import { summarizeDividends } from "./dividend";
import { fetchCompanyProfile, fetchDividendHistory, fetchPriceHistory, fetchQuote } from "./marketData";
import { syncNewsForTargets } from "./portfolio";
import { toFriendlyAiError } from "./aiErrors";

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できませんでした");
  return d;
}

export type WatchProposalEvidence = {
  generatedAt: string;
  price: number | null;
  priceUpdatedAt: string | null;
  rangeLow6m: number | null;
  rangeHigh6m: number | null;
  annualDividend: number | null;
  dividendCurrency: string | null;
  sector: string | null;
  industry: string | null;
  newsCount: number;
  latestNewsAt: string | null;
  fetchedNews: number;
  analyzedNews: number;
};

type WatchItemRow = NonNullable<Awaited<ReturnType<typeof db.getWatchItem>>>;

export type WatchProposalDraftDeps = {
  getWatchItem: typeof db.getWatchItem;
  updateWatchItem: typeof db.updateWatchItem;
  fetchQuote: typeof fetchQuote;
  fetchCompanyProfile: typeof fetchCompanyProfile;
  fetchPriceHistory: typeof fetchPriceHistory;
  fetchDividendHistory: typeof fetchDividendHistory;
  syncNewsForTargets: typeof syncNewsForTargets;
  listNews: typeof db.listNews;
  generateProposal: typeof generateProposal;
  now: () => Date;
};

const defaultDraftDeps: WatchProposalDraftDeps = {
  getWatchItem: db.getWatchItem,
  updateWatchItem: db.updateWatchItem,
  fetchQuote,
  fetchCompanyProfile,
  fetchPriceHistory,
  fetchDividendHistory,
  syncNewsForTargets,
  listNews: db.listNews,
  generateProposal,
  now: () => new Date(),
};

export type PendingWatchProposal = {
  id: number;
  watchItemId: number;
  symbol: string;
  stance: "BUY" | "WAIT" | "SKIP";
  conclusion: string;
  rationale: string;
  amountBase: number | null;
  limitPrice: number | null;
  priceAtProposal: number | null;
  buyConditions: string;
  invalidation: string | null;
  confidence: number;
  reviewStatus: "PENDING" | "ACCEPTED" | "EDITED" | "REJECTED";
  evidence: WatchProposalEvidence | null;
  model: string | null;
  createdAt: Date;
};

function asEvidence(value: unknown): WatchProposalEvidence | null {
  if (!value || typeof value !== "object") return null;
  return value as WatchProposalEvidence;
}

/** 各 watch item の最新提案を、確認後の状態を含めて返す */
export async function listLatestWatchProposals(
  userId: number,
  watchItemIds: number[]
): Promise<Map<number, PendingWatchProposal>> {
  if (watchItemIds.length === 0) return new Map();
  const d = await requireDb();
  const rows = await d
    .select()
    .from(addProposals)
    .where(
      and(
        eq(addProposals.userId, userId),
        inArray(addProposals.watchItemId, watchItemIds)
      )
    )
    .orderBy(desc(addProposals.createdAt), desc(addProposals.id));

  const out = new Map<number, PendingWatchProposal>();
  for (const row of rows) {
    if (row.watchItemId === null || out.has(row.watchItemId)) continue;
    out.set(row.watchItemId, {
      id: row.id,
      watchItemId: row.watchItemId,
      symbol: row.symbol,
      stance: row.stance,
      conclusion: row.conclusion,
      rationale: row.rationale,
      amountBase: row.amountBase === null ? null : Number(row.amountBase),
      limitPrice: row.limitPrice === null ? null : Number(row.limitPrice),
      priceAtProposal: row.priceAtProposal === null ? null : Number(row.priceAtProposal),
      buyConditions: row.buyConditions ?? "",
      invalidation: row.invalidation,
      confidence: row.confidence ?? 50,
      reviewStatus: row.reviewStatus ?? "PENDING",
      evidence: asEvidence(row.evidence),
      model: row.model,
      createdAt: row.createdAt,
    });
  }
  return out;
}

/** 既存呼び出し向け。最新提案が PENDING の銘柄だけを返す */
export async function listPendingWatchProposals(
  userId: number,
  watchItemIds: number[]
): Promise<Map<number, PendingWatchProposal>> {
  const latest = await listLatestWatchProposals(userId, watchItemIds);
  return new Map(Array.from(latest).filter(([, proposal]) => proposal.reviewStatus === "PENDING"));
}

/**
 * ウォッチ銘柄を先に保存した後、最新データを集めて AI 提案を DRAFT 保存する。
 * watchlist の目標価格・金額・条件はこの段階では絶対に変更しない。
 */
export async function generateWatchProposalDraft(
  userId: number,
  watchItemId: number,
  overrides: Partial<WatchProposalDraftDeps> = {}
) {
  const deps = { ...defaultDraftDeps, ...overrides };
  const item = await deps.getWatchItem(userId, watchItemId) as WatchItemRow | undefined;
  if (!item) throw new Error("ウォッチ銘柄が見つかりませんでした");

  const [quote, profile, history, dividendHistory] = await Promise.all([
    deps.fetchQuote(item.symbol),
    deps.fetchCompanyProfile(item.symbol),
    deps.fetchPriceHistory(item.symbol, "6mo", "1d"),
    deps.fetchDividendHistory(item.symbol),
  ]);

  if (quote?.price !== null && quote?.price !== undefined) {
    await deps.updateWatchItem(userId, item.id, {
      name: quote.longName || quote.shortName || item.name,
      currency: quote.currency || item.currency,
      currentPrice: String(quote.price),
      previousClose: quote.previousClose === null ? undefined : String(quote.previousClose),
      sector: profile?.sector ?? item.sector ?? undefined,
      industry: profile?.industry ?? item.industry ?? undefined,
      priceUpdatedAt: deps.now(),
    });
  }

  const newsSync = await deps.syncNewsForTargets(
    userId,
    [{ symbol: item.symbol, name: item.name, tickerCode: item.tickerCode, market: item.market }],
    { windowDays: 30 }
  );
  const news = await deps.listNews(userId, { symbol: item.symbol, limit: 20 });
  const closes = history.map(row => row.c).filter(value => Number.isFinite(value) && value > 0);
  const dividend = dividendHistory
    ? summarizeDividends(dividendHistory.dividends, dividendHistory.splits, deps.now())
    : null;

  const refreshed = await deps.getWatchItem(userId, item.id) as WatchItemRow | undefined;
  if (!refreshed) throw new Error("ウォッチ銘柄の更新結果を確認できませんでした");

  const evidence: WatchProposalEvidence = {
    generatedAt: deps.now().toISOString(),
    price: refreshed.currentPrice === null ? null : Number(refreshed.currentPrice),
    priceUpdatedAt: refreshed.priceUpdatedAt?.toISOString() ?? null,
    rangeLow6m: closes.length > 0 ? Math.min(...closes) : null,
    rangeHigh6m: closes.length > 0 ? Math.max(...closes) : null,
    annualDividend: dividend?.annualDividend ?? null,
    dividendCurrency: dividendHistory?.currency ?? null,
    sector: refreshed.sector,
    industry: refreshed.industry,
    newsCount: news.length,
    latestNewsAt: news[0]?.publishedAt?.toISOString() ?? news[0]?.createdAt?.toISOString() ?? null,
    fetchedNews: newsSync.fetched,
    analyzedNews: newsSync.analyzed,
  };

  try {
    const proposal = await deps.generateProposal(userId, refreshed.symbol, {
      watchItemId: refreshed.id,
      reviewStatus: "PENDING",
      evidence,
      priceAtProposal: evidence.price,
      targetOverride: {
        symbol: refreshed.symbol,
        name: refreshed.name,
        currency: refreshed.currency,
        currentPrice: evidence.price,
        held: false,
        bandLabel: null,
        nextGapPct: null,
        nextActionLabel: null,
        watchTargetPrice: refreshed.targetPrice === null ? null : Number(refreshed.targetPrice),
        concernCount: 0,
      },
      holdingValueJpy: 0,
    });
    return {
      ...proposal,
      watchItemId: refreshed.id,
      evidence,
      createdAt: deps.now(),
    };
  } catch (error) {
    throw toFriendlyAiError(error, "AI の買付提案を作成できませんでした");
  }
}

export type ReviewWatchProposalInput = {
  proposalId: number;
  decision: "ACCEPT" | "EDIT" | "REJECT";
  targetPrice?: number | null;
  plannedAmount?: number | null;
  watchReason?: string;
  buyConditions?: string;
};

export type ReviewableProposal = {
  limitPrice: string | null;
  amountBase: string | null;
  rationale: string;
  buyConditions: string | null;
  invalidation: string | null;
  stance: "BUY" | "WAIT" | "SKIP";
};

export function buildConfirmedWatchPlan(
  proposal: ReviewableProposal,
  input: ReviewWatchProposalInput
) {
  const edited = input.decision === "EDIT";
  const targetPrice = edited
    ? input.targetPrice ?? null
    : proposal.limitPrice === null
      ? null
      : Number(proposal.limitPrice);
  const plannedAmount = edited
    ? input.plannedAmount ?? null
    : proposal.amountBase === null
      ? null
      : Number(proposal.amountBase);
  const watchReason = edited ? input.watchReason?.trim() ?? "" : proposal.rationale;
  const proposedConditions = [
    proposal.buyConditions,
    proposal.invalidation ? `判断を見直す条件: ${proposal.invalidation}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const buyConditions = edited ? input.buyConditions?.trim() ?? "" : proposedConditions;
  return {
    targetPrice,
    plannedAmount,
    watchReason,
    buyConditions,
    priority: proposal.stance === "BUY" ? "HIGH" as const : proposal.stance === "SKIP" ? "LOW" as const : "MEDIUM" as const,
    status: edited ? "EDITED" as const : "ACCEPTED" as const,
  };
}

/** ユーザー確認後だけ watchlist の計画欄を更新する */
export async function reviewWatchProposal(userId: number, input: ReviewWatchProposalInput) {
  const d = await requireDb();
  const [proposal] = await d
    .select()
    .from(addProposals)
    .where(and(eq(addProposals.userId, userId), eq(addProposals.id, input.proposalId)))
    .limit(1);
  if (!proposal || proposal.watchItemId === null) throw new Error("AI 提案が見つかりませんでした");
  if (proposal.reviewStatus !== "PENDING") throw new Error("この AI 提案は既に確認済みです");

  const item = await db.getWatchItem(userId, proposal.watchItemId);
  if (!item || item.symbol !== proposal.symbol) throw new Error("提案対象の銘柄を確認できませんでした");

  if (input.decision === "REJECT") {
    await d
      .update(addProposals)
      .set({ reviewStatus: "REJECTED", confirmedAt: new Date() })
      .where(and(eq(addProposals.userId, userId), eq(addProposals.id, proposal.id)));
    return { success: true, status: "REJECTED" as const, watchItemId: item.id };
  }

  const confirmed = buildConfirmedWatchPlan(proposal, input);

  await db.updateWatchItem(userId, item.id, {
    targetPrice: confirmed.targetPrice === null ? null : String(confirmed.targetPrice),
    plannedAmount: confirmed.plannedAmount === null ? null : String(confirmed.plannedAmount),
    watchReason: confirmed.watchReason || undefined,
    buyConditions: confirmed.buyConditions || undefined,
    priority: confirmed.priority,
  });
  await d
    .update(addProposals)
    .set({
      reviewStatus: confirmed.status,
      confirmedAt: new Date(),
    })
    .where(and(eq(addProposals.userId, userId), eq(addProposals.id, proposal.id)));

  return {
    success: true,
    status: confirmed.status,
    watchItemId: item.id,
  };
}
