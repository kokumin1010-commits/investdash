/**
 * 臨時レポート（決算・重大ニュース）の生成。
 *
 * 決算日を事前に知ることはできないため（Yahoo Finance の API に
 * 決算予定日が含まれない。日本株・香港株・SG 株では決算に関する項目が
 * 1 つも返らない）、起きたことを検知して出す形にしている。
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../db";
import * as dbHelpers from "../db";
import { aiReports, newsItems } from "../../drizzle/schema";
import { detectUrgentEvents, type DetectedEvent, type NewsLike } from "../../shared/eventDetect";
import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";
import { withAiRunLog } from "./aiRunLog";
import { listPlanOverview } from "./priceBandService";

const MODEL = "gemini-3-flash-preview";

/** 1 回の実行で出す臨時レポートの上限。多いと読まれない */
export const MAX_URGENT_PER_RUN = 3;

const SYSTEM = `あなたは長期保有を前提とする個人投資家の投資記録を書く担当です。
ある銘柄について重要な出来事が起きたときの記録を書きます。

守ること:
- 与えられた情報だけを使う。株価や業績を推測して書かない。
- 「買うべき」「売るべき」と断定しない。何が起きたか、何を確認すべきかを書く。
- 長期保有の観点で「当初の想定が崩れる話なのか、一時的な話なのか」に触れる。
  これが判断の分かれ目になる。
- 情報が足りず判断できない点は「判断できない」と正直に書く。
- 日本語で簡潔に書く。`;

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "urgent_report",
    strict: true,
    schema: {
      type: "object",
      properties: {
        headline: {
          type: "string",
          description: "一覧に出す 1 行。銘柄名と何が起きたかを含める。80 文字以内",
        },
        body: {
          type: "string",
          description:
            "本文（Markdown）。## で節を分ける。「何が起きたか」「長期保有への影響」「確認すべき点」の 3 節にする",
        },
        needsAction: {
          type: "boolean",
          description: "本人が判断・確認をする必要があるか",
        },
      },
      required: ["headline", "body", "needsAction"],
      additionalProperties: false,
    },
  },
};

async function requireDb() {
  const d = await getDb();
  if (!d) throw new Error("データベースに接続できません");
  return d;
}

export function buildUrgentPrompt(
  event: DetectedEvent,
  context: {
    name: string;
    currency: string;
    currentPrice: number | null;
    actionLabel: string | null;
    nextGapPct: number | null;
    nextActionLabel: string | null;
    quantity: number | null;
    avgCost: number | null;
  }
): string {
  const lines: string[] = [];
  lines.push(`## 銘柄\n${context.name}（${event.news.symbol}）`);
  lines.push(`## 取り上げる理由\n${event.reason}`);

  const state: string[] = ["## 保有の状況"];
  if (context.quantity !== null) state.push(`- 保有数: ${context.quantity.toLocaleString()}`);
  if (context.avgCost !== null) {
    state.push(`- 取得単価: ${context.currency} ${context.avgCost.toLocaleString()}`);
  }
  if (context.currentPrice !== null) {
    state.push(`- 現在値: ${context.currency} ${context.currentPrice.toLocaleString()}`);
  }
  if (context.actionLabel) state.push(`- 買い増しプランの今の段: ${context.actionLabel}`);
  if (context.nextGapPct !== null && context.nextActionLabel) {
    state.push(`- 次の段まで: ${context.nextGapPct.toFixed(1)}%（${context.nextActionLabel}）`);
  }
  lines.push(state.join("\n"));

  lines.push(
    [
      "## 出来事",
      `- 見出し: ${event.news.title}`,
      event.news.summary ? `- 要約: ${event.news.summary}` : null,
      `- 影響度: ${event.news.impactScore ?? "不明"}`,
      `- 判定: ${event.news.sentiment ?? "不明"}`,
    ]
      .filter(Boolean)
      .join("\n")
  );

  lines.push(
    [
      "## 書き方",
      "「何が起きたか」「長期保有への影響」「確認すべき点」の 3 節で書く。",
      "長期保有への影響では、当初の想定が崩れる話なのか一時的な話なのかに触れる。",
      "情報が足りない点は推測で埋めず「判断できない」と書く。",
    ].join("\n")
  );

  return lines.join("\n\n");
}

/**
 * 臨時レポートを生成する。
 *
 * @param lookbackHours 何時間前までのニュースを対象にするか
 */
export async function createUrgentReports(
  userId: number,
  lookbackHours = 26
): Promise<{ created: number; skipped: number; details: string[] }> {
  const d = await requireDb();
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const [rows, holdings, overview] = await Promise.all([
    d
      .select()
      .from(newsItems)
      .where(and(eq(newsItems.userId, userId), gte(newsItems.publishedAt, since)))
      .orderBy(desc(newsItems.impactScore)),
    dbHelpers.listHoldings(userId),
    listPlanOverview(userId),
  ]);

  const heldSymbols = new Set(holdings.map(h => h.symbol));
  const items: NewsLike[] = rows.map(r => ({
    id: r.id,
    symbol: r.symbol,
    title: r.title,
    summary: r.summary,
    impactScore: r.impactScore,
    sentiment: r.sentiment,
    publishedAt: r.publishedAt,
  }));

  const events = detectUrgentEvents(items, heldSymbols);
  if (events.length === 0) {
    return { created: 0, skipped: 0, details: ["対象となる出来事はありませんでした"] };
  }

  /*
   * すでに同じ銘柄で臨時レポートを出していないか確認する。
   * 同じ決算について「速報」「詳報」と別のニュースで 2 回出すと
   * 同じ内容が並んで読まれなくなる。
   */
  const symbols = events.map(e => e.news.symbol);
  const existing = await d
    .select({ triggerSymbol: aiReports.triggerSymbol })
    .from(aiReports)
    .where(
      and(
        eq(aiReports.userId, userId),
        inArray(aiReports.kind, ["EARNINGS", "NEWS"]),
        gte(aiReports.createdAt, since),
        inArray(aiReports.triggerSymbol, symbols)
      )
    );
  const alreadyReported = new Set(
    existing.map(e => e.triggerSymbol).filter((s): s is string => s !== null)
  );

  let created = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const event of events) {
    if (created >= MAX_URGENT_PER_RUN) {
      skipped += 1;
      continue;
    }
    if (alreadyReported.has(event.news.symbol)) {
      skipped += 1;
      details.push(`${event.news.symbol}: すでに出しているため省略`);
      continue;
    }

    const holding = holdings.find(h => h.symbol === event.news.symbol);
    const ov = overview.find(o => o.symbol === event.news.symbol);

    try {
      const result = await withAiRunLog(
        {
          userId,
          kind: "weekly_report",
          symbol: event.news.symbol,
          model: MODEL,
          summarize: r => `${r.headline.slice(0, 120)}`,
        },
        async () => {
          const res = await invokeLLM({
            model: MODEL,
            messages: [
              { role: "system", content: SYSTEM },
              {
                role: "user",
                content: buildUrgentPrompt(event, {
                  name: holding?.name ?? event.news.symbol,
                  currency: holding?.currency ?? "",
                  currentPrice: ov?.currentPrice ?? null,
                  actionLabel: ov?.actionLabel ?? null,
                  nextGapPct: ov?.nextGapPct ?? null,
                  nextActionLabel: ov?.nextActionLabel ?? null,
                  quantity: holding ? Number(holding.quantity) : null,
                  avgCost: holding ? Number(holding.avgCost) : null,
                }),
              },
            ],
            responseFormat: SCHEMA,
            maxTokens: 4096,
          });

          if (res.choices?.[0]?.finish_reason === "length") {
            throw new Error("臨時レポートの生成が途中で打ち切られました");
          }
          return parseLlmJson<{ headline: string; body: string; needsAction: boolean }>(
            res.choices?.[0]?.message?.content,
            "臨時レポートの応答"
          );
        }
      );

      await d.insert(aiReports).values({
        userId,
        kind: event.kind,
        headline: (result.headline ?? "").slice(0, 300),
        body: result.body ?? "",
        symbols: [event.news.symbol],
        actionCount: result.needsAction ? 1 : 0,
        triggerSymbol: event.news.symbol,
        model: MODEL,
      });

      created += 1;
      details.push(`${event.news.symbol}: ${result.headline?.slice(0, 60) ?? ""}`);
    } catch (error) {
      console.error(`[urgentReport] ${event.news.symbol} failed:`, error);
      details.push(
        `${event.news.symbol}: 生成に失敗（${error instanceof Error ? error.message : String(error)}）`
      );
    }
  }

  return { created, skipped, details };
}
