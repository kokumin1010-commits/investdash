/**
 * AI にレポート本文を書かせる。
 *
 * 材料は weeklyDigest.ts が機械的に絞ってから渡す。AI 呼び出しは 1 回だけ。
 * 112 銘柄を個別に分析させると 40 分以上かかり、cron の 2 分制限に
 * 収まらないため。
 *
 * 方針:
 * - 買え・売れの断定はさせない。判断材料を揃えるところまで。
 * - 何もなかった週は「特筆すべき動きはありません」と正直に書かせる。
 *   無理に話を作らせると、本当に重要な週との区別がつかなくなる。
 * - 数字は渡したものだけを使わせる。AI が数字を作ると信用できなくなる。
 */
import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";
import type { DigestInput } from "./weeklyDigest";

export const REPORT_MODEL = "gemini-3-flash-preview";

const SYSTEM = `あなたは長期保有を前提とする個人投資家の投資記録を書く担当です。

守ること:
- 与えられた数字だけを使う。自分で株価や指標を推測して書かない。
- 「買うべき」「売るべき」と断定しない。判断の材料と、確認すべき点までを書く。
- 材料がない場合は「特筆すべき動きはありません」と正直に書く。話を作らない。
- 読み手は月に 1 回程度しか画面を開かない。その間に何が起きたかが分かるように書く。
- 日本語で書く。専門用語は使ってよいが、飾った表現は避け、事実と根拠を並べる。`;

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "investment_report",
    strict: true,
    schema: {
      type: "object",
      properties: {
        headline: {
          type: "string",
          description:
            "一覧に出す 1 行。本文を開かなくても要否が判断できる具体的な文。80 文字以内",
        },
        body: {
          type: "string",
          description:
            "本文（Markdown）。## で節を分ける。判断が必要なものを先に書き、次に全体の状況を書く",
        },
        actionCount: {
          type: "integer",
          description: "判断や確認を要する項目の件数。何もなければ 0",
        },
      },
      required: ["headline", "body", "actionCount"],
      additionalProperties: false,
    },
  },
};

export type ReportResult = {
  headline: string;
  body: string;
  actionCount: number;
};

function fmtJpy(n: number): string {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function fmtDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 材料を AI に渡す文章に組み立てる */
export function buildWeeklyPrompt(input: DigestInput): string {
  const lines: string[] = [];
  lines.push(
    `## 対象期間\n${fmtDate(input.periodStart)} 〜 ${fmtDate(input.periodEnd)}`
  );

  const o = input.overview;
  lines.push(
    [
      "## 資産の状況（円換算）",
      `- 株式時価: ${fmtJpy(o.stockValueJpy)}`,
      `- 借入: ${fmtJpy(o.borrowedJpy)}`,
      `- 利息で増える現金性資産: ${fmtJpy(o.interestAssetsJpy)}`,
      `- 純資産: ${fmtJpy(o.netAssetsJpy)}`,
      o.leverage === null ? "- レバレッジ: 算出不可" : `- レバレッジ: ${o.leverage.toFixed(2)} 倍`,
      `- 年間配当（見込み）: ${fmtJpy(o.annualDividendJpy)}`,
      `- 保有レコード数: ${o.holdingsCount}`,
      `- 買い増しの価格帯にいる銘柄: ${input.buyZoneCount}`,
    ].join("\n")
  );

  if (input.topics.length === 0) {
    /*
     * 材料がない週も生成する。出さないと「レポートが来ないのは
     * 壊れているのか」と区別できなくなる。
     * 無理に話を作らせないよう、材料がないことを明示して渡す。
     */
    lines.push(`## 今期間の材料\nありません。理由: ${input.quietReason ?? "該当なし"}`);
    lines.push(
      [
        "## 書き方",
        "取り上げる材料がないため、資産の状況を短く触れたうえで",
        "「今回は特筆すべき動きはなく、動く必要はありません」と明記する。",
        "無い情報を推測して補わない。actionCount は 0 にする。",
      ].join("\n")
    );
    return lines.join("\n\n");
  }

  lines.push("## 今期間に取り上げる銘柄");
  for (const t of input.topics) {
    const parts: string[] = [];
    parts.push(`### ${t.name}（${t.symbol}）`);
    parts.push(`- 取り上げる理由: ${t.reasons.join(" / ")}`);
    if (t.currentPrice !== null) {
      parts.push(`- 現在値: ${t.currency} ${t.currentPrice.toLocaleString()}`);
    }
    if (t.actionLabel) parts.push(`- 今の段: ${t.actionLabel}`);
    if (t.nextGapPct !== null && t.nextActionLabel) {
      parts.push(
        `- 次の段まで: ${t.nextGapPct.toFixed(1)}%（${t.nextActionLabel}）`
      );
    }
    for (const tr of t.transitions) {
      parts.push(`- 判定の変化（${fmtDate(tr.at)}）: ${tr.description}`);
    }
    for (const n of t.news) {
      parts.push(
        `- ニュース（影響度 ${n.impactScore ?? "?"} / ${n.sentiment ?? "?"}）: ${n.title}` +
          (n.summary ? `\n  要約: ${n.summary}` : "")
      );
    }
    lines.push(parts.join("\n"));
  }

  lines.push(
    [
      "## 書き方",
      "1. 判断や確認が必要な銘柄を先に書く。それぞれ「今の状況」「確認すべき点」を挙げる。",
      "2. 次に、全体の状況（レバレッジ・配当と借入金利の関係など）を短く触れる。",
      "3. 最後に「今回は何もしなくてよい」場合はそう明記する。",
      "actionCount には 1 で挙げた銘柄のうち、実際に判断を要するものの件数を入れる。",
    ].join("\n")
  );

  return lines.join("\n\n");
}

export async function generateWeeklyReport(input: DigestInput): Promise<ReportResult> {
  const res = await invokeLLM({
    model: REPORT_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildWeeklyPrompt(input) },
    ],
    responseFormat: SCHEMA,
    /*
     * 12 銘柄分の日本語の本文で 3,000 トークンを超える。
     * 途中で切れると JSON が壊れてレポートごと失われるため余裕を持たせる。
     */
    maxTokens: 8192,
  });

  if (res.choices?.[0]?.finish_reason === "length") {
    throw new Error("レポートの生成が途中で打ち切られました");
  }

  const parsed = parseLlmJson<ReportResult>(
    res.choices?.[0]?.message?.content,
    "レポートの応答"
  );

  const headline = (parsed.headline ?? "").trim();
  const body = (parsed.body ?? "").trim();
  if (!headline || !body) {
    throw new Error("レポートの内容が空でした");
  }

  return {
    // DB の列は 300 文字。長い見出しで保存が失敗しないよう切る
    headline: headline.slice(0, 300),
    body,
    actionCount: Number.isFinite(parsed.actionCount) ? Math.max(0, parsed.actionCount) : 0,
  };
}
