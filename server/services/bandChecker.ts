import { invokeLLM } from "../_core/llm";
import { parseLlmJson } from "./jsonExtract";

/**
 * 価格帯に入ったときの「確認すること」をニュースで照合する。
 *
 * なぜ必要か:
 * 株価が大きく下がった局面では、同じ株価でも判断が真逆になる。
 * ファンダメンタルズが健全なまま下がったなら買い場だが、大口顧客を失って下がったなら
 * 買ってはいけない。価格だけで判断すると、この一番危険な場面で間違える。
 *
 * 設計上の判断:
 * - 買え・売れの結論は出させない。確認項目ごとに「該当する情報があったか」までを答えさせ、
 *   最後の判断は本人がする。AI の判断で損をすると納得できないが、材料が揃った上での
 *   自分の判断なら納得できる。
 * - 材料が見つからない場合を CLEAR（問題なし）と混同しない。
 *   ニュースを取得できていないだけの状態を「懸念なし」と誤認すると危険なため UNKNOWN で返す。
 */

const CHECKER_MODEL = "gemini-3-flash-preview";

export type CheckStatus = "CLEAR" | "CONCERN" | "UNKNOWN";

export type CheckerNews = {
  title: string;
  summary: string | null;
  sentiment: string | null;
  impactScore: number | null;
  publishedAt: Date | null;
  source: string | null;
};

export type CheckerContext = {
  name: string;
  symbol: string;
  /** この帯に入ったときの行動（何のために確認するのかを AI に伝える） */
  actionLabel: string;
  /** 確認すべき項目。プラン生成時に AI が業種から決めたもの */
  checkItems: string[];
  news: CheckerNews[];
};

export type CheckOutcome = {
  checkItem: string;
  status: CheckStatus;
  /** 見つかった内容。見つからなければその旨を書く */
  finding: string;
  /** 根拠にしたニュース件数 */
  sourceCount: number;
};

const CHECKER_SYSTEM = `あなたは投資判断の材料を整理する分析アシスタントです。

役割は「確認すべき項目それぞれについて、手元のニュースに該当する情報があるかを答える」ことです。

厳守すること:
- 買うべき・売るべきといった結論は書かない。判断は利用者本人が行う。
- ニュースに書かれていないことを推測で補わない。
- 該当する情報が見つからない場合は、懸念がないと断定せず「確認できなかった」と書く。
  ニュースを十分に取得できていないだけの可能性があるため。
- 日本語で簡潔に書く。1 項目あたり 2〜3 文。

status の使い分け:
- CONCERN: その懸念を裏付ける、または示唆する情報がニュースにある
- CLEAR: その懸念を否定する情報がニュースにある（好調・拡大・受注増など明確な反証）
- UNKNOWN: 判断できる情報がニュースにない`;

const CHECKER_SCHEMA = {
  type: "json_schema" as const,
  json_schema: {
    name: "band_check_result",
    strict: true,
    schema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              checkItem: { type: "string", description: "確認項目（渡された文言をそのまま返す）" },
              status: { type: "string", enum: ["CLEAR", "CONCERN", "UNKNOWN"] },
              finding: { type: "string", description: "見つかった内容。なければ確認できなかった旨" },
              sourceCount: { type: "number", description: "根拠にしたニュース件数" },
            },
            required: ["checkItem", "status", "finding", "sourceCount"],
            additionalProperties: false,
          },
        },
      },
      required: ["results"],
      additionalProperties: false,
    },
  },
};

export function buildCheckerPrompt(ctx: CheckerContext): string {
  const lines: string[] = [];
  lines.push(`銘柄: ${ctx.name}（${ctx.symbol}）`);
  lines.push(`この価格帯での想定行動: ${ctx.actionLabel}`);
  lines.push("");
  lines.push("【確認すべき項目】");
  ctx.checkItems.forEach((item, i) => {
    lines.push(`${i + 1}. ${item}`);
  });
  lines.push("");

  if (ctx.news.length === 0) {
    lines.push("【ニュース】");
    lines.push("取得済みのニュースがありません。");
    lines.push("この場合、すべての項目を UNKNOWN とし、ニュースが未取得であることを書いてください。");
  } else {
    lines.push(`【ニュース ${ctx.news.length} 件】`);
    ctx.news.forEach((n, i) => {
      const date = n.publishedAt ? n.publishedAt.toISOString().slice(0, 10) : "日付不明";
      const meta = [
        n.source ?? null,
        n.sentiment ?? null,
        n.impactScore !== null ? `影響度 ${n.impactScore}` : null,
      ]
        .filter(Boolean)
        .join(" / ");
      lines.push(`${i + 1}. [${date}] ${n.title}${meta ? `（${meta}）` : ""}`);
      if (n.summary) lines.push(`   ${n.summary}`);
    });
  }

  lines.push("");
  lines.push(
    "上の各項目について、ニュースに該当する情報があるかを判定してください。checkItem は渡された文言をそのまま返してください。"
  );
  return lines.join("\n");
}

/**
 * 確認項目とニュースを照合する。
 *
 * ニュースが 0 件の場合も AI を呼ばずに UNKNOWN を返す。
 * 材料がないのに AI を呼ぶのは無駄な費用になるため。
 */
/**
 * 項目名の突き合わせ用に文字列をそろえる。
 *
 * AI は項目名をそのまま返すよう指示しても、番号を付けたり括弧で囲んだり
 * 空白の種類を変えたりする。素の比較だけに頼ると突き合わせが全部外れ、
 * 「判定が得られませんでした」ばかりになる（実際にそうなった）。
 */
function normalizeItem(s: string): string {
  return s
    .replace(/\r?\n/g, " ")
    // 先頭の番号・箇条書き記号（1. / 1) / ・ / - / * など）
    .replace(/^[\s]*(?:\d+\s*[.)、．]|[・\-*])\s*/, "")
    // 引用符・括弧類
    .replace(/[「」『』"'“”‘’（）()【】\[\]]/g, "")
    // 全角スペースを半角に寄せ、連続空白をまとめる
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    // 末尾の句読点
    .replace(/[。．.、,？?！!]+$/, "")
    .trim()
    .toLowerCase();
}

/** 2 つの文字列がどれだけ同じ語を共有しているか（0〜1）。表記のゆれを吸収する最後の手段 */
function overlapRatio(a: string, b: string): number {
  const grams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let shared = 0;
  ga.forEach(g => {
    if (gb.has(g)) shared++;
  });
  return shared / Math.min(ga.size, gb.size);
}

export async function runBandChecks(ctx: CheckerContext): Promise<CheckOutcome[]> {
  if (ctx.checkItems.length === 0) return [];

  if (ctx.news.length === 0) {
    return ctx.checkItems.map(item => ({
      checkItem: item,
      status: "UNKNOWN" as const,
      finding:
        "この銘柄のニュースが未取得のため確認できません。先にニュースを取得してから再度確認してください。",
      sourceCount: 0,
    }));
  }

  const res = await invokeLLM({
    model: CHECKER_MODEL,
    messages: [
      { role: "system", content: CHECKER_SYSTEM },
      { role: "user", content: buildCheckerPrompt(ctx) },
    ],
    responseFormat: CHECKER_SCHEMA,
    /*
     * 4 項目 × 3 文の日本語で 1,500 トークン前後になる。2048 だと途中で切れて
     * JSON が壊れ「解析できませんでした」になった（実測）。余裕を持たせる。
     */
    maxTokens: 6144,
  });

  /*
   * 途中で切れた応答は JSON として壊れている。パースエラーの文言だけでは
   * 原因が分からず調査に時間がかかるため、先に切れたことを伝える。
   */
  const finish = res.choices?.[0]?.finish_reason;
  if (finish === "length") {
    throw new Error(
      "確認項目の照合が途中で打ち切られました。確認項目を減らすか、もう一度お試しください。"
    );
  }

  const text = res.choices?.[0]?.message?.content;
  const parsed = parseLlmJson<{ results: CheckOutcome[] }>(text, "確認項目の照合結果");
  const rows = Array.isArray(parsed.results) ? parsed.results : [];

  return matchCheckOutcomes(ctx.checkItems, rows, ctx.news.length);
}

/**
 * AI が返した結果を、こちらが渡した確認項目に突き合わせる。
 *
 * 突き合わせは 3 段。
 * 1. 正規化した完全一致
 * 2. どちらかがもう一方を含む（AI が項目を要約して返した場合）
 * 3. 2 文字単位の重なり率が高いもの（表記のゆれ）
 *
 * 実測で gemini は項目名に番号を付けて返す（"1. 生成AI機能「Firefly」の…"）。
 * 素の一致比較だけだと 4 項目すべてが突き合わせできず、確認したのに
 * 「判定が得られませんでした」しか出ない状態になった。
 *
 * 見つからなかった項目は UNKNOWN で埋める。項目が消えたまま表示されると、
 * 確認したつもりで見落とすという最悪の結果につながるため。
 */
export function matchCheckOutcomes(
  checkItems: string[],
  rows: CheckOutcome[],
  newsCount: number
): CheckOutcome[] {
  const used = new Set<number>();
  const pick = (item: string): CheckOutcome | null => {
    const target = normalizeItem(item);
    const candidates = rows
      .map((r, i) => ({ r, i, key: normalizeItem(String(r.checkItem ?? "")) }))
      .filter(c => !used.has(c.i) && c.key.length > 0);

    const exact = candidates.find(c => c.key === target);
    if (exact) {
      used.add(exact.i);
      return exact.r;
    }
    const contains = candidates.find(c => target.includes(c.key) || c.key.includes(target));
    if (contains) {
      used.add(contains.i);
      return contains.r;
    }
    let best: { c: (typeof candidates)[number]; score: number } | null = null;
    for (const c of candidates) {
      const score = overlapRatio(target, c.key);
      if (!best || score > best.score) best = { c, score };
    }
    if (best && best.score >= 0.5) {
      used.add(best.c.i);
      return best.c.r;
    }
    return null;
  };

  return checkItems.map(item => {
    const hit = pick(item);
    if (!hit) {
      return {
        checkItem: item,
        status: "UNKNOWN" as const,
        finding: "この項目についての判定が得られませんでした。もう一度確認してください。",
        sourceCount: 0,
      };
    }
    const status: CheckStatus =
      hit.status === "CLEAR" || hit.status === "CONCERN" || hit.status === "UNKNOWN"
        ? hit.status
        : "UNKNOWN";
    return {
      checkItem: item,
      status,
      finding: (hit.finding ?? "").slice(0, 800),
      sourceCount:
        typeof hit.sourceCount === "number" && hit.sourceCount >= 0
          ? Math.min(hit.sourceCount, newsCount)
          : 0,
    };
  });
}

export const BAND_CHECKER_MODEL = CHECKER_MODEL;
