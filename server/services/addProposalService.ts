/**
 * 買い増し提案の生成・保存・取得。
 *
 * 「どの銘柄について出すか」の選別をここで行う。112 銘柄すべてに
 * AI を走らせると 30 分以上かかり、cron の制限も超える。判断が
 * 必要な銘柄だけに絞って出す。
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { addProposals } from "../../drizzle/schema";
import { getDb } from "../db";
import { buildConsultContext } from "./consultContext";
import { listPlanOverview, type PlanOverviewRow } from "./priceBandService";
import { proposeForSymbol, type ProposalTarget } from "./addProposer";
import { withAiRunLog } from "./aiRunLog";

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できませんでした");
  return d;
}

/** 1 回で提案する上限。AI 1 回あたり十数秒かかるため */
export const PROPOSAL_BATCH_LIMIT = 8;

/**
 * 同じ銘柄で提案を作り直さない期間（時間）。
 *
 * 株価は 1 日 2 回更新されるが、1 日で結論が変わることは稀。
 * 毎回作り直すと AI 利用枠を消費し、履歴が同じ内容で埋まる。
 */
export const PROPOSAL_COOLDOWN_HOURS = 72;

export type ProposalCandidate = {
  row: PlanOverviewRow;
  /** なぜ提案の対象にしたか。画面に出して選別の理由が分かるようにする */
  reason: string;
  /** 優先度。高いものから処理する */
  priority: number;
};

/**
 * 提案を出すべき銘柄を選ぶ。
 *
 * 【選ぶ条件】
 * - 買い増しの段に入っている（今まさに行動の判断が必要）
 * - 次の段まで 3% 以内（近いうちに判断が必要になる）
 * - 懸念ありの照合結果がある（前提が崩れている可能性）
 * - 未保有で目標価格に近い（買い逃しを防ぐ）
 *
 * 【選ばない条件】
 * 帯の上に大きく外れている銘柄は対象にしない。高すぎて買えない
 * 銘柄に「待つべき」という提案を出しても判断の助けにならず、
 * AI の呼び出しを消費するだけになる。
 */
export function selectProposalTargets(
  rows: PlanOverviewRow[],
  limit = PROPOSAL_BATCH_LIMIT
): ProposalCandidate[] {
  const out: ProposalCandidate[] = [];

  for (const row of rows) {
    if (row.currentPrice === null) continue;

    /*
     * 買い増しの段に入っている。ADD 系の判定は行動を促すものなので
     * 最優先。REDUCE（減らす）はこの機能の対象外（買い増しの是非を
     * 判断する用途に絞っており、売却は別の判断になる）。
     */
    if (row.action === "ADD_MAIN" || row.action === "ADD_SMALL") {
      out.push({
        row,
        reason: row.action === "ADD_MAIN" ? "主力買い増しの段にいる" : "打診買いの段にいる",
        priority: row.action === "ADD_MAIN" ? 100 : 90,
      });
      continue;
    }

    /*
     * VERIFY（確認してから買う段）も対象にする。この段は「調べてから
     * 判断する」ものなので、AI が先に材料を整理しておく価値が最も高い。
     */
    if (row.action === "VERIFY") {
      out.push({ row, reason: "確認してから買う段にいる", priority: 85 });
      continue;
    }

    // 懸念が記録されている。前提が崩れていないかの判断が必要
    if (row.concernCount > 0) {
      out.push({
        row,
        reason: `確認項目に懸念が ${row.concernCount} 件ある`,
        priority: 80,
      });
      continue;
    }

    // 次の段まで近い。到達したときに慌てないよう先に結論を出しておく
    if (row.nextGapPct !== null && row.nextGapPct > -3) {
      out.push({
        row,
        reason: `次の段まで ${row.nextGapPct.toFixed(1)}%`,
        priority: 70,
      });
      continue;
    }

    // 未保有で目標価格に近い。買い逃しを防ぐ
    if (!row.held && row.watchGapPct !== null && row.watchGapPct > -5) {
      out.push({
        row,
        reason: `目標価格まで ${row.watchGapPct.toFixed(1)}%`,
        priority: 60,
      });
      continue;
    }
  }

  /*
   * 同じ優先度なら評価額の大きい順。金額が大きい銘柄ほど
   * 判断を誤ったときの影響が大きい。未保有（評価額なし）は後ろに回す。
   */
  out.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (b.row.holdingValueJpy ?? 0) - (a.row.holdingValueJpy ?? 0);
  });

  return out.slice(0, limit);
}

/** 直近に提案済みの銘柄を除く */
export async function filterRecentlyProposed(
  userId: number,
  symbols: string[],
  cooldownHours = PROPOSAL_COOLDOWN_HOURS
): Promise<Set<string>> {
  if (symbols.length === 0) return new Set();
  const d = await requireDb();
  const since = new Date(Date.now() - cooldownHours * 3600_000);
  const rows = await d
    .select({ symbol: addProposals.symbol, createdAt: addProposals.createdAt })
    .from(addProposals)
    .where(and(eq(addProposals.userId, userId), inArray(addProposals.symbol, symbols)));
  const recent = new Set<string>();
  for (const r of rows) {
    if (r.createdAt && r.createdAt >= since) recent.add(r.symbol);
  }
  return recent;
}

/** 1 銘柄の提案を作って保存する */
export async function generateProposal(
  userId: number,
  symbol: string
): Promise<{ symbol: string; stance: string; conclusion: string }> {
  const rows = await listPlanOverview(userId);
  const row = rows.find(r => r.symbol === symbol);
  if (!row) {
    throw new Error("この銘柄は保有もウォッチリストにも見つかりませんでした");
  }

  const ctx = await buildConsultContext(userId, symbol);

  const target: ProposalTarget = {
    symbol: row.symbol,
    name: row.name,
    currency: row.currency,
    currentPrice: row.currentPrice,
    held: row.held,
    bandLabel: row.actionLabel,
    nextGapPct: row.nextGapPct,
    nextActionLabel: row.nextActionLabel,
    watchTargetPrice: row.watchTargetPrice,
    concernCount: row.concernCount,
  };

  const result = await withAiRunLog(
    { userId, kind: "add_proposal", symbol },
    async () =>
      proposeForSymbol({
        target,
        context: ctx,
        totalValueJpy: ctx.totalValueJpy,
        interestAssetsJpy: ctx.interestAssetsJpy,
        cashJpy: ctx.cashJpy,
        holdingValueJpy: row.holdingValueJpy ?? 0,
      })
  );

  const d = await requireDb();
  await d.insert(addProposals).values({
    userId,
    symbol: row.symbol,
    held: row.held,
    stance: result.draft.stance,
    conclusion: result.draft.conclusion,
    rationale: result.draft.rationale,
    amountBase: result.draft.amountBase !== null ? String(result.draft.amountBase) : null,
    limitPrice: result.draft.limitPrice !== null ? String(result.draft.limitPrice) : null,
    priceAtProposal: row.currentPrice !== null ? String(row.currentPrice) : null,
    sharePctAtProposal:
      result.sizing !== null ? String(result.sizing.currentSharePct.toFixed(4)) : null,
    invalidation: result.draft.invalidation,
    model: result.model,
  });

  return {
    symbol: row.symbol,
    stance: result.draft.stance,
    conclusion: result.draft.conclusion,
  };
}

/**
 * 判断が必要な銘柄をまとめて提案する。
 *
 * 1 銘柄が失敗しても続ける。1 件の失敗で全部が失敗扱いになると、
 * 成功した分の提案まで失われる。
 */
export async function generateProposalBatch(
  userId: number,
  limit = PROPOSAL_BATCH_LIMIT
): Promise<{
  generated: number;
  failed: number;
  skipped: number;
  results: { symbol: string; stance: string; conclusion: string }[];
  errors: { symbol: string; message: string }[];
}> {
  const rows = await listPlanOverview(userId);
  const candidates = selectProposalTargets(rows, limit * 2);
  const recent = await filterRecentlyProposed(
    userId,
    candidates.map(c => c.row.symbol)
  );

  const todo = candidates.filter(c => !recent.has(c.row.symbol)).slice(0, limit);

  const results: { symbol: string; stance: string; conclusion: string }[] = [];
  const errors: { symbol: string; message: string }[] = [];

  for (const c of todo) {
    try {
      results.push(await generateProposal(userId, c.row.symbol));
    } catch (error) {
      errors.push({
        symbol: c.row.symbol,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    generated: results.length,
    failed: errors.length,
    skipped: candidates.length - todo.length,
    results,
    errors,
  };
}

export type ProposalRow = {
  id: number;
  symbol: string;
  name: string;
  held: boolean;
  stance: string;
  conclusion: string;
  rationale: string;
  amountBase: number | null;
  limitPrice: number | null;
  priceAtProposal: number | null;
  currentPrice: number | null;
  sharePctAtProposal: number | null;
  invalidation: string | null;
  currency: string;
  createdAt: Date;
  /** 提案時から株価がどれだけ動いたか（%）。判断が古びていないかの目安 */
  priceChangePct: number | null;
};

/**
 * 提案の一覧。銘柄ごとに最新の 1 件だけを返す。
 *
 * 過去の提案も保存しているが、一覧に全部出すと同じ銘柄が並んで
 * 「今どうすべきか」が読み取れない。履歴は銘柄詳細で見る。
 */
export async function listProposals(userId: number): Promise<ProposalRow[]> {
  const d = await requireDb();
  const [proposals, rows] = await Promise.all([
    d
      .select()
      .from(addProposals)
      .where(eq(addProposals.userId, userId))
      .orderBy(desc(addProposals.createdAt), desc(addProposals.id)),
    listPlanOverview(userId),
  ]);

  const infoMap = new Map(rows.map(r => [r.symbol, r]));

  const seen = new Set<string>();
  const out: ProposalRow[] = [];
  for (const p of proposals) {
    if (seen.has(p.symbol)) continue;
    seen.add(p.symbol);
    const info = infoMap.get(p.symbol);
    const priceAt = p.priceAtProposal !== null ? Number(p.priceAtProposal) : null;
    const now = info?.currentPrice ?? null;
    out.push({
      id: p.id,
      symbol: p.symbol,
      name: info?.name ?? p.symbol,
      held: p.held,
      stance: p.stance,
      conclusion: p.conclusion,
      rationale: p.rationale,
      amountBase: p.amountBase !== null ? Number(p.amountBase) : null,
      limitPrice: p.limitPrice !== null ? Number(p.limitPrice) : null,
      priceAtProposal: priceAt,
      currentPrice: now,
      sharePctAtProposal:
        p.sharePctAtProposal !== null ? Number(p.sharePctAtProposal) : null,
      invalidation: p.invalidation,
      currency: info?.currency ?? "USD",
      createdAt: p.createdAt,
      priceChangePct:
        priceAt !== null && priceAt > 0 && now !== null ? ((now - priceAt) / priceAt) * 100 : null,
    });
  }
  return out;
}

/** 1 銘柄の提案履歴（新しい順） */
export async function listProposalsForSymbol(
  userId: number,
  symbol: string
): Promise<ProposalRow[]> {
  const d = await requireDb();
  const rows = await d
    .select()
    .from(addProposals)
    .where(and(eq(addProposals.userId, userId), eq(addProposals.symbol, symbol)))
    .orderBy(desc(addProposals.createdAt), desc(addProposals.id));
  return rows.map(p => ({
    id: p.id,
    symbol: p.symbol,
    name: p.symbol,
    held: p.held,
    stance: p.stance,
    conclusion: p.conclusion,
    rationale: p.rationale,
    amountBase: p.amountBase !== null ? Number(p.amountBase) : null,
    limitPrice: p.limitPrice !== null ? Number(p.limitPrice) : null,
    priceAtProposal: p.priceAtProposal !== null ? Number(p.priceAtProposal) : null,
    currentPrice: null,
    sharePctAtProposal: p.sharePctAtProposal !== null ? Number(p.sharePctAtProposal) : null,
    invalidation: p.invalidation,
    currency: "USD",
    createdAt: p.createdAt,
    priceChangePct: null,
  }));
}
