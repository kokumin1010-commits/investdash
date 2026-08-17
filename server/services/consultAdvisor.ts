/**
 * 相談 AI。保有状況を前提に置いて質問に答える。
 *
 * 方針:
 * - 買え・売れと断定しない。判断材料と確認すべき点を出すところまで。
 *   最終判断は本人がする。断定させると、外れたときに理由を辿れなくなる。
 * - 渡した数字だけを使わせる。株価や指標を推測で書かせると、
 *   一見もっともらしい嘘が混ざり、履歴として読み返せなくなる。
 * - 借入とレバレッジに必ず触れさせる。買い増しは借入を増やす行為なので、
 *   これを無視した「買ってよい」は判断材料として不完全になる。
 * - 前のやり取りを踏まえて答える。同じ説明を繰り返させない。
 */
import { invokeLLM } from "../_core/llm";
import type { ConsultContext, ConsultHolding } from "./consultContext";

export const CONSULT_MODEL = "gemini-3-flash-preview";

/**
 * 過去のやり取りをいくつ渡すか。
 *
 * 全部渡すと会話が伸びるほどトークンを食い、古い前提（当時の株価）が
 * 今の質問に混ざる。直近だけで文脈は足りる。
 */
export const HISTORY_LIMIT = 8;

const SYSTEM = `あなたは長期保有を前提とする個人投資家の相談相手です。

相談者の状況:
- 複数の証券口座（moomoo 日本・楽天証券・IBKR シンガポール・渣打銀行・富途香港）で
  日本株・米国株・シンガポール株・香港株を保有している。
- IBKR で日本円を借りて信用取引をしている。買い増しは借入の増加につながる。
- 買った株は基本的に持ち続ける方針。頻繁な売買はしない。
- 画面を見るのは月に 1 回程度。

守ること:
- 与えられた数字だけを使う。株価・指標・業績を自分で推測して書かない。
  数字が渡されていないことは「渡された情報では確認できない」と書く。
- 「買うべき」「売るべき」と断定しない。判断の材料、確認すべき点、
  どういう条件なら見送るべきかを示す。最終判断は相談者がする。
- 買い増しの相談では必ず借入とレバレッジへの影響に触れる。
  現金で買えるのか、借入が増えるのかで意味が変わる。
- 業種や市場の偏りが相談内容に関係する場合は指摘する。
- 飾った表現を使わない。事実と根拠を並べる。
- 日本語で答える。Markdown の見出し（##）と箇条書きを使って読みやすくする。
- 長くしすぎない。600 字程度を目安にし、結論を先に書く。`;

function fmtJpy(v: number | null | undefined): string {
  if (v === null || v === undefined) return "不明";
  return `${Math.round(v).toLocaleString("ja-JP")} 円`;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "不明";
  return `${v.toFixed(2)}%`;
}

function holdingLine(h: ConsultHolding): string {
  const parts = [
    `${h.name}（${h.symbol}・${h.market}）`,
    `評価額 ${fmtJpy(h.valueJpy)}`,
    `構成比 ${h.sharePct.toFixed(1)}%`,
  ];
  if (h.price !== null) parts.push(`現在値 ${h.price} ${h.currency}`);
  if (h.avgCost !== null) parts.push(`取得単価 ${h.avgCost} ${h.currency}`);
  if (h.pnlPct !== null) parts.push(`損益 ${fmtPct(h.pnlPct)}`);
  if (h.dividendYieldPct !== null) parts.push(`利回り ${fmtPct(h.dividendYieldPct)}`);
  if (h.sector) parts.push(`業種 ${h.sector}`);
  if (h.bandLabel) parts.push(`買い増しプラン判定「${h.bandLabel}」`);
  return `- ${parts.join(" / ")}`;
}

/**
 * 保有状況を文章にする。
 *
 * JSON をそのまま渡すのではなく文章にしているのは、
 * どの数字が何を指すかを言葉で添えないと AI が単位を取り違えるため
 * （円と現地通貨、率と倍率が混ざる）。
 */
export function buildContextText(ctx: ConsultContext): string {
  const lines: string[] = [];

  lines.push("## 現在の保有状況（すべて税引前・円換算。現在値と取得単価のみ現地通貨）");
  lines.push(`- 株式時価: ${fmtJpy(ctx.totalValueJpy)}（${ctx.positionCount} 銘柄）`);
  lines.push(`- 現金性資産: ${fmtJpy(ctx.cashJpy)}`);
  if (ctx.borrowedJpy > 0) {
    lines.push(`- 借入: ${fmtJpy(ctx.borrowedJpy)}（IBKR で日本円を借り入れ）`);
    lines.push(`- 純資産（借入を差し引いた額）: ${fmtJpy(ctx.netAssetsJpy)}`);
    if (ctx.leverage !== null) {
      lines.push(
        `- レバレッジ: ${ctx.leverage.toFixed(2)} 倍（株式時価 ÷ 純資産。1.0 なら借入なし）`
      );
    }
    if (ctx.annualInterestJpy !== null) {
      lines.push(`- 年間の借入金利負担: ${fmtJpy(ctx.annualInterestJpy)}`);
    }
  } else {
    lines.push("- 借入: なし");
  }
  lines.push(
    `- 年間配当（見込み）: ${fmtJpy(ctx.annualDividendJpy)}（利回り ${fmtPct(ctx.dividendYieldPct)}）`
  );
  if (ctx.usdJpyRate) lines.push(`- USD/JPY: ${ctx.usdJpyRate.toFixed(2)} 円`);

  if (ctx.markets.length > 0) {
    lines.push("");
    lines.push("## 市場別の構成比");
    for (const m of ctx.markets) {
      lines.push(`- ${m.market}: ${m.sharePct.toFixed(1)}%`);
    }
  }

  if (ctx.sectors.length > 0) {
    lines.push("");
    lines.push("## 配当の業種別の割合（年間配当に対する比率）");
    for (const s of ctx.sectors) {
      lines.push(`- ${s.sector}: ${s.sharePct.toFixed(1)}%`);
    }
  }

  if (ctx.focus) {
    lines.push("");
    lines.push("## 相談対象の銘柄（保有中）");
    lines.push(holdingLine(ctx.focus));
  } else if (ctx.focusSymbol) {
    lines.push("");
    lines.push(
      `## 相談対象の銘柄: ${ctx.focusSymbol}（現在は保有していない。株価などの数値は渡されていないため推測で書かないこと）`
    );
  }

  if (ctx.focusNews.length > 0) {
    lines.push("");
    lines.push("## 相談対象銘柄の直近ニュース");
    for (const n of ctx.focusNews) {
      const impact = n.impactScore !== null ? `影響度 ${n.impactScore}` : "影響度 未評価";
      lines.push(`- ${n.title}（${impact}）${n.summary ? ` — ${n.summary}` : ""}`);
    }
  } else if (ctx.focusSymbol) {
    lines.push("");
    lines.push(
      "## 相談対象銘柄の直近ニュース: 取得できていない。ニュースを根拠にした記述はしないこと"
    );
  }

  if (ctx.addZone.length > 0) {
    lines.push("");
    lines.push("## 現在買い増しの価格帯に入っている銘柄（他の選択肢として）");
    for (const a of ctx.addZone) {
      lines.push(`- ${a.name}（${a.symbol}）: ${a.label}`);
    }
  }

  lines.push("");
  lines.push("## 評価額上位の保有銘柄");
  for (const h of ctx.topHoldings) {
    lines.push(holdingLine(h));
  }

  return lines.join("\n");
}

export type ConsultTurn = { role: "USER" | "ASSISTANT"; content: string };

/**
 * 相談に答える。
 *
 * 文脈は毎回作り直して渡す。会話の途中で株価が動くことがあり、
 * 最初の 1 回だけ渡す設計だと古い前提で答え続けてしまう。
 */
export async function askAdvisor(params: {
  question: string;
  context: ConsultContext;
  history: ConsultTurn[];
}): Promise<{ answer: string; model: string }> {
  const { question, context, history } = params;

  const recent = history.slice(-HISTORY_LIMIT);

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM },
    {
      role: "system",
      content: `以下は相談者の現在の保有状況です。回答ではこの数字だけを使ってください。\n\n${buildContextText(context)}`,
    },
  ];

  for (const turn of recent) {
    messages.push({
      role: turn.role === "USER" ? "user" : "assistant",
      content: turn.content,
    });
  }
  messages.push({ role: "user", content: question });

  const res = await invokeLLM({
    model: CONSULT_MODEL,
    messages,
    /*
     * 構造化出力にしない。相談は自由な文章の方が伝わる。
     * 項目を固定すると、当てはまらない項目を無理に埋めることになる。
     */
    maxTokens: 4096,
  });

  /*
   * content は文字列の場合と、部品の配列の場合がある。
   * 配列のときに文字列として扱うと "[object Object]" が保存され、
   * 履歴として読めなくなるので、テキスト部分だけを取り出して繋ぐ。
   */
  const raw = res.choices?.[0]?.message?.content;
  const answer = (
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw
            .map(part => (part && "text" in part && typeof part.text === "string" ? part.text : ""))
            .join("")
        : ""
  ).trim();
  if (!answer) {
    /*
     * 空の回答を保存すると履歴に空欄が残り、後から読んでも
     * 失敗したのか AI が答えなかったのか区別できない。
     */
    throw new Error("AI から回答が得られませんでした。もう一度お試しください");
  }
  return { answer, model: CONSULT_MODEL };
}

/**
 * 会話の題名を質問から作る。
 *
 * AI に別途作らせると呼び出しが 2 回になり時間と費用が倍になる。
 * 一覧で探せれば十分なので、質問の冒頭を切り出す。
 */
export function buildTitle(question: string, symbol?: string | null): string {
  const cleaned = question.replace(/\s+/g, " ").trim();
  const head = cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
  return symbol ? `[${symbol}] ${head}`.slice(0, 200) : head.slice(0, 200) || "相談";
}
