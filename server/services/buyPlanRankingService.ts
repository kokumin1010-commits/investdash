import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { buyPlanRankingSnapshots } from "../../drizzle/schema";
import {
  BUY_PLAN_SCORE_VERSION,
  buyPlanMaterialKey,
  rankBuyPlans,
  rankingMonthJst,
  type BuyPlanRankingInput,
} from "../../shared/buyPlanRanking";
import { normalizeSymbol } from "../../shared/investing";
import { computePortfolioPositionSizing } from "../../shared/portfolioPositionSizing";
import { getDb } from "../db";
import * as dbq from "../db";
import { convertToJpy } from "./fx";
import { buildPortfolio } from "./portfolio";
import { listPlanOverview, type PlanOverviewRow } from "./priceBandService";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できませんでした");
  return db;
}

function stableFingerprint(inputs: BuyPlanRankingInput[]): string {
  const material = [...inputs]
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .map(buyPlanMaterialKey);
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

export type BuyPlanRankingView = {
  eligible: boolean;
  rank: number | null;
  score: number;
  scoreVersion: string;
  breakdown: Record<string, number>;
  gateReasons: string[];
  rationale: string[];
};

export type RankedPlanOverviewRow = PlanOverviewRow & {
  sizing: ReturnType<typeof computePortfolioPositionSizing>;
  signalAction: BuyPlanRankingInput["signalAction"];
  signalConfidence: number | null;
  signalDataQuality: BuyPlanRankingInput["signalDataQuality"];
  cardConviction: number | null;
  ranking: BuyPlanRankingView;
};

export async function buildRankedPlanOverview(userId: number, now = new Date()) {
  const db = await requireDb();
  const [rows, portfolio, settings, watchItems, cards, signals] = await Promise.all([
    listPlanOverview(userId),
    buildPortfolio(userId),
    dbq.getSettings(userId),
    dbq.listWatchlist(userId),
    dbq.listCards(userId),
    dbq.latestSignals(userId),
  ]);
  const watchMap = new Map(watchItems.map(item => [item.symbol, item]));
  const cardMap = new Map(cards.map(item => [item.symbol, item]));
  const groupMap = new Map(portfolio.groups.map(item => [item.symbol, item]));
  const ibkr = portfolio.brokers.find(item => item.key === "ibkr")?.leverage ?? null;
  const liquidAssetsBase =
    portfolio.summary.cashBalance + portfolio.summary.interestAssetsBase;
  const rates = {
    usdJpy: portfolio.summary.usdJpyRate,
    sgdJpy: portfolio.summary.sgdJpyRate,
    hkdJpy: portfolio.summary.hkdJpyRate,
  };

  const inputs = rows.map(row => {
    const group = groupMap.get(row.symbol);
    const watch = watchMap.get(row.symbol);
    const card = cardMap.get(row.symbol);
    const signal = signals.get(row.symbol);
    const sector = group?.sector ?? watch?.sector ?? null;
    const sectorValueBase =
      portfolio.sectors.find(item => item.key === sector)?.value ?? 0;
    const sizing = computePortfolioPositionSizing({
      action: row.action ?? "HOLD",
      priority: watch?.priority ?? "MEDIUM",
      market: normalizeSymbol(row.symbol).market,
      localPrice: row.currentPrice,
      yenPerLocalUnit: convertToJpy(1, row.currency, rates),
      netAssetsBase: portfolio.summary.netAssetsBase,
      liquidAssetsBase,
      currentHoldingBase: row.holdingValueJpy ?? 0,
      sectorValueBase,
      userSectorLimitPct: settings.sectorConcentrationThreshold,
      ibkrLeverage: ibkr?.leverage ?? null,
      ibkrRiskLevel: ibkr?.riskLevel ?? null,
      ibkrDropToMarginCallPct: ibkr?.dropToMarginCallPct ?? null,
    });
    return {
      symbol: row.symbol,
      action: row.action,
      currentPrice: row.currentPrice,
      lowerPrice: row.currentBandLowerPrice,
      upperPrice: row.currentBandUpperPrice,
      needsCheck: row.needsCheck,
      pendingCheckCount: row.pendingCheckCount,
      concernCount: row.concernCount,
      signalAction: signal?.action ?? null,
      signalConfidence: signal?.confidence ?? null,
      signalDataQuality: signal?.dataQuality ?? null,
      hasCard: Boolean(card),
      cardConviction: card?.conviction ?? null,
      cardUpdatedAt: card?.updatedAt ?? null,
      planGeneratedAt: row.generatedAt,
      sizing,
    } satisfies BuyPlanRankingInput;
  });
  const liveRanked = rankBuyPlans(inputs);
  const rankingMonth = rankingMonthJst(now);
  const rankingFingerprint = stableFingerprint(inputs);
  const existing = await db
    .select()
    .from(buyPlanRankingSnapshots)
    .where(
      and(
        eq(buyPlanRankingSnapshots.userId, userId),
        eq(buyPlanRankingSnapshots.rankingMonth, rankingMonth)
      )
    );
  const snapshotCurrent =
    existing.length === rows.length &&
    existing.length > 0 &&
    existing.every(item => item.rankingFingerprint === rankingFingerprint);

  if (!snapshotCurrent) {
    await db.transaction(async tx => {
      for (const item of liveRanked) {
        await tx
          .insert(buyPlanRankingSnapshots)
          .values({
            userId,
            rankingMonth,
            symbol: item.symbol,
            rank: item.rank,
            eligible: item.eligible,
            score: item.score,
            scoreVersion: item.scoreVersion,
            scoreBreakdown: item.breakdown,
            gateReasons: item.gateReasons,
            rationale: item.rationale,
            rankingFingerprint,
          })
          .onDuplicateKeyUpdate({
            set: {
              rank: item.rank,
              eligible: item.eligible,
              score: item.score,
              scoreVersion: item.scoreVersion,
              scoreBreakdown: item.breakdown,
              gateReasons: item.gateReasons,
              rationale: item.rationale,
              rankingFingerprint,
              updatedAt: now,
            },
          });
      }
    });
  }

  const activeSnapshots = snapshotCurrent
    ? existing
    : await db
        .select()
        .from(buyPlanRankingSnapshots)
        .where(
          and(
            eq(buyPlanRankingSnapshots.userId, userId),
            eq(buyPlanRankingSnapshots.rankingMonth, rankingMonth)
          )
        );
  const snapshotMap = new Map(activeSnapshots.map(item => [item.symbol, item]));
  const inputMap = new Map(inputs.map(item => [item.symbol, item]));
  const enrichedRows: RankedPlanOverviewRow[] = rows.map(row => {
    const input = inputMap.get(row.symbol);
    const snapshot = snapshotMap.get(row.symbol);
    if (!input || !snapshot) {
      throw new Error(`${row.symbol} の買い増し順位を組み立てられませんでした`);
    }
    return {
      ...row,
      sizing: input.sizing,
      signalAction: input.signalAction,
      signalConfidence: input.signalConfidence,
      signalDataQuality: input.signalDataQuality,
      cardConviction: input.cardConviction,
      ranking: {
        eligible: snapshot.eligible,
        rank: snapshot.rank,
        score: snapshot.score,
        scoreVersion: snapshot.scoreVersion,
        breakdown: snapshot.scoreBreakdown,
        gateReasons: snapshot.gateReasons,
        rationale: snapshot.rationale,
      },
    };
  });
  const monthlyCandidates = enrichedRows
    .filter(item => item.ranking.eligible && item.ranking.rank !== null)
    .sort((a, b) => (a.ranking.rank ?? 999) - (b.ranking.rank ?? 999))
    .slice(0, 5);

  return {
    rows: enrichedRows,
    ranking: {
      rankingMonth,
      scoreVersion: BUY_PLAN_SCORE_VERSION,
      rankingFingerprint,
      snapshotRecomputed: !snapshotCurrent,
      eligibleCount: enrichedRows.filter(item => item.ranking.eligible).length,
      monthlyCandidates,
      frozenAt:
        activeSnapshots.length > 0
          ? activeSnapshots.reduce(
              (earliest, item) =>
                item.createdAt < earliest ? item.createdAt : earliest,
              activeSnapshots[0].createdAt
            )
          : now,
    },
  };
}
