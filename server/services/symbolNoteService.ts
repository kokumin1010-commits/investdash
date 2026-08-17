/**
 * 銘柄メモの蓄積と取得。
 *
 * ニュース・判定変化・相談・提案の当否から、銘柄ごとの出来事を
 * 一本の時系列にまとめる。相談 AI がこれを読むことで、
 * 「3 か月前の決算で下方修正があった」ことを踏まえて答えられる。
 *
 * 積むのは自動。手で書く欄にすると投資カードと同じく使われずに終わる。
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  bandTransitions,
  consultations,
  consultationMessages,
  consultOutcomes,
  newsItems,
  symbolNotes,
  type SymbolNote,
} from "../../drizzle/schema";
import {
  noteFromBandTransition,
  noteFromConsult,
  noteFromNews,
  noteFromOutcome,
  selectNotesForPrompt,
  type NoteDraft,
} from "../../shared/noteBuilder";

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できませんでした");
  return d;
}

/**
 * 溜まっているデータからメモを積む。
 *
 * 毎回全期間を見ると 112 銘柄分のニュースを読み直すことになるため、
 * 既に積んだ sourceKey を除いてから書き込む。DB 側にも一意制約を
 * 置いているので、同時に走っても二重にならない。
 */
export async function syncSymbolNotes(
  userId: number,
  options: { sinceDays?: number } = {}
): Promise<{ added: number; byKind: Record<string, number> }> {
  const db = await requireDb();
  const sinceDays = options.sinceDays ?? 120;
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const [news, bands, consults, outcomes, existing] = await Promise.all([
    db
      .select()
      .from(newsItems)
      .where(and(eq(newsItems.userId, userId), sql`${newsItems.createdAt} >= ${since}`))
      .limit(2000),
    db
      .select()
      .from(bandTransitions)
      .where(and(eq(bandTransitions.userId, userId), sql`${bandTransitions.createdAt} >= ${since}`))
      .limit(2000),
    db
      .select()
      .from(consultations)
      .where(and(eq(consultations.userId, userId), sql`${consultations.createdAt} >= ${since}`))
      .limit(500),
    db
      .select()
      .from(consultOutcomes)
      .where(and(eq(consultOutcomes.userId, userId), sql`${consultOutcomes.createdAt} >= ${since}`))
      .limit(500),
    db
      .select({ sourceKey: symbolNotes.sourceKey })
      .from(symbolNotes)
      .where(eq(symbolNotes.userId, userId)),
  ]);

  const seen = new Set(existing.map(e => e.sourceKey).filter((k): k is string => k !== null));

  const drafts: NoteDraft[] = [];

  for (const n of news) {
    const d = noteFromNews({
      id: n.id,
      symbol: n.symbol,
      title: n.title,
      summary: n.summary,
      impactScore: n.impactScore,
      publishedAt: n.publishedAt,
      createdAt: n.createdAt,
    });
    if (d) drafts.push(d);
  }

  for (const t of bands) {
    drafts.push(
      noteFromBandTransition({
        id: t.id,
        symbol: t.symbol,
        fromLabel: t.fromLabel,
        toLabel: t.toLabel,
        fromAction: t.fromAction,
        toAction: t.toAction,
        outsideDirection: t.outsideDirection,
        price: t.price,
        currency: t.currency,
        createdAt: t.createdAt,
      })
    );
  }

  /*
   * 相談は結論（AI の最初の回答の冒頭）を添える。題名だけだと
   * 「何を相談したか」は分かっても「どう判断したか」が残らない。
   */
  const consultIds = consults.map(c => c.id);
  const answers = new Map<number, string>();
  if (consultIds.length > 0) {
    const msgs = await db
      .select()
      .from(consultationMessages)
      .where(
        and(
          eq(consultationMessages.userId, userId),
          inArray(consultationMessages.consultationId, consultIds),
          eq(consultationMessages.role, "ASSISTANT")
        )
      )
      .orderBy(consultationMessages.id);
    for (const m of msgs) {
      if (!answers.has(m.consultationId)) answers.set(m.consultationId, m.content);
    }
  }

  for (const c of consults) {
    const answer = answers.get(c.id) ?? null;
    const d = noteFromConsult({
      id: c.id,
      symbol: c.symbol,
      title: c.title,
      conclusion: answer ? answer.slice(0, 400) : null,
      createdAt: c.createdAt,
    });
    if (d) drafts.push(d);
  }

  for (const o of outcomes) {
    const d = noteFromOutcome({
      id: o.id,
      symbol: o.symbol,
      stance: o.stance,
      verdict: o.verdict ?? "UNCLEAR",
      priceAtAdvice: o.priceAtAdvice,
      priceAtVerdict: o.priceAtVerdict,
      verdictAt: o.verdictAt,
      createdAt: o.createdAt,
    });
    if (d) drafts.push(d);
  }

  const fresh = drafts.filter(d => !seen.has(d.sourceKey));
  if (fresh.length === 0) return { added: 0, byKind: {} };

  const byKind: Record<string, number> = {};
  for (const d of fresh) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;

  /*
   * 一度に大量に書くと 1 文の SQL が長くなりすぎるため分割する。
   * 重複は DB の一意制約で弾かれるので、失敗しても他の行は残す。
   */
  const CHUNK = 200;
  let added = 0;
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK);
    try {
      await db.insert(symbolNotes).values(
        chunk.map(d => ({
          userId,
          symbol: d.symbol,
          kind: d.kind,
          headline: d.headline,
          detail: d.detail,
          importance: d.importance,
          occurredAt: d.occurredAt,
          sourceKey: d.sourceKey,
        }))
      );
      added += chunk.length;
    } catch (e) {
      // 同時実行で重複した場合は 1 件ずつ入れ直す（全滅させない）
      for (const d of chunk) {
        try {
          await db.insert(symbolNotes).values({
            userId,
            symbol: d.symbol,
            kind: d.kind,
            headline: d.headline,
            detail: d.detail,
            importance: d.importance,
            occurredAt: d.occurredAt,
            sourceKey: d.sourceKey,
          });
          added += 1;
        } catch {
          // 重複は無視する
        }
      }
      void e;
    }
  }

  return { added, byKind };
}

/** 1 銘柄のメモを新しい順に返す */
export async function listSymbolNotes(
  userId: number,
  symbol: string,
  limit = 50
): Promise<SymbolNote[]> {
  const db = await requireDb();
  return db
    .select()
    .from(symbolNotes)
    .where(and(eq(symbolNotes.userId, userId), eq(symbolNotes.symbol, symbol)))
    .orderBy(desc(symbolNotes.occurredAt))
    .limit(limit);
}

/**
 * 相談 AI に渡すメモを選ぶ。
 *
 * 全件渡すとトークンを食い尽くして本題が埋もれる。
 * 新しいものと重要なものの両方を残す（選別は shared の純関数）。
 */
export async function notesForPrompt(
  userId: number,
  symbol: string,
  limit = 12
): Promise<SymbolNote[]> {
  const rows = await listSymbolNotes(userId, symbol, 100);
  return selectNotesForPrompt(rows, limit);
}

/** メモの件数を銘柄ごとに数える（保有一覧に印を出すため） */
export async function countNotesBySymbol(userId: number): Promise<Map<string, number>> {
  const db = await requireDb();
  const rows = await db
    .select({ symbol: symbolNotes.symbol, count: sql<number>`count(*)` })
    .from(symbolNotes)
    .where(eq(symbolNotes.userId, userId))
    .groupBy(symbolNotes.symbol);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.symbol, Number(r.count));
  return map;
}
