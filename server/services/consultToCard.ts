/**
 * 相談の回答から投資カードの項目を抜き出す。
 *
 * 相談では「何が崩れたら降りるか」「何を確認すべきか」という話が出るが、
 * 相談画面の中に埋もれると次に株価が動いたときに参照されない。
 * 投資カードに書き戻せば、AI シグナルもその条件を判断材料に使う。
 *
 * 回答をそのまま貼り付けるのではなく AI に整理させる。相談の回答は
 * 前置きや他銘柄との比較を含み、カードの項目としてはそのまま使えない。
 */
import { invokeLLM } from "../_core/llm";
import { logAiRun } from "./aiRunLog";

/** 抽出した内容。該当する話が出ていない項目は null を返す。 */
export type ExtractedCardFields = {
  exitConditions: string | null;
  risks: string | null;
  coreThesis: string | null;
  valuationAssumption: string | null;
  /** 抽出できなかった場合の理由（画面に出して原因が分かるようにする） */
  note: string | null;
};

const MODEL = "gemini-3-flash-preview";

const SCHEMA = {
  type: "object",
  properties: {
    exitConditions: {
      type: ["string", "null"],
      description: "どうなったら売る／降りるか。相談で出ていなければ null",
    },
    risks: {
      type: ["string", "null"],
      description: "想定されるリスク・確認すべき点。出ていなければ null",
    },
    coreThesis: {
      type: ["string", "null"],
      description: "この投資が成立する前提。出ていなければ null",
    },
    valuationAssumption: {
      type: ["string", "null"],
      description: "価格・利回りの前提。出ていなければ null",
    },
    note: {
      type: ["string", "null"],
      description: "抽出できなかった場合の理由",
    },
  },
  required: ["exitConditions", "risks", "coreThesis", "valuationAssumption", "note"],
  additionalProperties: false,
} as const;

const SYSTEM = `あなたは投資家の相談記録を整理する担当者です。
相談のやり取りから、投資カードに残すべき内容だけを抜き出します。

守ること:
- 相談の中で実際に述べられた内容だけを使う。推測で補わない
- 数値は相談に出てきたものをそのまま使う。丸めたり作ったりしない
- 該当する話が出ていない項目は null にする。無理に埋めない
- エグジット条件は「何がどうなったら」が検証できる形で書く
  （悪い例: 業績が悪化したら / 良い例: 四半期営業利益が2期連続で前年割れ）
- 他の銘柄についての話は含めない。対象の銘柄の話だけを拾う
- 1 項目 300 字以内。長い前置きは削る
- 日本語で書く`;

export async function extractCardFields(params: {
  userId: number;
  symbol: string;
  name: string;
  /** 相談のやり取り（古い順） */
  turns: { role: string; content: string }[];
}): Promise<ExtractedCardFields> {
  const { userId, symbol, name, turns } = params;

  const transcript = turns
    .map(t => `${t.role === "USER" ? "【質問】" : "【回答】"}\n${t.content}`)
    .join("\n\n");

  const prompt = `対象銘柄: ${name}（${symbol}）

以下は この銘柄についての相談のやり取りです。

${transcript}

このやり取りから、投資カードに残すべき内容を抜き出してください。`;

  const started = Date.now();
  try {
    const res = await invokeLLM({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      max_tokens: 4096,
      response_format: {
        type: "json_schema",
        json_schema: { name: "card_fields", schema: SCHEMA, strict: true },
      },
    });

    const choice = res.choices?.[0];
    const content = choice?.message?.content;
    const raw = typeof content === "string" ? content : "";

    /*
     * 途中で切れた場合は JSON が壊れる。理由が分かる文言を返さないと
     * 「抽出できません」だけが出て原因が追えない。
     */
    if (choice?.finish_reason === "length") {
      throw new Error("AI の応答が途中で打ち切られました。相談が長すぎる可能性があります");
    }

    const parsed = JSON.parse(raw) as ExtractedCardFields;

    await logAiRun({
      userId,
      kind: "card_draft",
      symbol,
      model: MODEL,
      status: "SUCCESS",
      durationMs: Date.now() - started,
      detail: "相談から投資カードの項目を抽出",
    });

    return {
      exitConditions: clean(parsed.exitConditions),
      risks: clean(parsed.risks),
      coreThesis: clean(parsed.coreThesis),
      valuationAssumption: clean(parsed.valuationAssumption),
      note: clean(parsed.note),
    };
  } catch (e) {
    await logAiRun({
      userId,
      kind: "card_draft",
      symbol,
      model: MODEL,
      status: "FAILED",
      durationMs: Date.now() - started,
      detail: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** 空文字や "null" という文字列を null に寄せる */
function clean(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || t === "null" || t === "なし" || t === "該当なし") return null;
  return t;
}

/**
 * 既存の内容と抽出した内容を合わせる。
 *
 * 既に書かれている内容を消さないため、既存があれば追記する。
 * 上書きすると、以前の判断の記録が失われる。
 */
export function mergeField(
  existing: string | null | undefined,
  extracted: string | null,
  today: string
): string | null {
  if (!extracted) return existing ?? null;
  const base = (existing ?? "").trim();
  if (!base) return extracted;
  // 同じ内容を二重に足さない
  if (base.includes(extracted)) return base;
  return `${base}\n\n【${today} の相談より】\n${extracted}`;
}
