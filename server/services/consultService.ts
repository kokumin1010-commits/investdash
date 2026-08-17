/**
 * 相談の保存・取得。
 *
 * 会話（consultations）と発言（consultationMessages）を分けて持ち、
 * 履歴から会話を開き直して続きを聞けるようにする。
 *
 * AI 実行の記録（aiRunLogs）も必ず残す。成功・失敗の両方を残さないと
 * 「答えが返ってこなかった」ときに何が起きたか後から追えない。
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  consultationMessages,
  consultations,
  type Consultation,
  type ConsultationMessage,
} from "../../drizzle/schema";
import { buildConsultContext } from "./consultContext";
import { recordAdvice } from "./outcomeService";
import { askAdvisor, buildTitle, type ConsultTurn } from "./consultAdvisor";
import { logAiRun } from "./aiRunLog";

export type ConsultationSummary = {
  id: number;
  title: string;
  symbol: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  /** 一覧で中身が想像できるよう、最後の AI 回答の冒頭を添える */
  lastAnswerHead: string | null;
};

export type ConsultationDetail = {
  consultation: Consultation;
  messages: ConsultationMessage[];
};

/** 一覧に出す会話数の上限 */
export const LIST_LIMIT = 50;

/** 銘柄ごとの相談の状況 */
export type SymbolConsultStat = {
  symbol: string;
  /** その銘柄を対象にした相談の件数 */
  consultCount: number;
  /** 最後に相談した日時 */
  lastConsultedAt: Date;
  /** 直近の相談（銘柄詳細から開き直すため） */
  lastConsultationId: number;
  lastTitle: string;
};

/**
 * 銘柄ごとの相談の状況をまとめて返す。
 *
 * 保有一覧で「この銘柄は前に相談した」と分かるようにするため。
 * 112 銘柄それぞれで問い合わせると一覧が遅くなるので 1 回で引いて
 * メモリ上で集計する。
 */
export async function listSymbolConsultStats(
  userId: number
): Promise<Map<string, SymbolConsultStat>> {
  const db = await getDb();
  const stats = new Map<string, SymbolConsultStat>();
  if (!db) return stats;

  const rows = await db
    .select({
      id: consultations.id,
      symbol: consultations.symbol,
      title: consultations.title,
      updatedAt: consultations.updatedAt,
    })
    .from(consultations)
    .where(eq(consultations.userId, userId))
    .orderBy(desc(consultations.updatedAt));

  for (const r of rows) {
    /*
     * 銘柄を指定しない相談（全体の方針など）は対象外。
     * 特定の銘柄の印として出すと、関係ない銘柄に印が付く。
     */
    if (!r.symbol) continue;

    const existing = stats.get(r.symbol);
    if (existing) {
      existing.consultCount += 1;
      continue;
    }
    // 降順で引いているので最初に見つかったものが直近
    stats.set(r.symbol, {
      symbol: r.symbol,
      consultCount: 1,
      lastConsultedAt: r.updatedAt,
      lastConsultationId: r.id,
      lastTitle: r.title,
    });
  }

  return stats;
}

/** 特定の銘柄の相談だけを新しい順に返す（銘柄詳細で使う） */
export async function listConsultationsBySymbol(
  userId: number,
  symbol: string
): Promise<ConsultationSummary[]> {
  const all = await listConsultations(userId);
  return all.filter(c => c.symbol === symbol);
}

export async function listConsultations(userId: number): Promise<ConsultationSummary[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(consultations)
    .where(eq(consultations.userId, userId))
    .orderBy(desc(consultations.updatedAt))
    .limit(LIST_LIMIT);

  if (rows.length === 0) return [];

  /*
   * 発言は会話ごとに引かず 1 回でまとめて引く。
   * 会話が 50 件あると 50 回のクエリになり一覧が遅くなる。
   */
  const messages = await db
    .select({
      consultationId: consultationMessages.consultationId,
      role: consultationMessages.role,
      content: consultationMessages.content,
      createdAt: consultationMessages.createdAt,
    })
    .from(consultationMessages)
    .where(eq(consultationMessages.userId, userId))
    .orderBy(asc(consultationMessages.createdAt));

  const byConsultation = new Map<number, typeof messages>();
  for (const m of messages) {
    const list = byConsultation.get(m.consultationId) ?? [];
    list.push(m);
    byConsultation.set(m.consultationId, list);
  }

  return rows.map(r => {
    const list = byConsultation.get(r.id) ?? [];
    const lastAnswer = [...list].reverse().find(m => m.role === "ASSISTANT");
    return {
      id: r.id,
      title: r.title,
      symbol: r.symbol ?? null,
      messageCount: list.length,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastAnswerHead: lastAnswer ? lastAnswer.content.replace(/[#*\n]/g, " ").slice(0, 120) : null,
    };
  });
}

export async function getConsultation(
  userId: number,
  consultationId: number
): Promise<ConsultationDetail | null> {
  const db = await getDb();
  if (!db) return null;

  const [row] = await db
    .select()
    .from(consultations)
    .where(and(eq(consultations.id, consultationId), eq(consultations.userId, userId)))
    .limit(1);
  if (!row) return null;

  const messages = await db
    .select()
    .from(consultationMessages)
    .where(eq(consultationMessages.consultationId, consultationId))
    .orderBy(asc(consultationMessages.createdAt));

  return { consultation: row, messages };
}

/**
 * 質問を送って回答を得る。
 *
 * consultationId を渡さない場合は新しい会話を作る。
 * 渡した場合はその会話の続きとして扱い、過去のやり取りを AI に渡す。
 */
export async function ask(params: {
  userId: number;
  question: string;
  consultationId?: number | null;
  symbol?: string | null;
}): Promise<{ consultationId: number; answer: string }> {
  const { userId, question } = params;
  const db = await getDb();
  if (!db) throw new Error("データベースに接続できません");

  const trimmed = question.trim();
  if (!trimmed) throw new Error("質問を入力してください");

  let consultationId = params.consultationId ?? null;
  let symbol = params.symbol ?? null;
  let history: ConsultTurn[] = [];

  if (consultationId) {
    const existing = await getConsultation(userId, consultationId);
    if (!existing) throw new Error("相談が見つかりません");
    /*
     * 銘柄は会話に紐づくものを優先する。
     * 続きの質問で毎回銘柄を送らせると、送り忘れたときに
     * 文脈から銘柄が消えて回答が一般論になる。
     */
    symbol = existing.consultation.symbol ?? symbol;
    history = existing.messages.map(m => ({ role: m.role, content: m.content }));
  }

  /*
   * 文脈は毎回作り直す。会話の途中で株価や判定が変わることがあり、
   * 最初の 1 回だけ渡す設計では古い前提で答え続けてしまう。
   *
   * 進行中の会話は「過去の相談」から除く。history として別途渡しており、
   * 両方に入れると同じ内容が二重に渡ってトークンを無駄にする。
   */
  const context = await buildConsultContext(userId, symbol, consultationId);

  const started = Date.now();
  let answer: string;
  let model: string;
  try {
    const res = await askAdvisor({ question: trimmed, context, history });
    answer = res.answer;
    model = res.model;
  } catch (error) {
    await logAiRun({
      userId,
      kind: "consult",
      symbol,
      status: "FAILED",
      durationMs: Date.now() - started,
      detail: error instanceof Error ? error.message.slice(0, 500) : "unknown",
    });
    throw error;
  }

  /*
   * 会話の作成は回答が得られてから行う。
   * 先に作ると、AI が失敗したときに空の会話が一覧に残り続ける。
   */
  if (!consultationId) {
    const inserted = await db.insert(consultations).values({
      userId,
      title: buildTitle(trimmed, symbol),
      symbol,
    });
    /*
     * mysql2 は [ResultSetHeader, fields] を返すため先頭から取り出す。
     * 取れない場合は保存済みの行を読み直す（過去に insertId が
     * 取れず NaN になり保存が壊れた経緯があるため）。
     */
    const header = Array.isArray(inserted) ? inserted[0] : inserted;
    const rawId = (header as { insertId?: number })?.insertId;
    if (typeof rawId === "number" && Number.isFinite(rawId) && rawId > 0) {
      consultationId = rawId;
    } else {
      const [latest] = await db
        .select({ id: consultations.id })
        .from(consultations)
        .where(eq(consultations.userId, userId))
        .orderBy(desc(consultations.id))
        .limit(1);
      if (!latest) throw new Error("相談の保存に失敗しました");
      consultationId = latest.id;
    }
  }

  await db.insert(consultationMessages).values([
    {
      consultationId,
      userId,
      role: "USER" as const,
      content: trimmed,
      contextSnapshot: null,
      model: null,
    },
    {
      consultationId,
      userId,
      role: "ASSISTANT" as const,
      content: answer,
      /*
       * 当時の前提を残す。株価も配当も変わるので、今の値で読み返すと
       * 回答と数字が食い違って見え、判断の妥当性を検証できない。
       */
      contextSnapshot: JSON.stringify({
        totalValueJpy: context.totalValueJpy,
        borrowedJpy: context.borrowedJpy,
        netAssetsJpy: context.netAssetsJpy,
        leverage: context.leverage,
        annualDividendJpy: context.annualDividendJpy,
        focus: context.focus,
        builtAt: context.builtAt,
      }).slice(0, 60000),
      model,
    },
  ]);

  /*
   * updatedAt は onUpdateNow で自動更新されるが、
   * 発言を追加しただけでは会話行が更新されないので明示的に触る。
   * 一覧は updatedAt の降順なので、これを忘れると
   * 続きを聞いた会話が下に沈んだままになる。
   */
  await db
    .update(consultations)
    .set({ updatedAt: new Date() })
    .where(eq(consultations.id, consultationId));

  /*
   * 提案を追跡用に記録する。
   *
   * 失敗しても相談自体は成立しているので握りつぶす。追跡の記録に
   * 失敗したせいで回答が返らないのは本末転倒。
   * 記録には回答の発言 ID が必要なので、保存後に読み直して取る
   * （insert の戻りから 2 件目の ID を得る手段がなく、
   *  1 件目 + 1 と決め打ちすると同時実行でずれる恐れがある）。
   */
  try {
    const [savedAnswer] = await db
      .select({ id: consultationMessages.id })
      .from(consultationMessages)
      .where(
        and(
          eq(consultationMessages.consultationId, consultationId),
          eq(consultationMessages.role, "ASSISTANT")
        )
      )
      .orderBy(desc(consultationMessages.id))
      .limit(1);
    if (savedAnswer) {
      await recordAdvice({
        userId,
        consultationId,
        messageId: savedAnswer.id,
        symbol,
        answer,
      });
    }
  } catch (error) {
    console.error("[consult] 提案の記録に失敗:", error);
  }

  await logAiRun({
    userId,
    kind: "consult",
    symbol,
    model,
    status: "SUCCESS",
    durationMs: Date.now() - started,
    detail: `q=${trimmed.slice(0, 100)}`,
  });

  return { consultationId, answer };
}

export async function deleteConsultation(userId: number, consultationId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  /*
   * 発言を先に消す。会話を先に消すと、途中で失敗したときに
   * 参照先のない発言が残る。
   */
  await db
    .delete(consultationMessages)
    .where(
      and(
        eq(consultationMessages.consultationId, consultationId),
        eq(consultationMessages.userId, userId)
      )
    );
  await db
    .delete(consultations)
    .where(and(eq(consultations.id, consultationId), eq(consultations.userId, userId)));
}
