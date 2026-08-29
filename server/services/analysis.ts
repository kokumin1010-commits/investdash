import { invokeLLM } from "../_core/llm";
import type { RawNews } from "./news";
import { parseLlmJson } from "./jsonExtract";
import { BROKER_LABELS, type Broker } from "../../shared/investing";
import {
  formatLongTermReturns,
  type LongTermReturns,
} from "../../shared/longTermReturn";

/**
 * ニュースのセンチメント判定と意思決定シグナル生成。
 * 判定は必ず「与えられた材料の範囲内」で行い、根拠を日本語で明示させる。
 */

/**
 * 使用モデル。
 *
 * `response_format: json_schema` を指定しても、内蔵プロキシではモデルによって
 * スキーマが無視され Markdown が返ることを実測で確認している。
 *   - claude-sonnet-4-6 / claude-haiku-4-5 → Markdown を返す（NG）
 *   - gpt-5-mini → JSON を返すが `max_completion_tokens` 必須、かつ 35 秒前後で遅い
 *   - gemini-3-flash-preview → JSON を安定して返し 10〜16 秒（採用）
 * 27 銘柄を一括分析する用途があるため、速度も重要な選定基準。
 */
const ANALYSIS_MODEL = "gemini-3-flash-preview";

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
              index: {
                type: "number",
                description: "入力リストの番号（1始まり）",
              },
              sentiment: {
                type: "string",
                enum: ["POSITIVE", "NEGATIVE", "NEUTRAL"],
              },
              impactScore: { type: "number" },
              summary: { type: "string" },
              reasoning: { type: "string" },
            },
            required: [
              "index",
              "sentiment",
              "impactScore",
              "summary",
              "reasoning",
            ],
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
    model: ANALYSIS_MODEL,
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

  try {
    const parsed = parseLlmJson<{
      verdicts: Array<Omit<NewsVerdict, "urlHash"> & { index: number }>;
    }>(text, "ニュース分析の応答");
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
  /**
   * 長期の株価騰落率（1 年・3 年・5 年・年率換算）。
   *
   * 【なぜ必要か】
   * 1 か月・3 か月だけでは「一時的に下がった」ことしか分からず、
   * 「価格の伸びが企業の中身の伸びを追い越していないか」を判断できない。
   * 取得単価がいくらかは判断に使わない。$20 で買ったか $80 で買ったかは、
   * 今この値段で買うかどうかとは無関係である。
   */
  longTerm?: LongTermReturns | null;
  /**
   * 企業の事業内容（Yahoo Finance の longBusinessSummary）。
   *
   * 財務諸表の数値は 4 市場すべてで取得できないことが実測で判明したため、
   * 「設備に大きな資本を必要とするか」「ブランドや規約収入で稼ぐか」という
   * 企業の型は事業内容から判定させる。全市場で取得できている。
   */
  businessSummary?: string | null;
  /**
   * 同一銘柄を複数の証券口座で保有している場合の内訳。
   * 判定自体は合計ポジションに対して 1 つ出すが、
   * 「片方の口座は含み損」という状況は判断材料になるため渡す。
   * 1 口座のみの場合は null。
   */
  accountBreakdown?: Array<{
    broker: string;
    quantity: number;
    avgCost: number;
    pnlPct: number | null;
  }> | null;
  /** 直近 12 か月实绩与特别配当剔除后的持续配当（symbol 合计） */
  dividend?: {
    perShare: number;
    annualIncomeBase: number | null;
    yieldPct: number | null;
    recurringYieldPct: number | null;
    hasSpecial: boolean;
    updatedAt: Date | null;
  } | null;
  /** 借入が集中する IBKR 口座の主リスク。全体レバレッジで薄めない */
  ibkrRisk?: {
    leverage: number | null;
    riskLevel: "SAFE" | "CAUTION" | "WARNING" | "DANGER";
    dropToMarginCallPct: number | null;
  } | null;
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
  /**
   * 今この株を 1 株も持っていなかったとして、この値段で買うか。
   *
   * ADD と別に持つ理由: 「今からは買わないが売る理由もない」という
   * 判断は実際に存在する（大きく育った株を持ち続ける場合）。
   * ADD/HOLD に押し込むとその区別が消える。
   */
  wouldBuyNow?: "YES" | "NO" | "UNCLEAR";
  /** 上の判断の理由を 1 文で */
  wouldBuyNowReason?: string;
  /**
   * 株価の伸びと企業価値の伸びのどちらが速かったか。
   * PRICE_AHEAD = 価格が先に行った / VALUE_AHEAD = 中身の方が伸びた /
   * IN_LINE = ほぼ同じ / UNKNOWN = 判断できない
   */
  priceVsValue?: "PRICE_AHEAD" | "VALUE_AHEAD" | "IN_LINE" | "UNKNOWN";
  /** 上の判断の理由を 1〜2 文で */
  priceVsValueReason?: string;
  /** サーバーが入力の充足度から算出する。モデルの自己申告にはしない */
  dataQuality: "STRONG" | "MODERATE" | "LIMITED";
  /** 次に判定を見直す具体条件（最大3件） */
  reviewTriggers: string[];
  /** 現在の材料から確認できる主要リスク（最大3件） */
  riskFlags: string[];
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
1. **主判断は、現在保有している合計ポジションを今どう扱うか。** 保有株数、
   複数口座の合計構成比、現在の損益、投資ロジック、配当、IBKR の借入リスクを踏まえ、
   ADD / HOLD / WATCH / REDUCE / EXIT を実際の保有に対して判定する。
2. 取得単価と含み損益は実行・税務・リスクの材料として扱うが、含み損の大きさだけを
   売却理由にしたり、含み益の大きさだけを買い増し理由にしてはならない。
3. **「今この株を 1 株も持っておらず現金を持っていたら、この値段で買うか」も
   参考として別に自問する。** 答えを wouldBuyNow に入れるが、これは主判断ではなく、
   rationale の冒頭や現在保有への提案に書かない。
	   - YES: 未保有なら新規に買う水準
	   - NO: 新規に買う水準ではない（ただし保有中なら売るべきとは限らない）
   - UNCLEAR: 判断材料が足りない
4. **株価の伸びと企業の中身の伸びを比べる。** 売却を検討すべきなのは
   「値上がりしたから」ではなく「価格の上昇速度が企業価値の上昇速度を
   超えたから」である。1 年・3 年・5 年の株価騰落率と、事業内容から
   推測できる企業価値の伸びを比較し、priceVsValue に入れる。
   - PRICE_AHEAD: 価格が中身より速く伸びた（REDUCE を検討する材料）
   - VALUE_AHEAD: 中身の方が伸びた（ADD を検討する材料）
   - IN_LINE: ほぼ同じ速さ（HOLD の材料）
   - UNKNOWN: 判断できない
   **重要: 財務諸表の数値は与えられていない。営業利益率や ROE を具体的な
   数字で断定してはならない。** 事業内容と一般に知られた企業の性質から
   定性的に述べ、確信が持てない場合は UNKNOWN とする。
5. **企業の型を見る。** 事業内容から次を判断する。
   - 設備や工場に絶えず大きな資本を投じ続けないと競争力を保てない型か
   - ブランド・規約収入・切り替えの手間などで、追加資本をあまり必要とせず
     利益を伸ばせる型か
   前者は株価が伸びても中身が追いつかないことが起きやすい。
   後者は長く持つほど有利になりやすい。
6. 判断の基準は常に「当初の投資ロジックが今も有効か」。
7. 投資カードにエグジット条件が記録されている場合、それに該当するかを最優先で確認する。
8. **投資カードが未記入でも、WATCH に固定してはならない。** その場合は入手可能な
   客観データ（ニュースの内容と影響度、52週レンジ内の位置、直近騰落率、構成比）から
   最も妥当なシグナルを判定する。判断の指針:
   - 影響度 70 以上の好材料が複数あり、ロジックを損なう悪材料がない → ADD または HOLD
   - 影響度 70 以上の悪材料（業績下方修正、不祥事、事業環境の構造的悪化）がある → REDUCE または WATCH
   - エグジット条件に該当する重大な悪材料がある → EXIT
   - 構成比が 25% を超える → ロジックが健全でも REDUCE を検討する
   - 好材料と悪材料が混在し方向性が定まらない、または材料そのものが乏しい → WATCH
   投資カードが未記入であることは confidence を下げる要因として扱い、rationale の
   最後に「投資カードを記入すると判定の精度が上がる」と 1 文で添える。
   ただしこれを判定そのものの理由にしてはならない。
9. ニュースは impactScore が高いものを重視する。低スコアのニュースを過度に重視しない。
10. 構成比が 25% を超える銘柄は、ロジックが健全でも集中リスクに言及する。
11. IBKR が CAUTION 以上の場合、借入を増やす ADD を安易に出さず、主文でリスクを明記する。
12. 配当データがある場合は、無配と誤記してはならない。特別配当を除いた利回りも区別する。
13. データが欠損している項目については推測せず、「データ未取得」と明記する。
14. confidence は判断材料の充足度を表す。目安:
   - 投資カード記入済み + 影響度の高いニュースあり → 70〜90
   - 投資カード未記入だが影響度の高いニュースあり → 45〜65
   - 投資カード未記入・ニュースも乏しい → 40 未満
15. WATCH は「具体的に未解決の確認事項」または「好悪材料が衝突している」ときだけ使う。
   投資ロジックが維持され、材料が揃い、今すぐ行動する根拠が無い場合は HOLD とする。
   単に一部データが無いことだけを理由に全銘柄を WATCH に寄せてはならない。
16. reviewTriggers は、次回に確認できる具体条件を 1〜3 件書く。例: 決算で通期見通しが
   下方修正された時、52週高値を更新した時、投資カードのエグジット条件に該当した時。
   「注視する」「様子を見る」だけの抽象表現は禁止する。
17. riskFlags は入力資料から確認できる現在の主要リスクを 0〜3 件書く。根拠が無いリスクを
   一般論で追加しない。該当しない場合は空配列にする。

rationale は日本語 3〜5 文。**冒頭で「現在の合計保有株数と、それをどうするか」を述べ、
実際の保有に対する提案から始める。**「今この株を持っていなかったら」「未保有なら」
「新規に買うか」という仮定を rationale の冒頭または主文に書くことは禁止する。
その後に理由、構成比・配当・借入リスク、次に確認すべき点を書く。
断定的な売買推奨表現（「買うべき」「売却すべき」）は避け、「〜を検討する材料がある」
「〜の確認を推奨する」という表現を用いる。

wouldBuyNowReason は 1 文。priceVsValueReason は 1〜2 文。
いずれも取得単価に言及せず、今の値段と企業の中身だけで述べる。

factors の各項目は 1 文の日本語で簡潔に記述する。`;

const SIGNAL_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "signal_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["ADD", "HOLD", "WATCH", "REDUCE", "EXIT"],
        },
        confidence: { type: "number" },
        rationale: { type: "string" },
        wouldBuyNow: { type: "string", enum: ["YES", "NO", "UNCLEAR"] },
        wouldBuyNowReason: { type: "string" },
        priceVsValue: {
          type: "string",
          enum: ["PRICE_AHEAD", "VALUE_AHEAD", "IN_LINE", "UNKNOWN"],
        },
        priceVsValueReason: { type: "string" },
        reviewTriggers: {
          type: "array",
          maxItems: 3,
          items: { type: "string" },
        },
        riskFlags: {
          type: "array",
          maxItems: 3,
          items: { type: "string" },
        },
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
      required: [
        "action",
        "confidence",
        "rationale",
        "wouldBuyNow",
        "wouldBuyNowReason",
        "priceVsValue",
        "priceVsValueReason",
        "reviewTriggers",
        "riskFlags",
        "factors",
      ],
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

  /** 複数口座にまたがる場合のみ内訳を添える */
  const breakdownBlock =
    ctx.accountBreakdown && ctx.accountBreakdown.length > 1
      ? `\n## 口座別の内訳（判定は合計ポジションに対して 1 つ出すこと）\n${ctx.accountBreakdown
          .map(
            a =>
              `- ${BROKER_LABELS[a.broker as Broker] ?? a.broker}: ${fmt(a.quantity)} 株／取得単価 ${fmt(
                a.avgCost,
                ` ${ctx.currency}`
              )}／損益率 ${a.pnlPct === null ? "データ未取得" : `${a.pnlPct.toFixed(2)}%`}`
          )
          .join("\n")}\n`
      : "";

  /**
   * 長期の株価騰落。取得できなかった期間は「データ未取得」と明記される。
   * 省くと AI が「5 年の実績は良好」のように推測で埋める。
   */
  const longTermBlock = ctx.longTerm
    ? formatLongTermReturns(ctx.longTerm)
    : "長期の株価データは取得できていません。長期の伸びを判断材料にしないこと。";

  /**
   * 事業内容は英語の長文で来る。全文を渡すとトークンを食うため 1,200 字で切る。
   * 企業の型（設備集約型か、追加資本の少ない型か）を判断するには
   * 冒頭の事業説明で足りる。
   */
  const businessBlock = ctx.businessSummary
    ? ctx.businessSummary.slice(0, 1200)
    : "事業内容は取得できていません。企業の型は判断材料にしないこと。";

  const dividendBlock = ctx.dividend
    ? `- 1株配当（直近12か月実績）: ${fmt(ctx.dividend.perShare, ` ${ctx.currency}`)}
- 年間配当見込（全口座合計・円換算・税引前）: ${fmt(ctx.dividend.annualIncomeBase, " 円")}
- 現在値配当利回り: ${ctx.dividend.yieldPct === null ? "データ未取得" : `${ctx.dividend.yieldPct.toFixed(2)}%`}
- 継続配当利回り（特別配当除外）: ${ctx.dividend.recurringYieldPct === null ? "データ未取得" : `${ctx.dividend.recurringYieldPct.toFixed(2)}%`}
- 特別配当: ${ctx.dividend.hasSpecial ? "含む" : "なし"}
- 配当データ更新: ${ctx.dividend.updatedAt ? ctx.dividend.updatedAt.toISOString() : "データ未取得"}`
    : "配当データは未取得です。無配と断定しないこと。";

  const ibkrBlock = ctx.ibkrRisk
    ? `- 主レバレッジ: ${ctx.ibkrRisk.leverage === null ? "データ未取得" : `${ctx.ibkrRisk.leverage.toFixed(2)}x`}
- リスク区分: ${ctx.ibkrRisk.riskLevel}
- 追証までの下落余地: ${ctx.ibkrRisk.dropToMarginCallPct === null ? "データ未取得" : `${ctx.ibkrRisk.dropToMarginCallPct.toFixed(1)}%`}`
    : "IBKR 借入データは未取得です。";

  return `## 銘柄
${ctx.name}（${ctx.symbol}）／セクター: ${ctx.sector ?? "未取得"}／業種: ${ctx.industry ?? "未取得"}

## ポジション
- 保有株数: ${fmt(ctx.quantity)} 株
- 取得単価: ${fmt(ctx.avgCost, ` ${ctx.currency}`)}
- 現在値: ${fmt(ctx.currentPrice, ` ${ctx.currency}`)}
- 損益率: ${ctx.pnlPct === null ? "データ未取得" : `${ctx.pnlPct.toFixed(2)}%`}
- ポートフォリオ構成比: ${ctx.weightPct === null ? "データ未取得" : `${ctx.weightPct.toFixed(1)}%`}
${breakdownBlock}
## 配当（直近12か月実績ベース）
${dividendBlock}

## IBKR 集中借入リスク（全体レバレッジで薄めない）
${ibkrBlock}

## 価格の位置
- 52週高値: ${fmt(ctx.fiftyTwoWeekHigh, ` ${ctx.currency}`)}／52週安値: ${fmt(ctx.fiftyTwoWeekLow, ` ${ctx.currency}`)}
- 52週レンジ内の位置: ${rangePos}
- 直近1か月騰落率: ${ctx.return1m === null ? "データ未取得" : `${ctx.return1m.toFixed(2)}%`}
- 直近3か月騰落率: ${ctx.return3m === null ? "データ未取得" : `${ctx.return3m.toFixed(2)}%`}
- フェアバリュー乖離: ${fvGap}

## 長期の株価の伸び（価格と企業価値の速さを比べるための材料）
${longTermBlock}

## 事業内容（企業の型を判断する材料。財務諸表の数値は与えられていない）
${businessBlock}

## 投資カードの記録
${cardLines}

## 直近ニュース（AI 判定済み）
${newsLines}

以上の材料のみに基づいて、シグナルを判定してください。`;
}

export const SIGNAL_SCHEMA_VERSION = 3;

/**
 * モデルの confidence をそのまま信用しない。入力の実際の充足度をサーバー側で
 * 判定し、材料が少ないときは上限を下げる。
 */
export function assessSignalDataQuality(
  ctx: SignalContext
): "STRONG" | "MODERATE" | "LIMITED" {
  const cardValues = ctx.card
    ? [
        ctx.card.buyReason,
        ctx.card.coreThesis,
        ctx.card.valuationAssumption,
        ctx.card.keyFinancials,
        ctx.card.exitConditions,
        ctx.card.risks,
      ]
    : [];
  const cardFilled = cardValues.filter(
    value => typeof value === "string" && value.trim()
  ).length;
  const analyzedNews = ctx.news.filter(
    item => item.sentiment !== null && item.impactScore !== null
  ).length;
  const hasPriceSet =
    ctx.currentPrice !== null &&
    ctx.fiftyTwoWeekHigh !== null &&
    ctx.fiftyTwoWeekLow !== null &&
    ctx.longTerm !== null &&
    ctx.longTerm !== undefined;
  const hasCompanyProfile = Boolean(
    ctx.businessSummary?.trim() && ctx.sector && ctx.industry
  );

  if (cardFilled >= 4 && analyzedNews >= 1 && hasPriceSet && hasCompanyProfile)
    return "STRONG";
  if (
    cardFilled >= 2 &&
    ctx.currentPrice !== null &&
    (analyzedNews >= 1 || hasCompanyProfile)
  ) {
    return "MODERATE";
  }
  return "LIMITED";
}

function normalizeSignalList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0
    )
    .map(item => item.trim().slice(0, 240))
    .slice(0, 3);
}

export function ensureHoldingRationaleLead(
  rationale: string,
  action: SignalResult["action"],
  quantity: number
): string {
  const trimmed = rationale.trim();
  const firstSentence = trimmed.split("。")[0] ?? "";
  const alreadyActual =
    /保有/.test(firstSentence) &&
    !/持っていなかったら|未保有なら|新規に買うか/.test(firstSentence);
  if (alreadyActual) return trimmed;

  const hypotheticalLead =
    /^(今[、]?この株を持っていなかったら|未保有なら|今この株を1株も持っていなかったら)/.test(
      firstSentence
    );
  const remainder = hypotheticalLead
    ? trimmed
        .slice(firstSentence.length + (trimmed.includes("。") ? 1 : 0))
        .trim()
    : trimmed;
  const quantityLabel = quantity.toLocaleString("ja-JP", {
    maximumFractionDigits: 4,
  });
  const lead: Record<SignalResult["action"], string> = {
    ADD: `${quantityLabel}株を保有中で、現在は買い増しを検討する判断です`,
    HOLD: `${quantityLabel}株を保有中で、現在のポジションを維持する判断です`,
    WATCH: `${quantityLabel}株を保有中で、追加売買をせず確認条件を待つ判断です`,
    REDUCE: `${quantityLabel}株を保有中で、一部売却による縮小を検討する判断です`,
    EXIT: `${quantityLabel}株を保有中で、全保有の退出を検討する判断です`,
  };
  return remainder ? `${lead[action]}。${remainder}` : `${lead[action]}。`;
}

export async function generateSignal(
  ctx: SignalContext
): Promise<SignalResult> {
  const res = await invokeLLM({
    model: ANALYSIS_MODEL,
    messages: [
      { role: "system", content: SIGNAL_SYSTEM },
      { role: "user", content: buildSignalPrompt(ctx) },
    ],
    responseFormat: SIGNAL_SCHEMA,
    maxTokens: 4096,
  });

  const text = res.choices?.[0]?.message?.content;
  const parsed = parseLlmJson<Omit<SignalResult, "dataQuality">>(
    text,
    "シグナルの応答"
  );
  const dataQuality = assessSignalDataQuality(ctx);
  const confidenceCap =
    dataQuality === "STRONG" ? 100 : dataQuality === "MODERATE" ? 75 : 55;
  return {
    ...parsed,
    rationale: ensureHoldingRationaleLead(
      parsed.rationale,
      parsed.action,
      ctx.quantity
    ),
    confidence: Math.max(
      0,
      Math.min(confidenceCap, Math.round(parsed.confidence))
    ),
    dataQuality,
    reviewTriggers: normalizeSignalList(parsed.reviewTriggers),
    riskFlags: normalizeSignalList(parsed.riskFlags),
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

export async function generateWatchSignal(
  ctx: WatchSignalContext
): Promise<SignalResult> {
  const gap =
    ctx.currentPrice && ctx.targetPrice
      ? `${(((ctx.currentPrice - ctx.targetPrice) / ctx.targetPrice) * 100).toFixed(1)}%（プラスは目標より高い）`
      : "目標価格未設定";

  const newsLines =
    ctx.news.length > 0
      ? ctx.news
          .map(
            n =>
              `- [${n.sentiment ?? "未判定"} / 影響度${n.impactScore ?? "—"}] ${n.title}`
          )
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
    model: ANALYSIS_MODEL,
    messages: [
      { role: "system", content: WATCH_SYSTEM },
      { role: "user", content: prompt },
    ],
    responseFormat: SIGNAL_SCHEMA,
    maxTokens: 3072,
  });

  const text = res.choices?.[0]?.message?.content;
  const parsed = parseLlmJson<SignalResult>(text, "シグナルの応答");
  return {
    ...parsed,
    confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence))),
  };
}
