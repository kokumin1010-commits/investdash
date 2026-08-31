import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import {
  actionSkipPriceObservations,
  newsItems,
  skippedActionReviewMilestones,
  skippedActionReviews,
} from "../../drizzle/schema";
import { isEarningsNews } from "../../shared/eventDetect";
import { jstDayKey } from "../../shared/jstDate";
import {
  SKIP_OUTCOME_VERSION,
  calculateCounterfactualEffectBase,
  evaluateSkipOutcome,
  type SignalAction,
  type SkipDirection,
} from "../../shared/skipDecisionReview";
import { notifyOwner } from "../_core/notification";
import { getDb } from "../db";
import * as dbq from "../db";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できませんでした");
  return db;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type ObservationSource = "HOLDING" | "WATCHLIST";

export async function recordOpenSkipReviewPrices(
  userId: number,
  now = new Date()
): Promise<{ open: number; observed: number; missing: string[] }> {
  const db = await requireDb();
  const [reviews, holdings, watchItems] = await Promise.all([
    db
      .select()
      .from(skippedActionReviews)
      .where(
        and(
          eq(skippedActionReviews.userId, userId),
          eq(skippedActionReviews.status, "OPEN")
        )
      ),
    dbq.listHoldings(userId),
    dbq.listWatchlist(userId),
  ]);

  const prices = new Map<
    string,
    { price: number; currency: string; priceUpdatedAt: Date | null; source: ObservationSource }
  >();
  for (const holding of holdings) {
    const price = num(holding.currentPrice);
    if (prices.has(holding.symbol) || price === null || price <= 0) continue;
    prices.set(holding.symbol, {
      price,
      currency: holding.currency,
      priceUpdatedAt: holding.priceUpdatedAt,
      source: "HOLDING",
    });
  }
  for (const watch of watchItems) {
    const price = num(watch.currentPrice);
    if (prices.has(watch.symbol) || price === null || price <= 0) continue;
    prices.set(watch.symbol, {
      price,
      currency: watch.currency,
      priceUpdatedAt: watch.priceUpdatedAt,
      source: "WATCHLIST",
    });
  }

  let observed = 0;
  const missing: string[] = [];
  for (const review of reviews) {
    const value = prices.get(review.symbol);
    if (!value || value.currency !== review.currency) {
      missing.push(review.symbol);
      continue;
    }
    await db
      .insert(actionSkipPriceObservations)
      .values({
        userId,
        reviewId: review.id,
        symbol: review.symbol,
        currency: review.currency,
        observedDateJst: jstDayKey(now),
        currentPrice: value.price.toFixed(4),
        priceUpdatedAt: value.priceUpdatedAt,
        source: value.source,
        observedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          currentPrice: value.price.toFixed(4),
          priceUpdatedAt: value.priceUpdatedAt,
          source: value.source,
          observedAt: now,
        },
      });
    observed += 1;
  }

  return { open: reviews.length, observed, missing };
}

export async function ensureAfterEarningsMilestones(
  userId: number,
  now = new Date()
): Promise<{ created: number; matchedNewsIds: number[] }> {
  const db = await requireDb();
  const reviews = await db
    .select()
    .from(skippedActionReviews)
    .where(
      and(
        eq(skippedActionReviews.userId, userId),
        eq(skippedActionReviews.status, "OPEN")
      )
    )
    .orderBy(asc(skippedActionReviews.skippedAt));
  if (reviews.length === 0) return { created: 0, matchedNewsIds: [] };

  const [existing, news] = await Promise.all([
    db
      .select({ reviewId: skippedActionReviewMilestones.reviewId })
      .from(skippedActionReviewMilestones)
      .where(
        and(
          eq(skippedActionReviewMilestones.userId, userId),
          eq(skippedActionReviewMilestones.milestoneType, "AFTER_EARNINGS")
        )
      ),
    db
      .select()
      .from(newsItems)
      .where(
        and(
          eq(newsItems.userId, userId),
          gte(newsItems.publishedAt, reviews[0].skippedAt)
        )
      )
      .orderBy(asc(newsItems.publishedAt), asc(newsItems.id)),
  ]);
  const existingIds = new Set(existing.map(item => item.reviewId));

  let created = 0;
  const matchedNewsIds: number[] = [];
  for (const review of reviews) {
    if (existingIds.has(review.id)) continue;
    const match = news.find(
      item =>
        item.symbol === review.symbol &&
        item.publishedAt !== null &&
        item.publishedAt > review.skippedAt &&
        item.publishedAt <= now &&
        isEarningsNews(item.title, item.summary)
    );
    if (!match?.publishedAt) continue;

    await db
      .insert(skippedActionReviewMilestones)
      .values({
        userId,
        reviewId: review.id,
        milestoneType: "AFTER_EARNINGS",
        eventKey: `earnings-news-${match.id}`,
        dueAt: match.publishedAt,
        status: "PENDING",
        triggerNewsId: match.id,
        outcomeVersion: SKIP_OUTCOME_VERSION,
      })
      .onDuplicateKeyUpdate({ set: { reviewId: review.id } });
    created += 1;
    matchedNewsIds.push(match.id);
  }

  return { created, matchedNewsIds };
}

async function closeFinishedReviews(userId: number, now: Date): Promise<number> {
  const db = await requireDb();
  const [reviews, milestones] = await Promise.all([
    db
      .select({ id: skippedActionReviews.id })
      .from(skippedActionReviews)
      .where(
        and(
          eq(skippedActionReviews.userId, userId),
          eq(skippedActionReviews.status, "OPEN")
        )
      ),
    db
      .select({
        reviewId: skippedActionReviewMilestones.reviewId,
        milestoneType: skippedActionReviewMilestones.milestoneType,
        status: skippedActionReviewMilestones.status,
      })
      .from(skippedActionReviewMilestones)
      .where(eq(skippedActionReviewMilestones.userId, userId)),
  ]);

  let closed = 0;
  for (const review of reviews) {
    const items = milestones.filter(item => item.reviewId === review.id);
    const day180Done = items.some(
      item => item.milestoneType === "DAY_180" && item.status === "COMPLETED"
    );
    const earningsDone = items.some(
      item => item.milestoneType === "AFTER_EARNINGS" && item.status === "COMPLETED"
    );
    if (!day180Done || !earningsDone) continue;
    await db
      .update(skippedActionReviews)
      .set({ status: "CLOSED", closedAt: now, updatedAt: now })
      .where(
        and(
          eq(skippedActionReviews.userId, userId),
          eq(skippedActionReviews.id, review.id)
        )
      );
    closed += 1;
  }
  return closed;
}

export async function evaluateDueSkipMilestones(
  userId: number,
  now = new Date()
): Promise<{
  completed: number;
  closed: number;
  items: Array<{
    milestoneId: number;
    reviewId: number;
    symbol: string;
    milestoneType: string;
    outcomeQuality: string;
  }>;
}> {
  const db = await requireDb();
  const due = await db
    .select()
    .from(skippedActionReviewMilestones)
    .where(
      and(
        eq(skippedActionReviewMilestones.userId, userId),
        eq(skippedActionReviewMilestones.status, "PENDING"),
        lte(skippedActionReviewMilestones.dueAt, now)
      )
    )
    .orderBy(asc(skippedActionReviewMilestones.dueAt));
  if (due.length === 0) {
    return { completed: 0, closed: await closeFinishedReviews(userId, now), items: [] };
  }

  const reviewIds = Array.from(new Set(due.map(item => item.reviewId)));
  const [reviews, observations, signals] = await Promise.all([
    db
      .select()
      .from(skippedActionReviews)
      .where(
        and(
          eq(skippedActionReviews.userId, userId),
          inArray(skippedActionReviews.id, reviewIds)
        )
      ),
    db
      .select()
      .from(actionSkipPriceObservations)
      .where(
        and(
          eq(actionSkipPriceObservations.userId, userId),
          inArray(actionSkipPriceObservations.reviewId, reviewIds)
        )
      )
      .orderBy(asc(actionSkipPriceObservations.observedAt)),
    dbq.latestSignals(userId),
  ]);
  const reviewsById = new Map(reviews.map(item => [item.id, item]));
  const observationsByReview = new Map<number, typeof observations>();
  for (const observation of observations) {
    const values = observationsByReview.get(observation.reviewId) ?? [];
    values.push(observation);
    observationsByReview.set(observation.reviewId, values);
  }

  const items: Array<{
    milestoneId: number;
    reviewId: number;
    symbol: string;
    milestoneType: string;
    outcomeQuality: string;
  }> = [];
  for (const milestone of due) {
    const review = reviewsById.get(milestone.reviewId);
    if (!review) continue;
    const reviewObservations = observationsByReview.get(review.id) ?? [];
    const currentObservation = reviewObservations.at(-1) ?? null;
    const signalAction = (signals.get(review.symbol)?.action ?? null) as SignalAction | null;
    const evaluation = evaluateSkipOutcome({
      direction: review.direction as SkipDirection | null,
      milestoneType: milestone.milestoneType,
      baselinePrice: num(review.baselinePrice),
      currentPrice: num(currentObservation?.currentPrice),
      observedPrices: reviewObservations.flatMap(item => {
        const value = num(item.currentPrice);
        return value === null ? [] : [value];
      }),
      signalAction,
    });

    await db
      .update(skippedActionReviewMilestones)
      .set({
        status: "COMPLETED",
        currentPrice:
          evaluation.currentPrice === null ? null : evaluation.currentPrice.toFixed(4),
        returnPct: evaluation.returnPct === null ? null : evaluation.returnPct.toFixed(4),
        highestPrice:
          evaluation.highestPrice === null ? null : evaluation.highestPrice.toFixed(4),
        lowestPrice:
          evaluation.lowestPrice === null ? null : evaluation.lowestPrice.toFixed(4),
        maxUpsidePct:
          evaluation.maxUpsidePct === null ? null : evaluation.maxUpsidePct.toFixed(4),
        maxDrawdownPct:
          evaluation.maxDrawdownPct === null ? null : evaluation.maxDrawdownPct.toFixed(4),
        observedTradingDays: evaluation.observedTradingDays,
        signalAction,
        outcomeVersion: evaluation.version,
        outcomeQuality: evaluation.quality,
        summary: evaluation.summary,
        evaluatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(skippedActionReviewMilestones.userId, userId),
          eq(skippedActionReviewMilestones.id, milestone.id),
          eq(skippedActionReviewMilestones.status, "PENDING")
        )
      );
    items.push({
      milestoneId: milestone.id,
      reviewId: review.id,
      symbol: review.symbol,
      milestoneType: milestone.milestoneType,
      outcomeQuality: evaluation.quality,
    });
  }

  return {
    completed: items.length,
    closed: await closeFinishedReviews(userId, now),
    items,
  };
}

const MILESTONE_LABELS = {
  DAY_30: "30日確認",
  DAY_90: "90日確認",
  DAY_180: "180日確認",
  AFTER_EARNINGS: "次の決算後確認",
} as const;

const OUTCOME_LABELS = {
  OUTCOME_FAVORABLE: "結果は有利",
  OUTCOME_UNFAVORABLE: "結果は不利",
  OUTCOME_NOT_YET_CLEAR: "結果はまだ不明確",
} as const;

export async function notifyUnsentSkipReviewMilestones(
  userId: number,
  now = new Date(),
  send: typeof notifyOwner = notifyOwner
): Promise<{ sent: boolean; count: number; milestoneIds: number[] }> {
  const db = await requireDb();
  const milestones = await db
    .select()
    .from(skippedActionReviewMilestones)
    .where(
      and(
        eq(skippedActionReviewMilestones.userId, userId),
        eq(skippedActionReviewMilestones.status, "COMPLETED"),
        isNull(skippedActionReviewMilestones.notifiedAt)
      )
    )
    .orderBy(asc(skippedActionReviewMilestones.evaluatedAt));
  if (milestones.length === 0) return { sent: false, count: 0, milestoneIds: [] };

  const reviewIds = Array.from(new Set(milestones.map(item => item.reviewId)));
  const reviews = await db
    .select({
      id: skippedActionReviews.id,
      symbol: skippedActionReviews.symbol,
      name: skippedActionReviews.name,
    })
    .from(skippedActionReviews)
    .where(
      and(
        eq(skippedActionReviews.userId, userId),
        inArray(skippedActionReviews.id, reviewIds)
      )
    );
  const reviewMap = new Map(reviews.map(item => [item.id, item]));
  const lines = milestones.slice(0, 12).map(item => {
    const review = reviewMap.get(item.reviewId);
    const outcome = item.outcomeQuality
      ? OUTCOME_LABELS[item.outcomeQuality]
      : "結果資料なし";
    return `・${review?.name ?? review?.symbol ?? "銘柄"} (${review?.symbol ?? "—"})｜${MILESTONE_LABELS[item.milestoneType]}｜${outcome}`;
  });
  if (milestones.length > 12) lines.push(`・ほか ${milestones.length - 12} 件`);
  const sent = await send({
    title: `【InvestDash】見送り検証 ${milestones.length}件`,
    content: [
      "見送った判断の確認時期です。結果の有利・不利と、当時の判断過程は別々に表示します。",
      "",
      ...lines,
      "",
      "アクション待ちの「見送り検証」から確認してください。売買は自動実行されません。",
    ].join("\n"),
  });
  if (!sent) throw new Error("見送り検証の通知を送信できませんでした");

  const milestoneIds = milestones.map(item => item.id);
  await db
    .update(skippedActionReviewMilestones)
    .set({ notifiedAt: now, updatedAt: now })
    .where(
      and(
        eq(skippedActionReviewMilestones.userId, userId),
        inArray(skippedActionReviewMilestones.id, milestoneIds),
        isNull(skippedActionReviewMilestones.notifiedAt)
      )
    );
  return { sent: true, count: milestones.length, milestoneIds };
}

export async function runSkipDecisionReviewDaily(userId: number, now = new Date()) {
  const observation = await recordOpenSkipReviewPrices(userId, now);
  const earnings = await ensureAfterEarningsMilestones(userId, now);
  const evaluation = await evaluateDueSkipMilestones(userId, now);
  const notification = await notifyUnsentSkipReviewMilestones(userId, now);
  return { observation, earnings, evaluation, notification };
}

export async function listSkippedActionReviews(userId: number, limit = 100) {
  const db = await requireDb();
  const reviews = await db
    .select()
    .from(skippedActionReviews)
    .where(eq(skippedActionReviews.userId, userId))
    .orderBy(desc(skippedActionReviews.skippedAt), desc(skippedActionReviews.id))
    .limit(Math.min(200, Math.max(1, limit)));
  if (reviews.length === 0) return [];

  const reviewIds = reviews.map(item => item.id);
  const [milestones, observations] = await Promise.all([
    db
      .select()
      .from(skippedActionReviewMilestones)
      .where(
        and(
          eq(skippedActionReviewMilestones.userId, userId),
          inArray(skippedActionReviewMilestones.reviewId, reviewIds)
        )
      )
      .orderBy(asc(skippedActionReviewMilestones.dueAt)),
    db
      .select()
      .from(actionSkipPriceObservations)
      .where(
        and(
          eq(actionSkipPriceObservations.userId, userId),
          inArray(actionSkipPriceObservations.reviewId, reviewIds)
        )
      )
      .orderBy(desc(actionSkipPriceObservations.observedAt)),
  ]);

  return reviews.map(review => {
    const reviewMilestones = milestones
      .filter(item => item.reviewId === review.id)
      .map(item => ({
        ...item,
        currentPrice: num(item.currentPrice),
        returnPct: num(item.returnPct),
        highestPrice: num(item.highestPrice),
        lowestPrice: num(item.lowestPrice),
        maxUpsidePct: num(item.maxUpsidePct),
        maxDrawdownPct: num(item.maxDrawdownPct),
        counterfactualEffectBase: calculateCounterfactualEffectBase({
          direction: review.direction as SkipDirection | null,
          recommendedAmountBase: num(review.recommendedAmountBase),
          returnPct: num(item.returnPct),
        }),
      }));
    const reviewObservations = observations.filter(item => item.reviewId === review.id);
    const latestObservation = reviewObservations[0] ?? null;
    return {
      ...review,
      baselinePrice: num(review.baselinePrice),
      baselineQuantity: num(review.baselineQuantity),
      baselineWeightPct: num(review.baselineWeightPct),
      recommendedShares: num(review.recommendedShares),
      recommendedAmountBase: num(review.recommendedAmountBase),
      latestPrice: num(latestObservation?.currentPrice),
      latestObservedAt: latestObservation?.observedAt ?? null,
      observationCount: reviewObservations.length,
      milestones: reviewMilestones,
    };
  });
}
