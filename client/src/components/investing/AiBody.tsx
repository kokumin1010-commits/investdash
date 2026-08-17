/**
 * AI が返した本文を表示する。
 *
 * レポートと相談で同じ整形が必要になった。片方だけ直すと
 * 同じ AI の出力なのに画面ごとに見た目が違うことになるため共通化する。
 *
 * 実測した本文は改行がほとんど無く「## 結論  買い増しは借入金と…」のように
 * 全部が 1 行に繋がっていた。空行だけで区切ると見出しの中に本文が丸ごと入り、
 * 見出しが数百文字になる。そこで見出し記号の前で割るだけでなく、
 * 見出し行そのものを「見出し」と「続く本文」に切り分ける。
 */
export type AiBlock =
  | { kind: "h3"; text: string }
  | { kind: "h4"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "p"; text: string };

/** 見出しとして扱う最大の長さ。これを超えたら本文が混ざっていると判断する */
const HEADING_MAX = 60;

export function parseAiBody(body: string): AiBlock[] {
  const blocks: AiBlock[] = [];

  /*
   * 見出し記号の前で改行を入れる。AI が 1 行に詰めて返すため、
   * これをしないと節が分かれない。
   */
  const normalized = body
    .replace(/\s*(#{2,4})\s+/g, "\n$1 ")
    /*
     * 箇条書きの行頭記号だけを改行する。
     * 以前は「-」や「・」を無条件に改行していたため、
     * 「財務・レバレッジへの影響」が「財務」と「レバレッジへの影響」に
     * 割れていた。行頭（改行直後）に限定し、`-` は前後に空白がある
     * 場合だけ箇条書きとみなす。
     */
    .replace(/(^|\n)\s*[*]\s+/g, "$1* ")
    .replace(/\s+[*]\s+/g, "\n* ")
    .replace(/(^|\n)\s*-\s+/g, "$1- ")
    .replace(/\n{3,}/g, "\n\n");

  const lines = normalized.split("\n");
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push({ kind: "list", items: listBuffer });
      listBuffer = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      let text = heading[2].trim();
      /*
       * 見出し行に本文がぶら下がっている場合を切り分ける。
       * 「## 結論：静観が基本 買い増しは借入を…」のような形で来る。
       */
      /*
       * 見出し行に本文がぶら下がっている場合を切り分ける。
       * 「## 結論：静観が基本 買い増しは借入を…」のような形で来る。
       *
       * 空白で機械的に割ると「財務・レバレッジへの影響」のような
       * 短い見出しまで壊すため、長い場合だけ、かつ句点や
       * 2 個以上の空白といった文の切れ目で割る。
       */
      let rest = "";
      if (text.length > HEADING_MAX) {
        /*
         * 見出しは 1 行で終わるので、最初の切れ目までを見出しとする。
         * 句点で割ると「…基本方針です 買い増しは借入金とレバレッジの
         * 上昇を伴います。」までが見出しに入ってしまう（最初の句点が
         * 本文の 1 文目の末尾にあるため）。
         * 実際の境目は見出しと本文の間の空白なので、空白を優先して探す。
         */
        const spaceAt = text.search(/\s/);
        const periodAt = text.indexOf("。");
        const boundary =
          spaceAt > 0 && (periodAt < 0 || spaceAt < periodAt) ? spaceAt : periodAt;
        if (boundary > 0) {
          const includePeriod = text[boundary] === "。";
          rest = text
            .slice(boundary + (includePeriod ? 1 : 0))
            .trim();
          text = text.slice(0, boundary + (includePeriod ? 1 : 0)).trim();
        }
      }
      blocks.push({ kind: level <= 2 ? "h3" : "h4", text: stripInline(text) });
      if (rest) blocks.push({ kind: "p", text: stripInline(rest) });
      continue;
    }

    const bullet = line.match(/^(?:\*\s+|-\s+|・)(.*)$/);
    if (bullet) {
      listBuffer.push(stripInline(bullet[1].trim()));
      continue;
    }

    flushList();
    blocks.push({ kind: "p", text: stripInline(line) });
  }
  flushList();

  return blocks;
}

/**
 * 強調記号を落とす。
 * Markdown を解釈するライブラリを足さずに済ませるため、
 * 記号だけ取り除いて素の文字として出す。
 */
function stripInline(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

export function AiBody({ body }: { body: string }) {
  const blocks = parseAiBody(body);
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.kind === "h3") {
          return (
            <h3 key={i} className="border-b pt-2 pb-1 text-base font-semibold">
              {block.text}
            </h3>
          );
        }
        if (block.kind === "h4") {
          return (
            <h4 key={i} className="pt-1 text-sm font-semibold">
              {block.text}
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}
