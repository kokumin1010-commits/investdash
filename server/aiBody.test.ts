/**
 * AI 本文の整形のテスト。
 *
 * 実測した相談の回答をそのまま入力に使う。整形は表示だけの処理だが、
 * 見出しが割れると意味が変わって読めるため（「財務・レバレッジへの影響」が
 * 「財務」と「レバレッジへの影響」に分かれた）、実データで固定する。
 */
import { describe, expect, it } from "vitest";
import { parseAiBody } from "../client/src/components/investing/AiBody";

/** 実測した回答（1 行に詰まった状態で返ってくる） */
const REAL_ANSWER =
  "## 結論：現時点では「静観」が基本方針です 買い増しは借入金とレバレッジの上昇を伴います。" +
  "業績の好調さと、財務リスク・ポートフォリオの偏りのバランスをどう考えるかが判断の分かれ目となります。" +
  "## 財務・レバレッジへの影響 *   **借入の増加**: 現金性資産が 1,255,302 円であるのに対し、" +
  "本銘柄の評価額は約 1,885 万円です。 *   **レバレッジの推移**: 現在のレバレッジは 1.36 倍です。";

describe("parseAiBody", () => {
  it("中黒を含む見出しを割らない", () => {
    const blocks = parseAiBody(REAL_ANSWER);
    const headings = blocks.filter(b => b.kind === "h3" || b.kind === "h4");
    const texts = headings.map(h => ("text" in h ? h.text : ""));
    expect(texts).toContain("財務・レバレッジへの影響");
    // 分割されて「財務」だけの見出しができていないこと
    expect(texts).not.toContain("財務");
  });

  it("箇条書きを箇条書きとして拾う", () => {
    const blocks = parseAiBody(REAL_ANSWER);
    const lists = blocks.filter(b => b.kind === "list");
    expect(lists.length).toBeGreaterThan(0);
    const items = lists.flatMap(l => ("items" in l ? l.items : []));
    expect(items.some(i => i.startsWith("借入の増加"))).toBe(true);
    expect(items.some(i => i.startsWith("レバレッジの推移"))).toBe(true);
  });

  it("強調記号を残さない", () => {
    const blocks = parseAiBody(REAL_ANSWER);
    const all = JSON.stringify(blocks);
    expect(all).not.toContain("**");
  });

  it("見出しにぶら下がった本文を段落として切り出す", () => {
    const blocks = parseAiBody(REAL_ANSWER);
    const first = blocks[0];
    expect(first.kind).toBe("h3");
    expect("text" in first ? first.text : "").toContain("静観");
    // 見出しの直後に本文が段落として来ること
    const second = blocks[1];
    expect(second.kind).toBe("p");
    expect("text" in second ? second.text : "").toContain("借入金とレバレッジ");
  });

  it("空文字でも落ちない", () => {
    expect(parseAiBody("")).toEqual([]);
  });
});
