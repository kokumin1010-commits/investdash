import { invokeLLM } from "../_core/llm";
import type { RawNews } from "./news";

/**
 * ニュースのセンチメント判定と意思決定シグナル生成。
 * 判定は必ず「与えられた材料の範囲内」で行い、根拠を日本語で明示させる。
 */

export type NewsVerdict = {
  urlHash: string;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  impactScore: number;
  summary: string;
  reasoning: string;
};

const NEWS_SYSTEM = `あなたは日本と米国の株式市場を担当する経験豊富なアナリストです。
与えられたニュース見出しを、対象企業の株主にとってどのような意味を持つかという観点で評価します。

評価ルール:
1. sentiment は POSITIVE / NEGATIVE / NEUTRAL のいずれか。株価への方向性ではなく、
   企業のファンダメンタルズにとって良い材料か悪い材料かで判断する。
2. impactScore は 0-100。株主の投資判断にどれだけ影響するかの度合い。
   - 80-100: 業績見通しの大幅な変更、M&A、重大な不祥事、大規模な資本政策
   - 50-79: 四半期決算の上下振れ、主要事業のニュース、格付け・目標株価の変更
   - 20-49: 通常の適時開示、小規模な提携、業界動向
   - 0-19: 株価データの羅列、掲示板、実質的な情報を含まない記事
3. summary は見出しから読み取れる内容を 1〜2 文の日本語で要約する。見出しに書かれていない
   事実を追加してはならない。
4. reasoning は「なぜその sentiment と impactScore にしたか」を 1〜2 文の日本語で説明する。
5. 見出しだけでは判断材料が不足している場合は NEUTRAL・低スコアとし、reasoning に
   「見出しのみでは判断材料が不足」と記載する。`;

const NEWS_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "news_verdicts",
    strict: true,
    schema: {
      type: "object",
      properties: {
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "number", description: "入力リストの番号（1始まり）" },
              sentiment: { type: "string", enum: ["POSITIVE", "NEGATIVE", "NEUTRAL"] },
              impactScore: { type: "number" },
              summary: { type: "string" },
              reasoning: { type: "string" },
            },
            required: ["index", "sentiment", "impactScore", "summary", "reasoning"],
            additionalProperties: false,
          },
        },
      },
      required: ["verdicts"],
      additionalProperties: false,
    },
  },
};

/**
 * ニュースをまとめて 1 回の呼び出しで判定する（コスト効率のため）。
 */
export async function analyzeNewsBatch(
  companyName: string,
  items: RawNews[]
): Promise<NewsVerdict[]> {
  if (items.length === 0) return [];

  const list = items
    .map((it, i) => `${i + 1}. [${it.source ?? "出典不明"}] ${it.title}`)
    .join("\n");

  const res = await invokeLLM({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: NEWS_SYSTEM },
      {
        role: "user",
        content: `対象企業: ${companyName}\n\n以下のニュース見出しを 1 件ずつ評価してください。\n\n${list}`,
      },
    ],
    responseFormat: NEWS_SCHEMA,
    maxTokens: 8192,
  });

  const text = res.choices?.[0]?.message?.content;
  if (typeof text !== "string") return [];

  try {
    const parsed = JSON.parse(text) as {
      verdicts: Array<Omit<NewsVerdict, "urlHash"> & { index: number }>;
    };
    return (parsed.verdicts ?? [])
      .map(v => {
        const src = items[v.index - 1];
        if (!src) return null;
        return {
          urlHash: src.urlHash,
          sentiment: v.sentiment,
          impactScore: Math.max(0, Math.min(100, Math.round(v.impactScore))),
          summary: v.summary,
          reasoning: v.reasoning,
        } satisfies NewsVerdict;
      })
      .filter((v): v is NewsVerdict => v !== null);
  } catch (error) {
    console.warn("[analysis] analyzeNewsBatch parse failed:", error);
    return [];
  }
}

/** シグナル生成に渡す銘柄コンテキスト */
export type SignalContext = {
  name: string;
  symbol: string;
  currency: string;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  pnlPct: number | null;
  /** ポートフォリオ全体に対する構成比（%） */
  weightPct: number | null;
  sector: string | null;
  industry: string | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  /** 直近 3 か月・1 か月の騰落率（%） */
  return1m: number | null;
  return3m: number | null;
  /** 投資カードの記録内容 */
  card: {
    buyReason: string | null;
    coreThesis: string | null;
    valuationAssumption: string | null;
    fairValue: number | null;
    keyFinancials: string | null;
    exitConditions: string | null;
    risks: string | null;
  } | null;
  /** 直近ニュースの判定結果 */
  news: Array<{
    title: string;
    sentiment: string | null;
    impactScore: number | null;
    summary: string | null;
    publishedAt: Date | null;
  }>;
};

export type SignalResult = {
  action: "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT";
  confidence: number;
  rationale: string;
  factors: {
    newsSentiment: string;
    priceAction: string;
    valuation: string;
    positionSizing: string;
    thesisIntegrity: string;
  };
};

const SIGNAL_SYSTEM = `あなたは長期投資を前提とする個人投資家の意思決定を支援するアナリストです。
与えられた 1 銘柄の情報から、ADD / HOLD / WATCH / REDUCE / EXIT のいずれかを提示します。

各シグナルの定義:
- ADD: 投資ロジックが健全で、現在価格が想定価値より魅力的。買い増しを検討する余地がある
- HOLD: 投資ロジックに変化なし。特段の行動を必要としない
- WATCH: 判断材料が不足、または注視すべき変化が出始めている。追加調査が必要
- REDUCE: 構成比が過大、またはロジックの一部が崩れている。一部売却を検討する
- EXIT: 当初の投資ロジックが実質的に崩れた、またはエグジット条件に該当した

判定の原則:
1. **含み損の大きさそれ自体を売却理由にしてはならない。** 逆に含み益の大きさを
   買い増し理由にしてもならない。判断の基準は常に「当初の投資ロジックが今も有効か」。
2. 投資カードにエグジット条件が記録されている場合、それに該当するかを最優先で確認する。
3. 投資カードが未記入の場合は、判断材料が不足しているため WATCH を基本とし、
   rationale で「投資カードの記入を推奨」と明示する。
4. ニュースは impactScore が高いものを重視する。低スコアのニュースを過度に重視しない。
5. 構成比が 25% を超える銘柄は、ロジックが健全でも集中リスクに言及する。
6. データが欠損している項目については推測せず、「データ未取得」と明記する。
7. confidence は判断材料の充足度。投資カード未記入・ニュース 0 件なら 40 未満とする。

rationale は日本語 3〜5 文。結論の理由と、次に確認すべき点を含める。
断定的な売買推奨表現（「買うべき」「売却すべき」）は避け、「〜を検討する材料がある」
「〜の確認を推奨する」という表現を用いる。

factors の各項目は 1 文の日本語で簡潔に記述する。`;

const SIGNAL_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "signal_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["ADD", "HOLD", "WATCH", "REDUCE", "EXIT"] },
        confidence: { type: "number" },
        rationale: { type: "string" },
        factors: {
          type: "object",
          properties: {
            newsSentiment: { type: "string" },
            priceAction: { type: "string" },
            valuation: { type: "string" },
            positionSizing: { type: "string" },
            thesisIntegrity: { type: "string" },
          },
          required: [
            "newsSentiment",
            "priceAction",
            "valuation",
            "positionSizing",
            "thesisIntegrity",
          ],
          additionalProperties: false,
        },
      },
      required: ["action", "confidence", "rationale", "factors"],
      additionalProperties: false,
    },
  },
};

function fmt(v: number | null | undefined, unit = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "データ未取得";
  return `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${unit}`;
}

export function buildSignalPrompt(ctx: SignalContext): string {
  const cardLines = ctx.card
    ? [
        `- 買付理由: ${ctx.card.buyReason || "未記入"}`,
        `- コア投資ロジック: ${ctx.card.coreThesis || "未記入"}`,
        `- バリュエーション前提: ${ctx.card.valuationAssumption || "未記入"}`,
        `- 想定フェアバリュー: ${fmt(ctx.card.fairValue, ` ${ctx.currency}`)}`,
        `- 主要決算数値: ${ctx.card.keyFinancials || "未記入"}`,
        `- エグジット条件: ${ctx.card.exitConditions || "未記入"}`,
        `- 想定リスク: ${ctx.card.risks || "未記入"}`,
      ].join("\n")
    : "投資カードは未作成です。";

  const newsLines =
    ctx.news.length > 0
      ? ctx.news
          .map(
            n =>
              `- [${n.sentiment ?? "未判定"} / 影響度${n.impactScore ?? "—"}] ${n.title}${
                n.summary ? `\n  要約: ${n.summary}` : ""
              }`
          )
          .join("\n")
      : "直近のニュースは取得されていません。";

  const fvGap =
    ctx.card?.fairValue && ctx.currentPrice
      ? `${(((ctx.currentPrice - ctx.card.fairValue) / ctx.card.fairValue) * 100).toFixed(1)}%（プラスは想定価値より割高）`
      : "フェアバリュー未設定のため算出不可";

  const rangePos =
    ctx.currentPrice && ctx.fiftyTwoWeekHigh && ctx.fiftyTwoWeekLow
      ? `${(
          ((ctx.currentPrice - ctx.fiftyTwoWeekLow) /
            (ctx.fiftyTwoWeekHigh - ctx.fiftyTwoWeekLow)) *
          100
        ).toFixed(0)}%（0%が年初来安値、100%が年初来高値）`
      : "データ未取得";

  return `## 銘柄
${ctx.name}（${ctx.symbol}）／セクター: ${ctx.sector ?? "未取得"}／業種: ${ctx.industry ?? "未取得"}

## ポジション
- 保有株数: ${fmt(ctx.quantity)} 株
- 取得単価: ${fmt(ctx.avgCost, ` ${ctx.currency}`)}
- 現在値: ${fmt(ctx.currentPrice, ` ${ctx.currency}`)}
- 損益率: ${ctx.pnlPct === null ? "データ未取得" : `${ctx.pnlPct.toFixed(2)}%`}
- ポートフォリオ構成比: ${ctx.weightPct === null ? "データ未取得" : `${ctx.weightPct.toFixed(1)}%`}

## 価格の位置
- 52週高値: ${fmt(ctx.fiftyTwoWeekHigh, ` ${ctx.currency}`)}／52週安値: ${fmt(ctx.fiftyTwoWeekLow, ` ${ctx.currency}`)}
- 52週レンジ内の位置: ${rangePos}
- 直近1か月騰落率: ${ctx.return1m === null ? "データ未取得" : `${ctx.return1m.toFixed(2)}%`}
- 直近3か月騰落率: ${ctx.return3m === null ? "データ未取得" : `${ctx.return3m.toFixed(2)}%`}
- フェアバリュー乖離: ${fvGap}

## 投資カードの記録
${cardLines}

## 直近ニュース（AI 判定済み）
${newsLines}

以上の材料のみに基づいて、シグナルを判定してください。`;
}

export async function generateSignal(ctx: SignalContext): Promise<SignalResult> {
  const res = await invokeLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: SIGNAL_SYSTEM },
      { role: "user", content: buildSignalPrompt(ctx) },
    ],
    responseFormat: SIGNAL_SCHEMA,
    maxTokens: 4096,
  });

  const text = res.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("シグナルの生成に失敗しました。");
  }

  const parsed = JSON.parse(text) as SignalResult;
  return {
    ...parsed,
    confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence))),
  };
}

/** ウォッチリスト銘柄向けのシグナル（購入タイミング判断） */
export type WatchSignalContext = {
  name: string;
  symbol: string;
  currency: string;
  currentPrice: number | null;
  targetPrice: number | null;
  buyConditions: string | null;
  watchReason: string | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  news: Array<{
    title: string;
    sentiment: string | null;
    impactScore: number | null;
    summary: string | null;
  }>;
};

const WATCH_SYSTEM = `あなたは長期投資家の購入検討を支援するアナリストです。
ウォッチリスト銘柄について、ADD（買付検討の条件が整いつつある）／WATCH（引き続き注視）／
EXIT（ウォッチリストから外すことを検討）のいずれかを提示します。

原則:
1. 目標価格が設定されている場合、現在価格との関係を最優先で評価する。
2. 買付条件が記録されている場合、それが満たされているかを確認する。
3. 目標価格・買付条件が未設定の場合は WATCH とし、条件の明文化を促す。
4. 断定的な推奨表現は避ける。
rationale は日本語 3〜4 文。`;

export async function generateWatchSignal(ctx: WatchSignalContext): Promise<SignalResult> {
  const gap =
    ctx.currentPrice && ctx.targetPrice
      ? `${(((ctx.currentPrice - ctx.targetPrice) / ctx.targetPrice) * 100).toFixed(1)}%（プラスは目標より高い）`
      : "目標価格未設定";

  const newsLines =
    ctx.news.length > 0
      ? ctx.news
          .map(n => `- [${n.sentiment ?? "未判定"} / 影響度${n.impactScore ?? "—"}] ${n.title}`)
          .join("\n")
      : "直近のニュースは取得されていません。";

  const prompt = `## 銘柄
${ctx.name}（${ctx.symbol}）

## 価格
- 現在値: ${fmt(ctx.currentPrice, ` ${ctx.currency}`)}
- 目標買付価格: ${fmt(ctx.targetPrice, ` ${ctx.currency}`)}
- 目標との乖離: ${gap}
- 52週高値: ${fmt(ctx.fiftyTwoWeekHigh)}／52週安値: ${fmt(ctx.fiftyTwoWeekLow)}

## 記録
- 買付条件: ${ctx.buyConditions || "未記入"}
- 注目理由: ${ctx.watchReason || "未記入"}

## 直近ニュース
${newsLines}

以上の材料のみに基づいて判定してください。`;

  const res = await invokeLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: WATCH_SYSTEM },
      { role: "user", content: prompt },
    ],
    responseFormat: SIGNAL_SCHEMA,
    maxTokens: 3072,
  });

  const text = res.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("シグナルの生成に失敗しました。");
  const parsed = JSON.parse(text) as SignalResult;
  return { ...parsed, confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence))) };
}
