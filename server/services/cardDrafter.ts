/**
 * 投資カード（保有理由・想定・撤退条件）を AI が下書きする。
 *
 * 【なぜ AI に書かせるか】
 * 画面と保存先は前からあったが 1 件も作られていなかった。112 銘柄を
 * 手で書くのは現実的でなく、購入判断はもともと AI に相談して決めている。
 * つまり「自分で書く欄」にしたことが使われなかった原因なので、
 * AI が下書きを作り、必要なら直すだけの形にする。
 *
 * 【何のためのカードか】
 * 株が下がったときに「当初の想定が崩れたのか、単に下がっただけか」を
 * 区別するための基準。基準がないと、下がった理由を後から都合よく
 * 解釈してしまう。だから撤退条件は必ず検証できる形で書かせる。
 */
import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";

export const CARD_MODEL = "gemini-3-flash-preview";

const SYSTEM = `あなたは長期保有を前提とする個人投資家の投資記録を下書きする担当です。
すでに保有している銘柄について「なぜ持っているとみなせるか」「何が崩れたら降りるか」を書きます。

守ること:
- 与えられた情報（事業内容・業績・配当・株価水準・ニュース）だけを根拠にする。
  知らない数値を作らない。
- 買え・売れの結論は書かない。判断の材料と基準を書く。
- 撤退条件は必ず「確認できる形」で書く。
  良い例: 営業利益率が2期連続で10%を下回る／配当が減配される／
          主要顧客との契約が終了する
  悪い例: 業績が悪化したら／将来性がなくなったら（確認できない）
- 断定できないことは「未確認」「要確認」と正直に書く。
- 日本語で書く。各項目は 200 文字以内に収める。`;

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "investment_card",
    strict: true,
    schema: {
      type: "object",
      properties: {
        buyReason: {
          type: "string",
          description:
            "この銘柄を持つ理由として説明できること。事業の強み・配当・株価水準のどれが軸かを明示する",
        },
        coreThesis: {
          type: "string",
          description: "投資の中心となる考え方。何が実現すれば報われるのかを 1 つに絞る",
        },
        valuationAssumption: {
          type: "string",
          description: "株価水準についての前提。取得単価と現在値、配当利回りに触れる",
        },
        exitConditions: {
          type: "string",
          description:
            "降りる基準。必ず確認できる形（数値・事実）で 2〜3 個。箇条書きにせず読める文で書く",
        },
        risks: {
          type: "string",
          description: "想定されるリスク。業種・事業構造に即した具体的なもの 2〜3 個",
        },
        horizon: {
          type: "string",
          description: "想定する保有期間（例: 5年以上、配当を受け取り続ける前提）。40 文字以内",
        },
        conviction: {
          type: "integer",
          description:
            "確信度 1〜5。5 は情報が揃い前提も明確、1 は情報が乏しく判断材料が足りない",
        },
      },
      required: [
        "buyReason",
        "coreThesis",
        "valuationAssumption",
        "exitConditions",
        "risks",
        "horizon",
        "conviction",
      ],
      additionalProperties: false,
    },
  },
};

export type CardDraftContext = {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  sector: string | null;
  industry: string | null;
  businessSummary: string | null;
  quantity: number;
  avgCost: number;
  currentPrice: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  dividendYieldPct: number | null;
  annualDividendLocal: number | null;
  pnlPct: number | null;
  /** 保有全体に対する比率。集中しているほど撤退条件が重要になる */
  weightPct: number | null;
  news: { title: string; summary: string | null; impactScore: number | null }[];
};

export type CardDraft = {
  buyReason: string;
  coreThesis: string;
  valuationAssumption: string;
  exitConditions: string;
  risks: string;
  horizon: string;
  conviction: number;
};

function fmt(v: number | null | undefined, unit = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "未取得";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`;
}

export function buildCardPrompt(ctx: CardDraftContext): string {
  const sections: string[] = [];

  sections.push(`## 銘柄\n${ctx.name}（${ctx.symbol}・${ctx.market}）`);

  const biz: string[] = ["## 事業"];
  biz.push(`- 業種: ${ctx.sector ?? "未取得"}${ctx.industry ? ` / ${ctx.industry}` : ""}`);
  if (ctx.businessSummary) {
    // 事業概要は長いので切る。判断に必要な範囲に絞る
    biz.push(`- 事業内容: ${ctx.businessSummary.slice(0, 900)}`);
  } else {
    biz.push("- 事業内容: 未取得");
  }
  sections.push(biz.join("\n"));

  const pos: string[] = ["## 保有の状況"];
  pos.push(`- 保有数: ${fmt(ctx.quantity)}`);
  pos.push(`- 取得単価: ${ctx.currency} ${fmt(ctx.avgCost)}`);
  pos.push(`- 現在値: ${ctx.currency} ${fmt(ctx.currentPrice)}`);
  if (ctx.pnlPct !== null) pos.push(`- 評価損益率: ${fmt(ctx.pnlPct, "%")}`);
  if (ctx.weightPct !== null) pos.push(`- 保有全体に対する比率: ${fmt(ctx.weightPct, "%")}`);
  pos.push(
    `- 52週高値/安値: ${fmt(ctx.fiftyTwoWeekHigh)} / ${fmt(ctx.fiftyTwoWeekLow)} ${ctx.currency}`
  );
  sections.push(pos.join("\n"));

  const div: string[] = ["## 配当"];
  if (ctx.dividendYieldPct !== null) {
    div.push(`- 配当利回り（現在値ベース）: ${fmt(ctx.dividendYieldPct, "%")}`);
  } else {
    div.push("- 配当: 無配または未取得");
  }
  if (ctx.annualDividendLocal !== null) {
    div.push(`- 年間配当（1株）: ${ctx.currency} ${fmt(ctx.annualDividendLocal)}`);
  }
  sections.push(div.join("\n"));

  if (ctx.news.length > 0) {
    const news = ctx.news
      .slice(0, 6)
      .map(
        n =>
          `- ${n.title}${n.impactScore !== null ? `（影響度 ${n.impactScore}）` : ""}${
            n.summary ? `\n  ${n.summary.slice(0, 200)}` : ""
          }`
      );
    sections.push(`## 最近のニュース\n${news.join("\n")}`);
  } else {
    /*
     * ニュースが無いことを明示する。書かないと AI が
     * 一般論で埋めてしまい、根拠のない記述が混ざる。
     */
    sections.push("## 最近のニュース\nニュースは取得できていません。推測で補わないこと。");
  }

  sections.push(
    [
      "## 指示",
      "上の情報だけを根拠に投資記録を下書きしてください。",
      "撤退条件は必ず確認できる形（数値・事実）で書いてください。",
      "情報が足りない項目は「未確認」と書いてよいです。推測で埋めないでください。",
    ].join("\n")
  );

  return sections.join("\n\n");
}

export async function draftCard(ctx: CardDraftContext): Promise<CardDraft> {
  const res = await invokeLLM({
    model: CARD_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildCardPrompt(ctx) },
    ],
    responseFormat: SCHEMA,
    maxTokens: 4096,
  });

  if (res.choices?.[0]?.finish_reason === "length") {
    throw new Error("投資カードの生成が途中で打ち切られました");
  }

  const draft = parseLlmJson<CardDraft>(res.choices?.[0]?.message?.content, "投資カードの応答");

  // 確信度が範囲外だと保存時に落ちるため丸める
  const conviction = Math.min(5, Math.max(1, Math.round(Number(draft.conviction) || 3)));
  return { ...draft, conviction };
}
