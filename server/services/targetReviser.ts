/**
 * 「買いたい値段」を AI に作り直させる。
 *
 * 【なぜ必要か】
 * ウォッチリストの目的は買い場を逃さないことだが、目標価格が現在値から
 * 極端に離れていると目的が達成できない。実測では INPEX の目標が
 * 1,900 円に対し現在値 3,765 円（-49.5%）で、半値になるのを待つのは
 * 実質「買わない」と同じ。この状態は待っているように見えるので、
 * 気付かないまま何年も置かれる。
 *
 * 【なぜ機械的に補正しないか】
 * 「現在値の 8% 下」のような機械的な値でも警告は消えるが、その数字に
 * 根拠がない。買いたい値段は 52週レンジのどこにいるか、配当利回りが
 * どこで許容水準に届くか、直近の下落がどこで底を打ったかで決まる。
 * だから根拠と一緒に出させ、根拠を買付条件に残す。
 */
import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";

export const TARGET_REVISE_MODEL = "gemini-3-flash-preview";

const SYSTEM = `あなたは長期保有を前提とする個人投資家の「買いたい値段」を設計する担当です。

守ること:
- 与えられた数字（現在値・52週レンジ・直近の値動き・配当・ニュース）だけを根拠にする。
  知らない数値を作らない。目標株価やアナリスト予想を推測で書かない。
- 買いたい値段は「現実的に届く水準」にする。現在値から 25% 以上安い値は避ける。
  半値になるまで待つ設定は、実質的に「買わない」ことと同じで役に立たない。
- ただし現在値以上にはしない。下がるのを待つ意味がなくなる。
- 根拠は必ず数字で示す（52週安値 ○○ に対し ○% 上、配当利回りが ○% に届く水準 など）。
- 段階的に買う前提で、まず打診買いを始める水準を答える。
- 日本語で書く。`;

const SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "revised_target",
    strict: true,
    schema: {
      type: "object",
      properties: {
        targetPrice: {
          type: "number",
          description:
            "買いたい値段（現地通貨）。現在値より安く、かつ現在値から 25% 以上は離さない",
        },
        basis: {
          type: "string",
          description:
            "その値段にした根拠。52週レンジ・配当利回り・直近の値動きのどれを使ったか数字で示す。160 文字以内",
        },
        buyConditions: {
          type: "string",
          description:
            "その値段に来たときに確認すべきこと。確認できる形（数値・事実）で 2 つ。160 文字以内",
        },
        note: {
          type: "string",
          description:
            "以前の目標価格との違いと、なぜ変えたのか。120 文字以内。以前の目標がない場合は空文字",
        },
      },
      required: ["targetPrice", "basis", "buyConditions", "note"],
      additionalProperties: false,
    },
  },
};

export type TargetReviseContext = {
  symbol: string;
  name: string;
  currency: string;
  sector: string | null;
  industry: string | null;
  currentPrice: number;
  /** 以前の目標価格。null なら未設定 */
  previousTarget: number | null;
  /** 6か月の値動きから求めた高値・安値 */
  rangeHigh: number | null;
  rangeLow: number | null;
  return1mPct: number | null;
  return3mPct: number | null;
  /** 1株あたりの年間配当（現地通貨）。無配・未取得なら null */
  annualDividend: number | null;
  watchReason: string | null;
  news: { title: string; summary: string | null; impactScore: number | null }[];
};

export type RevisedTarget = {
  targetPrice: number;
  basis: string;
  buyConditions: string;
  note: string;
};

function fmt(v: number | null | undefined, unit = ""): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "未取得";
  return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`;
}

export function buildTargetRevisePrompt(ctx: TargetReviseContext): string {
  const s: string[] = [];
  s.push(`## 銘柄\n${ctx.name}（${ctx.symbol}）`);
  s.push(
    [
      "## 株価",
      `- 現在値: ${ctx.currency} ${fmt(ctx.currentPrice)}`,
      `- 直近6か月の高値/安値: ${fmt(ctx.rangeHigh)} / ${fmt(ctx.rangeLow)} ${ctx.currency}`,
      `- 1か月の騰落: ${fmt(ctx.return1mPct, "%")}`,
      `- 3か月の騰落: ${fmt(ctx.return3mPct, "%")}`,
    ].join("\n")
  );

  /*
   * 配当は「利回りが何 % になる株価か」を計算させるために渡す。
   * 利回りを基準にすると、株価の絶対値ではなく受け取れる金額から
   * 買いたい値段を決められる。
   */
  if (ctx.annualDividend !== null && ctx.annualDividend > 0) {
    const yieldNow = (ctx.annualDividend / ctx.currentPrice) * 100;
    s.push(
      [
        "## 配当",
        `- 1株あたり年間配当: ${ctx.currency} ${fmt(ctx.annualDividend)}`,
        `- 現在値での利回り: ${fmt(yieldNow, "%")}`,
      ].join("\n")
    );
  } else {
    s.push("## 配当\n- 無配または未取得。利回りを根拠にしないこと。");
  }

  const prev: string[] = ["## 以前の設定"];
  if (ctx.previousTarget !== null) {
    const gap = ((ctx.previousTarget - ctx.currentPrice) / ctx.currentPrice) * 100;
    prev.push(
      // 乖離率は小数 1 桁に揃える。桁が多いと精度が高いように見えて誤解を招く
      `- 以前の買いたい値段: ${ctx.currency} ${fmt(ctx.previousTarget)}（現在値から ${gap.toFixed(1)}%）`
    );
    prev.push(
      "- この水準は現在値から離れすぎており、待っていても買えない可能性が高いと判断されました。"
    );
  } else {
    prev.push("- 買いたい値段は未設定です。");
  }
  if (ctx.watchReason) prev.push(`- 注目理由: ${ctx.watchReason.slice(0, 400)}`);
  s.push(prev.join("\n"));

  if (ctx.news.length > 0) {
    s.push(
      `## 最近のニュース\n${ctx.news
        .slice(0, 5)
        .map(
          n =>
            `- ${n.title}${n.impactScore !== null ? `（影響度 ${n.impactScore}）` : ""}${
              n.summary ? `\n  ${n.summary.slice(0, 160)}` : ""
            }`
        )
        .join("\n")}`
    );
  } else {
    // ニュースが無いことを明示する。書かないと AI が一般論で埋める
    s.push("## 最近のニュース\nニュースは取得できていません。推測で補わないこと。");
  }

  s.push(
    [
      "## 指示",
      "上の情報だけを根拠に、現実的に届く「買いたい値段」を 1 つ決めてください。",
      `現在値（${fmt(ctx.currentPrice)}）より安く、現在値から 25% 以上は離さないでください。`,
      "根拠は必ず数字で示してください。推測の目標株価は使わないでください。",
    ].join("\n")
  );

  return s.join("\n\n");
}

/**
 * AI の返した値段を許容範囲に収める。
 *
 * プロンプトで範囲を指示しても外れることがある。範囲外の値をそのまま
 * 保存すると、作り直したのに警告が消えない（あるいは現在値以上になって
 * 待つ意味がない）状態になる。丸めた場合は必ずその旨を残す。
 * 黙って書き換えると、画面の数字と AI の根拠が食い違って信用できなくなる。
 */
export function clampRevisedTarget(
  raw: number,
  currentPrice: number
): { targetPrice: number; adjustedNote: string | null } {
  const round2 = (v: number) => Math.round(v * 100) / 100;
  if (!Number.isFinite(raw) || raw <= 0) {
    return {
      targetPrice: round2(currentPrice * 0.92),
      adjustedNote: "AI が有効な値段を返さなかったため、現在値の 8% 下を暫定値にしました。",
    };
  }
  // 現在値の 98% を上限にする。ほぼ現在値だと「待つ」設定として機能しない
  const upper = currentPrice * 0.98;
  if (raw > upper) {
    return {
      targetPrice: round2(upper),
      adjustedNote: `AI の提示額（${round2(raw)}）が現在値に近すぎたため、現在値の 2% 下に寄せました。`,
    };
  }
  // 下限は現在値の 75%。これより低いと「遠すぎる」状態に戻ってしまう
  const lower = currentPrice * 0.75;
  if (raw < lower) {
    return {
      targetPrice: round2(lower),
      adjustedNote: `AI の提示額（${round2(raw)}）は現在値から離れすぎていたため、現在値の 25% 下に寄せました。`,
    };
  }
  return { targetPrice: round2(raw), adjustedNote: null };
}

export async function reviseTarget(ctx: TargetReviseContext): Promise<
  RevisedTarget & { adjustedNote: string | null }
> {
  const res = await invokeLLM({
    model: TARGET_REVISE_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: buildTargetRevisePrompt(ctx) },
    ],
    responseFormat: SCHEMA,
    maxTokens: 2048,
  });
  if (res.choices?.[0]?.finish_reason === "length") {
    throw new Error("買いたい値段の生成が途中で打ち切られました");
  }
  const out = parseLlmJson<RevisedTarget>(
    res.choices?.[0]?.message?.content,
    "買いたい値段の応答"
  );
  const { targetPrice, adjustedNote } = clampRevisedTarget(
    Number(out.targetPrice),
    ctx.currentPrice
  );
  return {
    targetPrice,
    basis: String(out.basis ?? "").trim(),
    buyConditions: String(out.buyConditions ?? "").trim(),
    note: String(out.note ?? "").trim(),
    adjustedNote,
  };
}
