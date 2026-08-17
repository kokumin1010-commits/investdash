import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import * as db from "../db";
import {
  priceBandPlans,
  priceBands,
  bandCheckResults,
  type PriceBandPlan,
} from "../../drizzle/schema";
import {
  evaluateBands,
  type BandEvaluation,
  type BandAction,
  type BandInput,
} from "../../shared/priceBands";
import {
  generatePriceBandPlan,
  PRICE_BAND_MODEL,
  type PlannerContext,
  type PlanResult,
} from "./priceBandPlanner";
import { withAiRunLog } from "./aiRunLog";
import { buildPortfolio } from "./portfolio";
import { fetchPriceHistory } from "./marketData";
import { runBandChecks, BAND_CHECKER_MODEL } from "./bandChecker";

/**
 * 買い増しプランの保存・取得・生成をまとめる。
 *
 * プランは銘柄（symbol）単位で 1 つだけ持つ。同じ銘柄を複数口座で持っていても
 * 「いくらになったら買うか」は口座によらず同じ判断になるため。
 */

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できません");
  return d;
}

export type BandWithCheck = BandInput & {
  /** この帯の確認項目に対する最新の照合結果 */
  checks: Array<{
    checkItem: string;
    status: "CLEAR" | "CONCERN" | "UNKNOWN";
    finding: string;
    sourceCount: number;
    checkedAt: Date;
  }>;
};

export type PriceBandPlanView = {
  id: number;
  symbol: string;
  currency: string;
  scope: "HOLDING" | "WATCHLIST";
  strategy: string | null;
  rationale: string | null;
  model: string | null;
  editedByUser: boolean;
  generatedAt: Date;
  bands: BandWithCheck[];
  /** 現在値。プラン単体では持たないので呼び出し側で埋める */
  currentPrice: number | null;
  /** 現在値の評価結果 */
  evaluation: BandEvaluation;
};

/** プランと段をまとめて取得する */
export async function getPlan(
  userId: number,
  symbol: string,
  currentPrice: number | null
): Promise<PriceBandPlanView | null> {
  const d = await requireDb();
  const [plan] = await d
    .select()
    .from(priceBandPlans)
    .where(and(eq(priceBandPlans.userId, userId), eq(priceBandPlans.symbol, symbol)))
    .orderBy(desc(priceBandPlans.generatedAt))
    .limit(1);
  if (!plan) return null;

  const rows = await d
    .select()
    .from(priceBands)
    .where(eq(priceBands.planId, plan.id))
    .orderBy(asc(priceBands.sortOrder));

  const bandIds = rows.map(r => r.id);
  /*
   * 確認結果は帯ごとに複数（確認項目ごと）入る。
   * 同じ項目を何度も照合した場合は最新のものだけを見せる。
   */
  const checkRows =
    bandIds.length > 0
      ? await d
          .select()
          .from(bandCheckResults)
          .where(eq(bandCheckResults.userId, userId))
          .orderBy(desc(bandCheckResults.createdAt))
      : [];

  const bands: BandWithCheck[] = rows.map(r => {
    const seen = new Set<string>();
    const checks = checkRows
      .filter(c => c.bandId === r.id)
      .filter(c => {
        if (seen.has(c.checkItem)) return false;
        seen.add(c.checkItem);
        return true;
      })
      .map(c => ({
        checkItem: c.checkItem,
        status: c.status,
        finding: c.finding,
        sourceCount: c.sourceCount,
        checkedAt: c.createdAt,
      }));

    return {
      id: r.id,
      lowerPrice: r.lowerPrice === null ? null : Number(r.lowerPrice),
      upperPrice: r.upperPrice === null ? null : Number(r.upperPrice),
      action: r.action,
      actionLabel: r.actionLabel,
      reason: r.reason,
      checkItems: (r.checkItems as string[] | null) ?? null,
      plannedAmount: r.plannedAmount === null ? null : Number(r.plannedAmount),
      sortOrder: r.sortOrder,
      checks,
    };
  });

  return {
    id: plan.id,
    symbol: plan.symbol,
    currency: plan.currency,
    scope: plan.scope,
    strategy: plan.strategy,
    rationale: plan.rationale,
    model: plan.model,
    editedByUser: plan.editedByUser,
    generatedAt: plan.generatedAt,
    bands,
    currentPrice,
    evaluation: evaluateBands(currentPrice, bands),
  };
}

/** プランを保存する（既存があれば置き換える） */
export async function savePlan(params: {
  userId: number;
  symbol: string;
  currency: string;
  scope: "HOLDING" | "WATCHLIST";
  result: PlanResult;
  model: string | null;
  editedByUser: boolean;
}): Promise<number> {
  const d = await requireDb();

  /*
   * 作り直しのときは古い段を消す。段だけ残ると価格帯が二重に見えてしまう。
   * 確認結果は帯に紐づくので、帯を消すと参照先を失う。過去の照合内容は
   * 「その時点の判断材料」として意味があるが、対応する帯がないと表示できないため
   * まとめて削除する。
   */
  const [existing] = await d
    .select()
    .from(priceBandPlans)
    .where(
      and(eq(priceBandPlans.userId, params.userId), eq(priceBandPlans.symbol, params.symbol))
    )
    .limit(1);

  let planId: number;
  if (existing) {
    const oldBands = await d.select().from(priceBands).where(eq(priceBands.planId, existing.id));
    for (const b of oldBands) {
      await d.delete(bandCheckResults).where(eq(bandCheckResults.bandId, b.id));
    }
    await d.delete(priceBands).where(eq(priceBands.planId, existing.id));
    await d
      .update(priceBandPlans)
      .set({
        currency: params.currency,
        scope: params.scope,
        strategy: params.result.strategy,
        rationale: params.result.rationale,
        model: params.model,
        editedByUser: params.editedByUser,
        generatedAt: new Date(),
      })
      .where(eq(priceBandPlans.id, existing.id));
    planId = existing.id;
  } else {
    const inserted = await d.insert(priceBandPlans).values({
      userId: params.userId,
      symbol: params.symbol,
      currency: params.currency,
      scope: params.scope,
      strategy: params.result.strategy,
      rationale: params.result.rationale,
      model: params.model,
      editedByUser: params.editedByUser,
    });
    /*
     * mysql2 ドライバは [ResultSetHeader, fields] の配列を返す。
     * insertId は先頭要素にあるため、両方の形に備えて取り出す。
     * ここで NaN になると段が planId=NaN で保存され、後から取得できなくなる。
     */
    const header = Array.isArray(inserted) ? inserted[0] : inserted;
    planId = Number((header as unknown as { insertId: number })?.insertId);
    if (!Number.isFinite(planId) || planId <= 0) {
      // 取り出せない場合は保存済みの行を読み直して確定させる
      const [row] = await d
        .select()
        .from(priceBandPlans)
        .where(
          and(eq(priceBandPlans.userId, params.userId), eq(priceBandPlans.symbol, params.symbol))
        )
        .orderBy(desc(priceBandPlans.id))
        .limit(1);
      if (!row) throw new Error("プランの保存に失敗しました");
      planId = row.id;
    }
  }

  for (let i = 0; i < params.result.bands.length; i++) {
    const band = params.result.bands[i];
    await d.insert(priceBands).values({
      planId,
      lowerPrice: band.lowerPrice === null ? null : String(band.lowerPrice),
      upperPrice: band.upperPrice === null ? null : String(band.upperPrice),
      action: band.action,
      actionLabel: band.actionLabel,
      reason: band.reason,
      checkItems: band.checkItems,
      plannedAmount: null,
      sortOrder: i,
    });
  }

  return planId;
}

/**
 * 保有銘柄のプランを AI で生成して保存する。
 *
 * シグナル生成と同じ材料（投資カード・ニュース・52週レンジ・騰落率）に
 * 配当を加えて渡す。配当利回りは「この価格なら利回り何 %」という
 * 価格水準の根拠として使えるため。
 */
export async function generateAndSavePlanForHolding(
  userId: number,
  symbol: string
): Promise<PriceBandPlanView> {
  const holdings = await db.listHoldings(userId);
  const rows = holdings.filter(h => h.symbol === symbol);
  if (rows.length === 0) throw new Error(`保有銘柄に ${symbol} が見つかりません`);
  const holding = rows[0];

  const [card, news, portfolio, history] = await Promise.all([
    db.getCard(userId, symbol),
    db.listNews(userId, { symbol, limit: 12 }),
    buildPortfolio(userId),
    fetchPriceHistory(symbol, "6mo", "1d"),
  ]);

  const view = portfolio.groups.find(g => g.symbol === symbol);

  const returnOver = (days: number): number | null => {
    if (history.length < 2) return null;
    const last = history[history.length - 1];
    const cutoff = last.t - days * 24 * 60 * 60 * 1000;
    const base = history.find(b => b.t >= cutoff);
    if (!base || base.c === 0) return null;
    return ((last.c - base.c) / base.c) * 100;
  };

  /*
   * 配当は 1 株あたりの年額。銘柄が複数口座にある場合、
   * holdings 各行に同じ 1 株あたり配当が入っているので先頭行の値を使う。
   */
  const annualDividend = holding.annualDividend ? Number(holding.annualDividend) : null;
  const currentPrice = view?.currentPrice ?? null;
  const dividendYieldPct =
    annualDividend !== null && currentPrice !== null && currentPrice > 0
      ? (annualDividend / currentPrice) * 100
      : null;

  const ctx: PlannerContext = {
    name: holding.name,
    symbol,
    currency: holding.currency,
    sector: holding.sector,
    industry: holding.industry,
    position: {
      quantity: view?.quantity ?? Number(holding.quantity),
      avgCost: view?.avgCost ?? Number(holding.avgCost),
      pnlPct: view?.pnlPct ?? null,
      weightPct: view?.weightPct ?? null,
    },
    currentPrice,
    fiftyTwoWeekHigh: view?.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: view?.fiftyTwoWeekLow ?? null,
    return1m: returnOver(30),
    return3m: returnOver(90),
    annualDividend,
    dividendYieldPct,
    card: card
      ? {
          buyReason: card.buyReason,
          coreThesis: card.coreThesis,
          valuationAssumption: card.valuationAssumption,
          fairValue: card.fairValue ? Number(card.fairValue) : null,
          exitConditions: card.exitConditions,
          risks: card.risks,
        }
      : null,
    news: news.map(n => ({
      title: n.title,
      sentiment: n.sentiment,
      impactScore: n.impactScore,
      summary: n.summary,
    })),
  };

  const result = await withAiRunLog(
    {
      userId,
      kind: "price_band_plan",
      symbol,
      model: PRICE_BAND_MODEL,
      summarize: r =>
        `${r.bands.length} 段を生成: ${r.bands
          .map(b => `${b.action}(${b.lowerPrice ?? "―"}〜${b.upperPrice ?? "―"})`)
          .join(" / ")}`,
    },
    () => generatePriceBandPlan(ctx)
  );

  await savePlan({
    userId,
    symbol,
    currency: holding.currency,
    scope: "HOLDING",
    result,
    model: PRICE_BAND_MODEL,
    editedByUser: false,
  });

  const saved = await getPlan(userId, symbol, currentPrice);
  if (!saved) throw new Error("プランの保存に失敗しました");
  return saved;
}

/** 保有銘柄すべてのプラン有無を返す（一覧表示・一括生成の進捗確認に使う） */
export async function runChecksForBand(
  userId: number,
  bandId: number
): Promise<PriceBandPlanView> {
  const d = await requireDb();

  const [band] = await d.select().from(priceBands).where(eq(priceBands.id, bandId)).limit(1);
  if (!band) throw new Error("価格帯が見つかりません");

  const [plan] = await d
    .select()
    .from(priceBandPlans)
    .where(and(eq(priceBandPlans.id, band.planId), eq(priceBandPlans.userId, userId)))
    .limit(1);
  if (!plan) throw new Error("この価格帯を参照する権限がありません");

  const items = (band.checkItems as string[] | null) ?? [];
  if (items.length === 0) throw new Error("この価格帯には確認項目が設定されていません");

  const holdings = await db.listHoldings(userId);
  const holding = holdings.find(h => h.symbol === plan.symbol);
  if (!holding) throw new Error(`保有銘柄に ${plan.symbol} が見つかりません`);

  const [news, portfolio] = await Promise.all([
    db.listNews(userId, { symbol: plan.symbol, limit: 20 }),
    buildPortfolio(userId),
  ]);
  const view = portfolio.groups.find(g => g.symbol === plan.symbol);
  const currentPrice = view?.currentPrice ?? null;

  /*
   * 価格帯に入っていない段の確認は実行しない。
   * 常に動かすと AI 利用枠を無駄に消費するうえ、まだ関係のない懸念材料を
   * 目にすることで判断が濁る。確認は必要な場面に絞る。
   */
  const lower = band.lowerPrice === null ? null : Number(band.lowerPrice);
  const upper = band.upperPrice === null ? null : Number(band.upperPrice);
  const inBand =
    currentPrice !== null &&
    (lower === null || currentPrice >= lower) &&
    (upper === null || currentPrice <= upper);
  if (!inBand) {
    throw new Error(
      `現在値${currentPrice !== null ? `（${currentPrice}）` : ""}はこの価格帯の外です。この価格帯に入ってから確認してください。`
    );
  }

  const outcomes = await withAiRunLog(
    {
      userId,
      kind: "band_check",
      symbol: plan.symbol,
      model: BAND_CHECKER_MODEL,
      summarize: rows =>
        `${rows.length} 項目を照合: ` +
        `懸念 ${rows.filter(r => r.status === "CONCERN").length} / ` +
        `問題なし ${rows.filter(r => r.status === "CLEAR").length} / ` +
        `不明 ${rows.filter(r => r.status === "UNKNOWN").length}`,
    },
    () =>
      runBandChecks({
        name: holding.name,
        symbol: plan.symbol,
        actionLabel: band.actionLabel,
        checkItems: items,
        news: news.map(n => ({
          title: n.title,
          summary: n.summary,
          sentiment: n.sentiment,
          impactScore: n.impactScore,
          publishedAt: n.publishedAt,
          source: n.source,
        })),
      })
  );

  /*
   * 同じ項目を再確認した場合は古い結果を消してから入れる。
   * 残しておくと「いつの判断か」が混ざり、古い懸念を今のものと誤読する。
   */
  for (const o of outcomes) {
    await d
      .delete(bandCheckResults)
      .where(and(eq(bandCheckResults.bandId, bandId), eq(bandCheckResults.checkItem, o.checkItem)));
    await d.insert(bandCheckResults).values({
      userId,
      bandId,
      checkItem: o.checkItem,
      status: o.status,
      finding: o.finding,
      sourceCount: o.sourceCount,
    });
  }

  const saved = await getPlan(userId, plan.symbol, currentPrice);
  if (!saved) throw new Error("プランを取得できませんでした");
  return saved;
}

export async function listPlanStatus(
  userId: number
): Promise<Array<{ symbol: string; name: string; hasPlan: boolean; generatedAt: Date | null }>> {
  const d = await requireDb();
  const holdings = await db.listHoldings(userId);
  const plans = await d
    .select()
    .from(priceBandPlans)
    .where(eq(priceBandPlans.userId, userId));
  const planMap = new Map<string, PriceBandPlan>(plans.map(p => [p.symbol, p]));

  const seen = new Set<string>();
  const out: Array<{ symbol: string; name: string; hasPlan: boolean; generatedAt: Date | null }> =
    [];
  for (const h of holdings) {
    if (seen.has(h.symbol)) continue;
    seen.add(h.symbol);
    const plan = planMap.get(h.symbol);
    out.push({
      symbol: h.symbol,
      name: h.name,
      hasPlan: !!plan,
      generatedAt: plan?.generatedAt ?? null,
    });
  }
  return out;
}

/** 買い増しプランの一覧（今どの段にいるかを横断で見るため） */
export type PlanOverviewRow = {
  symbol: string;
  name: string;
  currency: string;
  currentPrice: number | null;
  /** 現在いる段。帯の外なら null */
  action: BandAction | null;
  actionLabel: string | null;
  /** 帯の外にいるか（登録した価格帯より上／下） */
  outsideDirection: "ABOVE" | "BELOW" | null;
  /** 次の段までの変化率（%）。すでに一番下ならnull */
  nextGapPct: number | null;
  nextActionLabel: string | null;
  /** 確認が必要な段にいて、まだ照合していない項目があるか */
  needsCheck: boolean;
  /** 照合済みで懸念ありの件数 */
  concernCount: number;
  generatedAt: Date;
};

/**
 * 全銘柄のプランを 1 回のクエリでまとめて評価する。
 *
 * 銘柄ごとに getPlan を呼ぶと 112 銘柄 × 3 クエリになり実用にならないため、
 * プラン・段・照合結果をそれぞれ 1 回引いてメモリ上で突き合わせる。
 */
export async function listPlanOverview(userId: number): Promise<PlanOverviewRow[]> {
  const d = await requireDb();
  const [holdings, plans] = await Promise.all([
    db.listHoldings(userId),
    d.select().from(priceBandPlans).where(eq(priceBandPlans.userId, userId)),
  ]);
  if (plans.length === 0) return [];

  const planIds = plans.map(p => p.id);
  const [bandRows, checkRows] = await Promise.all([
    d.select().from(priceBands).where(inArray(priceBands.planId, planIds)),
    d.select().from(bandCheckResults).where(eq(bandCheckResults.userId, userId)),
  ]);

  const bandsByPlan = new Map<number, typeof bandRows>();
  for (const r of bandRows) {
    const list = bandsByPlan.get(r.planId) ?? [];
    list.push(r);
    bandsByPlan.set(r.planId, list);
  }

  /*
   * 現在値は保有から取る。同じ銘柄を複数口座で持つ場合はどれも同じ株価なので
   * 最初に見つかったものを使う。名前も保有側の表記に合わせる。
   */
  const priceBySymbol = new Map<string, { price: number | null; name: string }>();
  for (const h of holdings) {
    if (priceBySymbol.has(h.symbol)) continue;
    priceBySymbol.set(h.symbol, {
      price: h.currentPrice === null ? null : Number(h.currentPrice),
      name: h.name,
    });
  }

  const out: PlanOverviewRow[] = [];
  for (const plan of plans) {
    const info = priceBySymbol.get(plan.symbol);
    // 保有から外れた銘柄のプランは一覧に出さない（売却済みなど）
    if (!info) continue;

    const bands: BandInput[] = (bandsByPlan.get(plan.id) ?? []).map(r => ({
      id: r.id,
      lowerPrice: r.lowerPrice === null ? null : Number(r.lowerPrice),
      upperPrice: r.upperPrice === null ? null : Number(r.upperPrice),
      action: r.action,
      actionLabel: r.actionLabel,
      reason: r.reason,
      checkItems: (r.checkItems as string[] | null) ?? null,
      plannedAmount: r.plannedAmount === null ? null : Number(r.plannedAmount),
      sortOrder: r.sortOrder,
    }));

    const ev = evaluateBands(info.price, bands);
    const current = ev.currentBand;

    /*
     * 「確認が必要」は、確認項目がある段にいて、まだ照合していない項目が
     * 残っている場合だけ立てる。帯の外にいる銘柄では立てない。
     */
    let needsCheck = false;
    let concernCount = 0;
    if (current?.checkItems?.length) {
      const done = new Set(
        checkRows.filter(c => c.bandId === current.id).map(c => c.checkItem)
      );
      needsCheck = current.checkItems.some(item => !done.has(item));
      concernCount = checkRows.filter(
        c => c.bandId === current.id && c.status === "CONCERN"
      ).length;
    }

    out.push({
      symbol: plan.symbol,
      name: info.name,
      currency: plan.currency,
      currentPrice: info.price,
      action: current?.action ?? null,
      actionLabel: current?.actionLabel ?? null,
      outsideDirection: ev.abovePlan ? "ABOVE" : ev.belowPlan ? "BELOW" : null,
      nextGapPct: ev.gapToNextPct,
      nextActionLabel: ev.nextBand?.actionLabel ?? null,
      needsCheck,
      concernCount,
      generatedAt: plan.generatedAt,
    });
  }
  return out;
}
