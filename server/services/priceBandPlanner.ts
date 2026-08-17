import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";
import { BAND_ACTIONS, type BandAction } from "../../shared/priceBands";

/**
 * 買い増しプラン（価格帯ごとの行動）の AI 提案。
 *
 * ユーザーは購入判断を AI に相談して決めている。その相談結果を外から貼り付けるのではなく、
 * システム内で生成する。生成した段組みは保存されるので、次に開いたときには
 * 判定済みの状態で見られる。
 *
 * 重要な設計判断:
 * - 数字だけを出させない。「なぜその価格なのか」を必ず付ける。根拠なしの数字は信用できない。
 * - 下落局面で確認すべき項目も業種に応じて AI に決めさせる。
 *   半導体なら受注動向、REIT なら金利と稼働率、銀行なら不良債権と、見るべき点は業種で違う。
 * - 買え・売れの断定はさせない。最終判断は本人がする。
 */

const PLANNER_MODEL = "gemini-3-flash-preview";

export type PlannerContext = {
  name: string;
  symbol: string;
  currency: string;
  sector: string | null;
  industry: string | null;
  /** 保有している場合の情報。未保有なら null */
  position: {
    quantity: number;
    avgCost: number;
    pnlPct: number | null;
    /** ポートフォリオ全体に対する構成比（%） */
    weightPct: number | null;
  } | null;
  currentPrice: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  return1m: number | null;
  return3m: number | null;
  /** 年間配当（1 株あたり・現地通貨）と利回り */
  annualDividend: number | null;
  dividendYieldPct: number | null;
  /** 投資カードの記録。書かれていれば本人の考えを優先する */
  card: {
    buyReason: string | null;
    coreThesis: string | null;
    valuationAssumption: string | null;
    fairValue: number | null;
    exitConditions: string | null;
    risks: string | null;
  } | null;
  /** 直近ニュース（AI 判定済み） */
  news: Array<{
    title: string;
    sentiment: string | null;
    impactScore: number | null;
    summary: string | null;
  }>;
};

export type PlannedBand = {
  lowerPrice: number | null;
  upperPrice: number | null;
  action: BandAction;
  actionLabel: string;
  reason: string;
  checkItems: string[];
};

export type PlanResult = {
  strategy: string;
  rationale: string;
  bands: PlannedBand[];
};

const PLANNER_SYSTEM = `あなたは長期保有を前提とする個人投資家の買い増し計画を設計するアナリストです。

この投資家の特徴:
- 株を買ったら長期で持ち続ける。短期の売買はしない
- 買うタイミングは「株価がこの水準まで下がったら、この規模で買う」という段組みで決めている
- 下落局面では、値段だけで飛びつかず「なぜ下がったのか」を確認してから判断したい

あなたの仕事は、対象銘柄について 3〜5 段の価格帯を設計することです。

## 各段の action の意味
- HOLD: 様子見。まだ買い増す水準ではない
- ADD_SMALL: 小幅に買い増す。打診買いの規模
- ADD_MAIN: 主力で買い増す。魅力的な水準
- VERIFY: 条件を確認してから判断。安いが、下落の理由を確かめないと買えない水準
- REDUCE: 減らす候補。過熱・構成比過大・ロジック崩壊のいずれかに該当する水準

## 設計の原則

1. **価格は現地通貨で、実際に注文できる水準で示す。** 円換算した数字を出してはならない。

2. **段は重ならず、かつ隙間なく連続するように高い順に設計する。**
   隣の段の境界は必ず接すること（例: 上の段が 285 以上なら、次の段の上限は 285 未満にする）。
   隙間があるとその価格になったときに何をすべきか分からなくなる。

3. **各段の reason には「なぜその価格なのか」を必ず書く。** 根拠として使えるもの:
   - 取得単価との関係（取得単価を下回る水準か）
   - 52週レンジ内の位置（安値圏か高値圏か）
   - 配当利回り（その価格なら利回りが何 % になるか）
   - 想定フェアバリューとの乖離
   - 過去の下落幅
   数字の根拠がない段を作ってはならない。

4. **最も安い段は VERIFY にする。** 大きく下がるときは何か理由があるため、
   値段だけで買い向かうのは危険。ただし機械的に付けるのではなく、
   その水準まで下がる状況として何が起こりうるかを踏まえて設計する。

5. **checkItems は業種に応じて具体的に決める。** 抽象的な「業績悪化」ではなく、
   その企業で実際に確認できる事象を挙げる。例:
   - 半導体: 大口顧客の離反、AI 向け受注の減速、在庫調整の長期化
   - REIT: 分配金の減額、稼働率の低下、金利上昇による借換コスト増
   - 銀行: 不良債権の増加、利ざやの縮小
   - 商社: 資源価格の下落、減損の発生
   VERIFY の段には必ず 2〜4 個入れる。HOLD の段には入れなくてよい。

6. **既に高値圏にある銘柄では、無理に買い増しの段を作らない。**
   現在値が明らかに高い場合、最上段を HOLD にして「この水準では買い増さない」と示す。
   現在値より上の価格に ADD の段を作ってはならない。

7. **投資カードに本人の考えが書かれている場合はそれを優先する。**
   エグジット条件が記録されていれば、それに触れる水準は REDUCE として扱う。

8. **断定的な売買推奨表現は使わない。** 「買うべき」ではなく「買い増しを検討する水準」
   という書き方にする。最終判断は投資家本人が行う。

## strategy と rationale
- strategy: この段組み全体の考え方を 2〜3 文の日本語で。
- rationale: 価格水準をどう決めたかの根拠を 2〜4 文の日本語で。使った基準（取得単価、
  52週レンジ、配当利回り、フェアバリューなど）を具体的な数字とともに示す。

actionLabel は投資家がひと目で行動が分かる短い日本語（20 文字程度）にする。`;

const PLANNER_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "price_band_plan",
    strict: true,
    schema: {
      type: "object",
      properties: {
        strategy: { type: "string" },
        rationale: { type: "string" },
        bands: {
          type: "array",
          items: {
            type: "object",
            properties: {
              lowerPrice: {
                type: ["number", "null"],
                description: "帯の下限。下限なし（〜以下）の場合は null",
              },
              upperPrice: {
                type: ["number", "null"],
                description: "帯の上限。上限なし（〜以上）の場合は null",
              },
              action: { type: "string", enum: [...BAND_ACTIONS] },
              actionLabel: { type: "string" },
              reason: { type: "string" },
              checkItems: {
                type: "array",
                items: { type: "string" },
                description: "その帯に入ったときに確認すべき事象。不要なら空配列",
              },
            },
            required: ["lowerPrice", "upperPrice", "action", "actionLabel", "reason", "checkItems"],
            additionalProperties: false,
          },
        },
      },
      required: ["strategy", "rationale", "bands"],
      additionalProperties: false,
    },
  },
};

function fmt(v: number | null | undefined, unit = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "データ未取得";
  return `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}${unit}`;
}

export function buildPlannerPrompt(ctx: PlannerContext): string {
  const cur = ` ${ctx.currency}`;

  const positionBlock = ctx.position
    ? [
        `- 保有株数: ${fmt(ctx.position.quantity)} 株`,
        `- 取得単価: ${fmt(ctx.position.avgCost, cur)}`,
        `- 損益率: ${ctx.position.pnlPct === null ? "データ未取得" : `${ctx.position.pnlPct.toFixed(2)}%`}`,
        `- ポートフォリオ構成比: ${
          ctx.position.weightPct === null ? "データ未取得" : `${ctx.position.weightPct.toFixed(1)}%`
        }`,
      ].join("\n")
    : "この銘柄は未保有です（新規購入の計画を立ててください）。";

  const rangePos =
    ctx.currentPrice && ctx.fiftyTwoWeekHigh && ctx.fiftyTwoWeekLow
      ? `${(
          ((ctx.currentPrice - ctx.fiftyTwoWeekLow) /
            (ctx.fiftyTwoWeekHigh - ctx.fiftyTwoWeekLow)) *
          100
        ).toFixed(0)}%（0%が52週安値、100%が52週高値）`
      : "データ未取得";

  const cardLines = ctx.card
    ? [
        `- 買付理由: ${ctx.card.buyReason || "未記入"}`,
        `- コア投資ロジック: ${ctx.card.coreThesis || "未記入"}`,
        `- バリュエーション前提: ${ctx.card.valuationAssumption || "未記入"}`,
        `- 想定フェアバリュー: ${fmt(ctx.card.fairValue, cur)}`,
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

  /*
   * 配当利回りは価格水準の根拠として使いやすい。
   * 「この価格なら利回り 4% になる」という形で段の妥当性を示せる。
   */
  const dividendBlock =
    ctx.annualDividend !== null
      ? `- 1株あたり年間配当: ${fmt(ctx.annualDividend, cur)}\n- 現在値での配当利回り: ${
          ctx.dividendYieldPct === null ? "データ未取得" : `${ctx.dividendYieldPct.toFixed(2)}%`
        }`
      : "- 配当: なし、または未取得";

  return `## 銘柄
${ctx.name}（${ctx.symbol}）／セクター: ${ctx.sector ?? "未取得"}／業種: ${ctx.industry ?? "未取得"}
／価格の通貨: ${ctx.currency}

## ポジション
${positionBlock}

## 価格
- 現在値: ${fmt(ctx.currentPrice, cur)}
- 52週高値: ${fmt(ctx.fiftyTwoWeekHigh, cur)}／52週安値: ${fmt(ctx.fiftyTwoWeekLow, cur)}
- 52週レンジ内の位置: ${rangePos}
- 直近1か月騰落率: ${ctx.return1m === null ? "データ未取得" : `${ctx.return1m.toFixed(2)}%`}
- 直近3か月騰落率: ${ctx.return3m === null ? "データ未取得" : `${ctx.return3m.toFixed(2)}%`}

## 配当
${dividendBlock}

## 投資カードの記録
${cardLines}

## 直近ニュース（AI 判定済み）
${newsLines}

以上の材料に基づいて、この銘柄の買い増し価格帯を 3〜5 段で設計してください。
価格はすべて ${ctx.currency} で示してください。`;
}

/**
 * 段が重なっていないか、順序が正しいかを検証して整える。
 *
 * 隙間も埋める。AI はきれいな数字（250, 285, 310）を選ぶため、
 * プロンプトで指示しても隙間が残ることがある。
 * 実測で ALAB は「350 以上 / 285〜310 / 210〜250 / 190 以下」を返し、
 * 現在値 321.61 がどの段にも入らず「判定できません」になった。
 * 隙間が残ると、株価がそこに来たときに何をすべきか分からなくなる。
 */
export function normalizeBands(bands: PlannedBand[]): PlannedBand[] {
  // 高い順に並べる（上限が大きい順）
  const sorted = [...bands].sort((a, b) => {
    const au = a.upperPrice ?? Number.POSITIVE_INFINITY;
    const bu = b.upperPrice ?? Number.POSITIVE_INFINITY;
    if (au !== bu) return bu - au;
    return (b.lowerPrice ?? Number.NEGATIVE_INFINITY) - (a.lowerPrice ?? Number.NEGATIVE_INFINITY);
  });

  const result: PlannedBand[] = [];
  for (const band of sorted) {
    // 下限が上限を超えている（AI の書き間違い）場合は入れ替える
    let { lowerPrice, upperPrice } = band;
    if (lowerPrice !== null && upperPrice !== null && lowerPrice > upperPrice) {
      [lowerPrice, upperPrice] = [upperPrice, lowerPrice];
    }

    /*
     * 直前の段と重なっている場合は、下側の段の上限を切り下げて重なりを解消する。
     * 重なったままだと「同じ株価で 2 つの行動が出る」ことになり判断できない。
     */
    const prev = result[result.length - 1];
    if (prev && prev.lowerPrice !== null && upperPrice !== null && upperPrice >= prev.lowerPrice) {
      upperPrice = prev.lowerPrice - 0.01;
      // 切り下げた結果、下限を割ってしまう段は捨てる
      if (lowerPrice !== null && upperPrice <= lowerPrice) continue;
    }

    result.push({ ...band, lowerPrice, upperPrice });
  }

  /*
   * 隙間を埋める。上の段の下限と下の段の上限が離れている場合、
   * 下の段の上限を上の段の下限の直下まで引き上げる。
   *
   * 上に引き上げるのは、下の段（より安い＝より積極的に買う段）の範囲を
   * 広げる方向なので安全側。逆に上の段の下限を下げると
   * 「静観」の範囲が広がって買い場を逃すことになる。
   */
  for (let i = 1; i < result.length; i++) {
    const upper = result[i - 1];
    const lower = result[i];
    if (upper.lowerPrice === null || lower.upperPrice === null) continue;
    const gap = upper.lowerPrice - lower.upperPrice;
    // 0.01 は「接している」状態。それより離れていれば隙間
    if (gap > 0.011) {
      lower.upperPrice = round2(upper.lowerPrice - 0.01);
    }
  }

  return result;
}

/** 価格は小数第 2 位まで（0.01 刻みで境界を作るため） */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function generatePriceBandPlan(ctx: PlannerContext): Promise<PlanResult> {
  const res = await invokeLLM({
    model: PLANNER_MODEL,
    messages: [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: buildPlannerPrompt(ctx) },
    ],
    responseFormat: PLANNER_SCHEMA,
    /*
     * 5 段 × 根拠 + 確認項目 4 件の日本語で 3,000 トークンを超えることがある。
     * 4096 では中国平安（2318.HK）で途中で切れ、JSON が壊れて生成に失敗した。
     * 余裕を持たせる。
     */
    maxTokens: 8192,
  });

  /*
   * 途中で切れた応答は JSON として壊れている。パースエラーだけを見せると
   * 「AI の応答を解析できませんでした」となり原因が分からないため先に判定する。
   */
  if (res.choices?.[0]?.finish_reason === "length") {
    throw new Error(
      "買い増しプランの生成が途中で打ち切られました。もう一度お試しください。"
    );
  }

  const text = res.choices?.[0]?.message?.content;
  const parsed = parseLlmJson<PlanResult>(text, "買い増しプランの応答");

  const bands = normalizeBands(
    (parsed.bands ?? []).map(b => ({
      lowerPrice: typeof b.lowerPrice === "number" ? b.lowerPrice : null,
      upperPrice: typeof b.upperPrice === "number" ? b.upperPrice : null,
      action: BAND_ACTIONS.includes(b.action) ? b.action : "HOLD",
      actionLabel: (b.actionLabel ?? "").slice(0, 160),
      reason: b.reason ?? "",
      checkItems: Array.isArray(b.checkItems) ? b.checkItems.filter(s => typeof s === "string") : [],
    }))
  );

  if (bands.length === 0) {
    throw new Error("価格帯が生成されませんでした");
  }

  return { strategy: parsed.strategy ?? "", rationale: parsed.rationale ?? "", bands };
}

export const PRICE_BAND_MODEL = PLANNER_MODEL;
