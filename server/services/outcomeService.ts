/**
 * 相談で出た提案を記録し、実行されたかどうかを追跡する。
 *
 * 何のためか:
 * AI に結論を断定させる方針にしたので、その結論が当たったのか
 * 外れたのかを検証できなければ精度が上がらない。実行の有無は
 * 保有株数の変化から分かる（買えばスクリーンショットの株数が増える）。
 *
 * 判定を株数の変化で行う理由:
 * ユーザーに「実行しましたか」と聞く形にすると、月 1 回しか画面を
 * 見ない使い方では答えてもらえず記録が溜まらない。株数はスクリーン
 * ショットの取り込みで自然に更新されるので、放っておいても分かる。
 */
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { consultOutcomes, holdings } from "../../drizzle/schema";
import { parseAdvice } from "../../shared/adviceStance";
import { judgeAdvice, summarizeVerdicts } from "../../shared/adviceVerdict";

/** 提案の記録時に保有株数がなければ 0 として扱うか。未保有銘柄の提案もあるため null を許す */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * その銘柄の合計株数と現在値を引く。
 *
 * 複数口座に同じ銘柄がある場合は合計する。口座ごとに見ると
 * 「A 口座で買って B 口座で売った」を実行と誤検知する。
 */
async function loadPosition(
  userId: number,
  symbol: string
): Promise<{ quantity: number | null; price: number | null }> {
  const db = await getDb();
  if (!db) return { quantity: null, price: null };
  const rows = await db
    .select({
      quantity: holdings.quantity,
      currentPrice: holdings.currentPrice,
    })
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.symbol, symbol)));
  if (rows.length === 0) return { quantity: null, price: null };
  let qty = 0;
  let price: number | null = null;
  for (const r of rows) {
    qty += toNum(r.quantity) ?? 0;
    const p = toNum(r.currentPrice);
    if (p !== null && price === null) price = p;
  }
  return { quantity: qty, price };
}

/**
 * 相談の回答から提案を読み取って記録する。
 *
 * 記録できなかった場合は何もしない（例外を投げない）。
 * 相談自体は成立しているのに、追跡の記録に失敗したせいで
 * 回答が保存されないのは本末転倒なため。
 */
export async function recordAdvice(params: {
  userId: number;
  consultationId: number;
  messageId: number;
  symbol: string | null;
  answer: string;
}): Promise<{ recorded: boolean; stance?: string }> {
  const { userId, consultationId, messageId, symbol, answer } = params;
  /*
   * 銘柄が決まっていない全体の相談は追跡しない。
   * 「借入を返すべきか」の提案は特定の銘柄の株数と結びつかず、
   * 実行したかを株数から判定できない。
   */
  if (!symbol) return { recorded: false };

  const advice = parseAdvice(answer);
  if (!advice) return { recorded: false };

  const db = await getDb();
  if (!db) return { recorded: false };

  const pos = await loadPosition(userId, symbol);

  await db.insert(consultOutcomes).values({
    userId,
    consultationId,
    messageId,
    symbol,
    stance: advice.stance,
    conclusion: advice.conclusion,
    quantityAtAdvice: pos.quantity !== null ? String(pos.quantity) : null,
    priceAtAdvice: pos.price !== null ? String(pos.price) : null,
  });

  return { recorded: true, stance: advice.stance };
}

export type ExecutionCheckResult = {
  checked: number;
  executed: number;
  details: {
    symbol: string;
    stance: string;
    before: number | null;
    after: number | null;
    executed: boolean;
  }[];
};

/**
 * まだ実行判定していない提案について、株数が変わったかを調べる。
 *
 * スクリーンショットの取り込み後に呼ぶ。株数が増えていれば
 * 「買った」、減っていれば「売った」と分かる。
 *
 * 変わっていない場合も executed = false として記録する。
 * null のまま残すと「まだ判定していない」と区別できず、
 * 毎回すべての提案を調べ直すことになる。
 */
export async function checkExecutions(userId: number): Promise<ExecutionCheckResult> {
  const db = await getDb();
  if (!db) return { checked: 0, executed: 0, details: [] };

  const pending = await db
    .select({
      id: consultOutcomes.id,
      symbol: consultOutcomes.symbol,
      stance: consultOutcomes.stance,
      quantityAtAdvice: consultOutcomes.quantityAtAdvice,
    })
    .from(consultOutcomes)
    .where(and(eq(consultOutcomes.userId, userId), isNull(consultOutcomes.executed)))
    .orderBy(desc(consultOutcomes.id));

  const details: ExecutionCheckResult["details"] = [];
  let executedCount = 0;

  for (const row of pending) {
    const before = toNum(row.quantityAtAdvice);
    const pos = await loadPosition(userId, row.symbol);
    const after = pos.quantity;

    /*
     * 提案時点の株数が分からないものは判定できない。
     * 「変わっていない」と決めつけると、実際には買っていた場合に
     * 実行を見落とす。null のまま残して次回に回す。
     */
    if (before === null || after === null) continue;

    /*
     * 端株の丸めで 0.0001 単位の差が出ることがあるため、
     * わずかな差は変化なしとみなす。
     */
    const changed = Math.abs(after - before) > 0.001;

    await db
      .update(consultOutcomes)
      .set({
        executed: changed,
        executedAt: changed ? new Date() : null,
        quantityAfter: String(after),
      })
      .where(eq(consultOutcomes.id, row.id));

    if (changed) executedCount += 1;
    details.push({
      symbol: row.symbol,
      stance: row.stance,
      before,
      after,
      executed: changed,
    });
  }

  return { checked: pending.length, executed: executedCount, details };
}

/**
 * 銘柄ごとの提案の履歴を引く。相談画面や銘柄詳細で見せる。
 */
export async function listOutcomes(
  userId: number,
  symbol?: string | null
): Promise<
  {
    id: number;
    consultationId: number;
    symbol: string;
    stance: string;
    conclusion: string;
    quantityAtAdvice: number | null;
    priceAtAdvice: number | null;
    executed: boolean | null;
    quantityAfter: number | null;
    verdict: string | null;
    priceAtVerdict: number | null;
    createdAt: string;
  }[]
> {
  const db = await getDb();
  if (!db) return [];
  const where = symbol
    ? and(eq(consultOutcomes.userId, userId), eq(consultOutcomes.symbol, symbol))
    : eq(consultOutcomes.userId, userId);
  const rows = await db
    .select()
    .from(consultOutcomes)
    .where(where)
    .orderBy(desc(consultOutcomes.createdAt))
    .limit(60);
  return rows.map(r => ({
    id: r.id,
    consultationId: r.consultationId,
    symbol: r.symbol,
    stance: r.stance,
    conclusion: r.conclusion,
    quantityAtAdvice: toNum(r.quantityAtAdvice),
    priceAtAdvice: toNum(r.priceAtAdvice),
    executed: r.executed ?? null,
    quantityAfter: toNum(r.quantityAfter),
    verdict: r.verdict ?? null,
    priceAtVerdict: toNum(r.priceAtVerdict),
    createdAt: r.createdAt.toISOString(),
  }));
}

export type VerdictCheckResult = {
  checked: number;
  judged: number;
  correct: number;
  wrong: number;
  details: {
    symbol: string;
    stance: string;
    verdict: string;
    changePct: number | null;
    reason: string;
  }[];
};

/**
 * 提案の当否を判定する。
 *
 * 株価更新の後に呼ぶ。すでに判定済みのものも、時間が経てば
 * 結論が変わりうるので UNCLEAR のものは再判定する。
 * CORRECT / WRONG が付いたものは上書きしない（後から株価が戻ったせいで
 * 「当たっていたことになった」と履歴が書き換わると実績の意味がなくなる）。
 */
export async function checkVerdicts(userId: number): Promise<VerdictCheckResult> {
  const db = await getDb();
  if (!db) return { checked: 0, judged: 0, correct: 0, wrong: 0, details: [] };

  /*
   * 判定対象は「まだ判定していない」か「判定できなかった（UNCLEAR）」もの。
   * 経過日数が足りずに UNCLEAR になったものが、日が経って判定できるようになる。
   */
  const rows = await db
    .select({
      id: consultOutcomes.id,
      symbol: consultOutcomes.symbol,
      stance: consultOutcomes.stance,
      priceAtAdvice: consultOutcomes.priceAtAdvice,
      createdAt: consultOutcomes.createdAt,
    })
    .from(consultOutcomes)
    .where(
      and(
        eq(consultOutcomes.userId, userId),
        or(isNull(consultOutcomes.verdict), eq(consultOutcomes.verdict, "UNCLEAR"))
      )
    );

  const details: VerdictCheckResult["details"] = [];
  let correct = 0;
  let wrong = 0;

  for (const row of rows) {
    const pos = await loadPosition(userId, row.symbol);
    const daysElapsed = Math.floor((Date.now() - row.createdAt.getTime()) / 86400000);
    const judged = judgeAdvice({
      stance: row.stance,
      priceAtAdvice: toNum(row.priceAtAdvice),
      priceNow: pos.price,
      daysElapsed,
    });

    await db
      .update(consultOutcomes)
      .set({
        verdict: judged.verdict,
        priceAtVerdict: pos.price !== null ? String(pos.price) : null,
        verdictAt: new Date(),
      })
      .where(eq(consultOutcomes.id, row.id));

    if (judged.verdict === "CORRECT") correct += 1;
    if (judged.verdict === "WRONG") wrong += 1;

    details.push({
      symbol: row.symbol,
      stance: row.stance,
      verdict: judged.verdict,
      changePct: judged.changePct,
      reason: judged.reason,
    });
  }

  return { checked: rows.length, judged: correct + wrong, correct, wrong, details };
}

/**
 * 提案の実績を集計する。相談の前提に入れて AI 自身に踏まえさせる。
 *
 * 銘柄を指定すればその銘柄の履歴、指定しなければ全体の実績を返す。
 */
export async function loadAdviceRecord(
  userId: number,
  symbol?: string | null
): Promise<{
  overall: ReturnType<typeof summarizeVerdicts>;
  symbolRows: {
    stance: string;
    conclusion: string;
    executed: boolean | null;
    verdict: string | null;
    createdAt: string;
  }[];
}> {
  const db = await getDb();
  if (!db) {
    return { overall: summarizeVerdicts([]), symbolRows: [] };
  }

  const all = await db
    .select({
      stance: consultOutcomes.stance,
      verdict: consultOutcomes.verdict,
    })
    .from(consultOutcomes)
    .where(eq(consultOutcomes.userId, userId));

  let symbolRows: {
    stance: string;
    conclusion: string;
    executed: boolean | null;
    verdict: string | null;
    createdAt: string;
  }[] = [];

  if (symbol) {
    const rows = await db
      .select({
        stance: consultOutcomes.stance,
        conclusion: consultOutcomes.conclusion,
        executed: consultOutcomes.executed,
        verdict: consultOutcomes.verdict,
        createdAt: consultOutcomes.createdAt,
      })
      .from(consultOutcomes)
      .where(and(eq(consultOutcomes.userId, userId), eq(consultOutcomes.symbol, symbol)))
      .orderBy(desc(consultOutcomes.createdAt))
      .limit(5);
    symbolRows = rows.map(r => ({
      stance: r.stance,
      conclusion: r.conclusion,
      executed: r.executed ?? null,
      verdict: r.verdict ?? null,
      createdAt: r.createdAt.toISOString().slice(0, 10),
    }));
  }

  return { overall: summarizeVerdicts(all), symbolRows };
}
