/**
 * LLM のレスポンスから JSON を安全に取り出す。
 *
 * 背景: 内蔵プロキシでは `response_format: json_schema` を指定しても、
 * モデルによってスキーマを無視して Markdown（```json フェンス付き、または
 * 前置きの文章付き）を返すことがある。実測では以下の差があった。
 *   - claude-sonnet-4-6 / claude-haiku-4-5 → Markdown を返す（JSON.parse 不可）
 *   - gpt-5-mini / gemini-3-flash-preview  → 素の JSON を返す
 * モデル選定で回避するのが第一だが、プロキシ側の挙動は変わりうるため、
 * パーサ側にも安全網を持たせる。
 */

/** ```json ... ``` のコードフェンスを剥がす */
function stripCodeFence(text: string): string | null {
  const fence = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  return fence?.[1]?.trim() ?? null;
}

/**
 * 文章中に埋め込まれた最初の JSON オブジェクトを、括弧の対応を数えて切り出す。
 * 文字列リテラル内の括弧とエスケープを考慮する。
 */
function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * LLM の出力を JSON としてパースする。素の JSON → コードフェンス →
 * 埋め込みオブジェクトの順に試す。
 *
 * @throws パースできなかった場合。メッセージには先頭の内容を含めて原因を追える形にする。
 */
export function parseLlmJson<T>(raw: unknown, context = "AI の応答"): T {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`${context}が空でした。もう一度お試しください。`);
  }

  const text = raw.trim();
  const candidates = [text, stripCodeFence(text), extractBalancedObject(text)];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // 次の候補を試す
    }
  }

  const head = text.slice(0, 80).replace(/\s+/g, " ");
  throw new Error(`${context}を解析できませんでした（先頭: ${head}）。もう一度お試しください。`);
}
