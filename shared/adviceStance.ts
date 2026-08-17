/**
 * 相談の回答から「何を勧めたか」を読み取る。
 *
 * なぜ機械的に判定するか:
 * AI にもう一度「あなたは何を勧めましたか」と聞けば精度は上がるが、
 * 相談 1 回ごとに AI 呼び出しが 2 回になり時間と費用が倍になる。
 * 結論は 1 文目に書かせているので、そこの言い回しで判別できる。
 *
 * 判定できないときは null を返す。無理に BUY か HOLD に寄せると
 * 「勧めていないものを勧めた」と記録され、後の検証が汚れる。
 */

export type AdviceStance = "BUY" | "HOLD" | "REDUCE" | "REPAY";

/**
 * 結論の 1 文を取り出す。
 *
 * 見出し（## 〜）や箇条書きは結論ではないので飛ばす。
 * AI には結論を最初に 1 文で言い切らせているため、
 * 見出しでない最初の段落が結論になる。
 */
export function extractConclusion(answer: string): string | null {
  const lines = answer.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // 見出し・箇条書き・引用は結論の文ではない
    if (/^#{1,6}\s/.test(line)) continue;
    if (/^[-*+]\s/.test(line)) continue;
    if (/^>\s/.test(line)) continue;
    // 装飾記号だけの行を除く
    const cleaned = line.replace(/\*\*/g, "").trim();
    if (!cleaned) continue;
    return cleaned;
  }
  return null;
}

/*
 * 判定に使う言い回し。
 *
 * 順序が重要。「買い増しを見送る」は「買い増し」と「見送る」の両方を
 * 含むため、否定・見送りの語を先に見ないと BUY と誤判定される。
 */
const REPAY_WORDS = ["返済", "返すべき", "借入を減らす", "借入の圧縮"];
const REDUCE_WORDS = ["売却", "利益確定", "減らすべき", "一部売", "全て売", "手放す"];
const HOLD_WORDS = [
  "見送",
  "静観",
  "様子見",
  "控える",
  "急がない",
  "維持",
  "保有継続",
  "現状のまま",
  "待つべき",
  "買い増さない",
  "買うべきではない",
];
const BUY_WORDS = ["買い増し", "買い増す", "買うべき", "購入", "打診買い", "追加投資"];

function hasAny(text: string, words: string[]): boolean {
  return words.some(w => text.includes(w));
}

/**
 * 結論の文から提案の向きを判定する。
 *
 * 借入の返済を最優先で見るのは、「返済せず買い増しに回す」のような
 * 文で REPAY と BUY が両方出るため。この場合の主眼は買い増しなので、
 * 「返済せず」を打ち消し表現として扱う。
 */
export function detectStance(conclusion: string): AdviceStance | null {
  const t = conclusion;

  /*
   * 「返済せず」「返済は不要」は返済を勧めていない。
   * 打ち消しを先に判定しないと、返済に触れただけで REPAY になる。
   *
   * 「返済を急ぐ必要はない」のように助詞が挟まる形もあるため、
   * 「返済」の後ろ十数文字の範囲に打ち消しの語が来るかを見る。
   * 距離を限らないと、離れた場所の「不要」に引っ張られる。
   */
  const repayDenied = /返済[^。]{0,12}?(?:せず|しない|不要|見送|必要はない|必要ない)/.test(t);
  if (!repayDenied && hasAny(t, REPAY_WORDS)) return "REPAY";

  if (hasAny(t, REDUCE_WORDS)) return "REDUCE";

  /*
   * 見送り・静観は買い増しの語より優先する。
   * 「買い増しは見送るべき」を BUY と取ると、勧めていない買いを
   * 実行したかどうか追跡してしまう。
   */
  if (hasAny(t, HOLD_WORDS)) return "HOLD";

  if (hasAny(t, BUY_WORDS)) return "BUY";

  return null;
}

/**
 * 回答から提案の向きと結論の文をまとめて取り出す。
 */
export function parseAdvice(
  answer: string
): { stance: AdviceStance; conclusion: string } | null {
  const conclusion = extractConclusion(answer);
  if (!conclusion) return null;
  const stance = detectStance(conclusion);
  if (!stance) return null;
  /*
   * 結論は 1 文だけ残す。長い段落をそのまま入れると一覧で読めない。
   * 句点で切るが、句点がなければ 200 字で打ち切る。
   */
  const firstSentence = conclusion.split(/(?<=。)/)[0] ?? conclusion;
  return {
    stance,
    conclusion: firstSentence.length > 200 ? `${firstSentence.slice(0, 200)}…` : firstSentence,
  };
}
