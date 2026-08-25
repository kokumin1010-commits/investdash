/**
 * 銘柄ごとに「今買い増してよいか」を AI が結論付ける。
 *
 * 相談 AI（consultAdvisor）との違いは、質問を待たない点。
 * 画面を見るのは月 1 回程度なので、開いた時点で結論が並んでいないと
 * 「どれを検討すべきか」を自分で探すことになる。
 *
 * 判断材料は既存の集計を使い回す（相談 AI と同じ文脈組み立てを流用）。
 * ここで独自に計算し直すと、画面の数字・相談の数字・提案の数字が
 * 三者で食い違い、どれが正しいのか分からなくなる。
 */
import { invokeLLM } from "../_core/llm";
import { computeAddSizing, MAX_POSITION_SHARE_PCT, type AddSizing } from "../../shared/addSizing";
import { buildContextText } from "./consultAdvisor";
import type { ConsultContext } from "./consultContext";

export const PROPOSAL_MODEL = "gemini-3-flash-preview";

export type ProposalStance = "BUY" | "WAIT" | "SKIP";

/**
 * 結論の文頭から記号を取り除く。
 *
 * AI は「BUY。取得単価を下げ〜」のように結論の記号を文頭に付けてくる。
 * 画面には既に「買う」というバッジを出しているため、そのまま出すと
 * 「買う BUY。取得単価を…」と同じことが二度書かれて読みにくい。
 * 判定は記号で持ち、文章は日本語だけにする。
 */
export function stripStancePrefix(text: string): string {
  return text.replace(/^\s*(BUY|WAIT|SKIP)\s*[。.:：、,]?\s*/i, "").trim();
}

export type AddProposalDraft = {
  stance: ProposalStance;
  conclusion: string;
  rationale: string;
  amountBase: number | null;
  limitPrice: number | null;
  invalidation: string | null;
};

const SYSTEM = `あなたは長期保有を前提とする個人投資家の投資判断を代行する分析者です。
1 銘柄について「今 買い増すべきか」を結論付けてください。

相談者の状況:
- 買った株は基本的に持ち続ける。頻繁な売買はしない。
- IBKR で日本円を借りて信用取引をしている。
- 画面を見るのは月に 1 回程度。実行するかどうかは本人が決める。

結論は次の 3 つから 1 つ選ぶ:
- BUY: 今この価格で買ってよい。金額と指値の目安を示す。
- WAIT: 銘柄自体は妥当だが、今の価格では待つべき。どの価格まで待つかを示す。
- SKIP: この銘柄は買い増しの対象から外すべき。構成比が大きすぎる、
  投資の前提が崩れている、業種が偏りすぎている等の理由を示す。

守ること:
- 与えられた数字だけを使う。株価・指標・業績を推測して書かない。
- 金額は渡された「1 回分の目安」と「上限までの余地」の範囲に収める。
  勝手に大きな額を出さない。買い増しの原資は現金性資産であり、
  借入をさらに増やす前提にはしない。
- 構成比が上限に達している銘柄は BUY にしない。
- 業種と市場の偏りに触れる。既に大きい業種への買い増しは慎重に判断する。
- 借入金利と現金利回りの関係に触れる。現金を株に替えると利息収入が減る。
- 投資カードのエグジット条件が渡されている場合はそれに照らす。
- 結論を覆す条件を 1 つ挙げる。
- 飾った表現を使わない。日本語で書く。
- 結論は 1 文（80 字以内）。根拠は 200 字程度。`;

/** AI に渡す銘柄ごとの材料 */
export type ProposalTarget = {
  symbol: string;
  name: string;
  currency: string;
  currentPrice: number | null;
  held: boolean;
  /** 買い増しプランの現在の判定 */
  bandLabel: string | null;
  /** 次の段までの変化率（%） */
  nextGapPct: number | null;
  nextActionLabel: string | null;
  /** 未保有銘柄の目標価格 */
  watchTargetPrice: number | null;
  /** 照合済みで懸念ありの件数 */
  concernCount: number;
};

/**
 * 提案に使う指示文を組み立てる。
 *
 * 金額は AI に自由に決めさせず、こちらで算定した範囲を渡す。
 * 資産全体からの配分は機械的に決まるもので、AI が判断すべきは
 * 「その額を今使うべきか」の方。両方を任せると、根拠のない
 * 「300 万円程度」のような数字が出る。
 */
export function buildProposalPrompt(
  target: ProposalTarget,
  sizing: AddSizing | null,
  ctx: ConsultContext
): string {
  const lines: string[] = [];

  lines.push(`## 判断する銘柄`);
  lines.push(`- ${target.name}（${target.symbol}）`);
  lines.push(`- 保有状況: ${target.held ? "保有している" : "まだ持っていない"}`);
  if (target.currentPrice !== null) {
    lines.push(`- 現在値: ${target.currentPrice} ${target.currency}`);
  }
  if (target.bandLabel) {
    lines.push(`- 買い増しプランの現在の判定: 「${target.bandLabel}」`);
  } else {
    lines.push(`- 買い増しプランの判定: 登録した価格帯の外にいる`);
  }
  if (target.nextGapPct !== null && target.nextActionLabel) {
    lines.push(
      `- 次の段まで ${target.nextGapPct.toFixed(1)}%（到達すると「${target.nextActionLabel}」）`
    );
  }
  if (!target.held && target.watchTargetPrice !== null) {
    lines.push(`- 自分で決めた目標買付価格: ${target.watchTargetPrice} ${target.currency}`);
  }
  if (target.concernCount > 0) {
    lines.push(
      `- 照合済みの確認項目のうち ${target.concernCount} 件が「懸念あり」と記録されている`
    );
  }

  lines.push("");
  lines.push("## この銘柄に使える金額（この範囲で判断する）");
  if (!sizing) {
    lines.push("- 算定できなかった。金額は示さず、判断だけを述べる。");
  } else {
    lines.push(
      `- 買い増しに回せる原資: ${Math.round(sizing.deployableBase).toLocaleString("ja-JP")} 円` +
        `（現金性資産と預り金の半分。借入は増やさない前提）`
    );
    lines.push(
      `- 1 回分の目安: ${Math.round(sizing.perStepBase).toLocaleString("ja-JP")} 円` +
        `（段階的に買うため原資を 4 回に分けた額）`
    );
    lines.push(`- この銘柄の現在の構成比: ${sizing.currentSharePct.toFixed(2)}%`);
    if (sizing.atCap) {
      lines.push(
        `- 構成比の上限 ${MAX_POSITION_SHARE_PCT}% に達している。買い増しは勧められない。`
      );
    } else {
      lines.push(
        `- 上限 ${MAX_POSITION_SHARE_PCT}% までに追加できる額: ` +
          `${Math.round(sizing.roomToCapBase).toLocaleString("ja-JP")} 円`
      );
      lines.push(
        `- 実際に提案してよい上限: ${Math.round(sizing.suggestedBase).toLocaleString("ja-JP")} 円`
      );
    }
  }

  lines.push("");
  lines.push(buildContextText(ctx));

  /*
   * 投資カードのエグジット条件は必ず渡す。過去に「何が崩れたら降りるか」を
   * 決めているなら、それに照らさない提案は当時の判断と矛盾する。
   */
  const card = ctx.focusCard;
  if (card && (card.coreThesis || card.exitConditions || card.risks)) {
    lines.push("");
    lines.push("## この銘柄について過去に記録した投資カード");
    if (card.coreThesis) lines.push(`- 保有理由: ${card.coreThesis}`);
    if (card.exitConditions) lines.push(`- 降りる条件: ${card.exitConditions}`);
    if (card.risks) lines.push(`- 想定リスク: ${card.risks}`);
  }

  if (ctx.focusNews.length > 0) {
    lines.push("");
    lines.push("## この銘柄の直近ニュース");
    for (const n of ctx.focusNews) {
      const impact = n.impactScore !== null ? `影響度 ${n.impactScore}` : "影響度未評価";
      lines.push(`- [${impact}] ${n.title}${n.summary ? ` — ${n.summary}` : ""}`);
    }
  } else {
    lines.push("");
    lines.push("## この銘柄の直近ニュース");
    lines.push("- ニュースは取得できていない。推測で補わないこと。");
  }

  return lines.join("\n");
}

/**
 * AI が返した金額を許容範囲に収める。
 *
 * プロンプトで範囲を指示しても外れることがある。範囲外の金額をそのまま
 * 保存すると、上限 5% を超える買い増しや原資を超える額が提案として残る。
 */
export function clampAmount(
  raw: number | null | undefined,
  sizing: AddSizing | null
): { amount: number | null; adjusted: boolean } {
  if (raw === null || raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return { amount: null, adjusted: false };
  }
  if (!sizing || sizing.suggestedBase <= 0) {
    /*
     * 原資が無い、または上限に達している場合に金額を残すと
     * 「買えないのに買え」という提案になる。
     */
    return { amount: null, adjusted: true };
  }
  if (raw > sizing.suggestedBase) {
    return { amount: Math.round(sizing.suggestedBase), adjusted: true };
  }
  return { amount: Math.round(raw), adjusted: false };
}

/**
 * 結論と金額の整合を取る。
 *
 * BUY なのに金額が無い、WAIT なのに金額があるという組み合わせは
 * 画面に出したときに何をすべきか分からなくなる。
 */
export function reconcileStance(
  stance: ProposalStance,
  amount: number | null,
  sizing: AddSizing | null
): { stance: ProposalStance; amount: number | null } {
  // 上限に達しているなら買えない。AI が BUY と言っても採らない
  if (sizing?.atCap && stance === "BUY") {
    return { stance: "SKIP", amount: null };
  }
  if (stance === "BUY" && amount === null) {
    // 買うべきだが金額が出せない = 実質「待つ」
    return { stance: "WAIT", amount: null };
  }
  if (stance !== "BUY") {
    // 買わないなら金額は持たせない
    return { stance, amount: null };
  }
  return { stance, amount };
}

const SCHEMA = {
  type: "object",
  properties: {
    stance: { type: "string", enum: ["BUY", "WAIT", "SKIP"] },
    conclusion: { type: "string" },
    rationale: { type: "string" },
    amountJpy: {
      type: ["number", "null"],
      description: "BUY の場合の金額（円）。WAIT / SKIP では null",
    },
    limitPrice: {
      type: ["number", "null"],
      description: "指値の目安（現地通貨）。BUY なら現在値付近、WAIT なら待つ価格",
    },
    invalidation: { type: ["string", "null"], description: "結論を覆す条件" },
  },
  // OpenAI strict mode requires every property to appear in `required`.
  // Optional business fields remain optional semantically by allowing null.
  required: [
    "stance",
    "conclusion",
    "rationale",
    "amountJpy",
    "limitPrice",
    "invalidation",
  ],
  additionalProperties: false,
} as const;

/** 1 銘柄の提案を作る */
export async function proposeForSymbol(params: {
  target: ProposalTarget;
  context: ConsultContext;
  /** 株式時価の合計（円）。構成比と金額の算定に使う */
  totalValueJpy: number;
  interestAssetsJpy: number;
  cashJpy: number;
  holdingValueJpy: number;
}): Promise<{ draft: AddProposalDraft; sizing: AddSizing | null; model: string }> {
  const { target, context, totalValueJpy, interestAssetsJpy, cashJpy, holdingValueJpy } = params;

  const sizing = computeAddSizing(totalValueJpy, interestAssetsJpy, cashJpy, holdingValueJpy);
  const prompt = buildProposalPrompt(target, sizing, context);

  const res = await invokeLLM({
    model: PROPOSAL_MODEL,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: prompt },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: { name: "add_proposal", schema: SCHEMA, strict: true },
    },
    maxTokens: 2048,
  });

  const raw = res.choices?.[0]?.message?.content;
  const text =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw
            .map(p => (p && "text" in p && typeof p.text === "string" ? p.text : ""))
            .join("")
        : "";
  if (!text.trim()) {
    throw new Error("AI から提案が得られませんでした。もう一度お試しください");
  }

  let parsed: {
    stance?: string;
    conclusion?: string;
    rationale?: string;
    amountJpy?: number | null;
    limitPrice?: number | null;
    invalidation?: string | null;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI の提案を解釈できませんでした。もう一度お試しください");
  }

  const stanceRaw =
    parsed.stance === "BUY" || parsed.stance === "WAIT" || parsed.stance === "SKIP"
      ? parsed.stance
      : "WAIT";
  const { amount } = clampAmount(parsed.amountJpy, sizing);
  const fixed = reconcileStance(stanceRaw, amount, sizing);

  const conclusion = (parsed.conclusion ?? "").trim();
  const rationale = (parsed.rationale ?? "").trim();
  if (!conclusion || !rationale) {
    throw new Error("AI の提案に結論または根拠が含まれていませんでした");
  }

  return {
    draft: {
      stance: fixed.stance,
      conclusion: stripStancePrefix(conclusion),
      rationale: stripStancePrefix(rationale),
      amountBase: fixed.amount,
      limitPrice:
        typeof parsed.limitPrice === "number" && Number.isFinite(parsed.limitPrice)
          ? parsed.limitPrice
          : null,
      invalidation: parsed.invalidation?.trim() || null,
    },
    sizing,
    model: PROPOSAL_MODEL,
  };
}
