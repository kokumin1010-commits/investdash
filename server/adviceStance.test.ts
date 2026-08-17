/**
 * 相談の回答から「何を勧めたか」を読み取る処理を検証する。
 *
 * ここを誤判定すると、勧めていない買いを「実行したか」と追跡したり、
 * 逆に勧めた買いを見落として当否を検証できなくなる。
 * 実際の AI 回答の文面をそのまま使ってテストする。
 */
import { describe, expect, it } from "vitest";
import { detectStance, extractConclusion, parseAdvice } from "../shared/adviceStance";

describe("結論の文を取り出す", () => {
  it("見出しを飛ばして最初の段落を取る", () => {
    const answer = `## 結論

借入は返済せず、買い増しに充てるべきです。

## 根拠
*   金利差があります`;
    expect(extractConclusion(answer)).toBe("借入は返済せず、買い増しに充てるべきです。");
  });

  it("箇条書きから始まる回答でも段落を拾う", () => {
    const answer = `*   これは箇条書きです

現時点では買い増しを見送るべきです。`;
    expect(extractConclusion(answer)).toBe("現時点では買い増しを見送るべきです。");
  });

  it("装飾記号を外して返す（**強調** がそのまま残ると読みにくい）", () => {
    expect(extractConclusion("**買い増してよいです。**")).toBe("買い増してよいです。");
  });

  it("空の回答では null", () => {
    expect(extractConclusion("\n\n## 見出しだけ\n")).toBeNull();
  });
});

describe("提案の向きを判定する", () => {
  /*
   * 実測の回答（2026/8/18・借入の相談）。
   * 「返済せず」と「買い増し」が同じ文にあり、主眼は買い増し。
   */
  it("返済を否定して買い増しを勧める文は BUY", () => {
    const t =
      "借入は返済せず、年間配当見込み額の約 2,000 万円を上限として、取得単価を下回る銘柄への打診買いに充てるべきです。";
    expect(detectStance(t)).toBe("BUY");
  });

  /*
   * 実測の回答（2026/8/18・三菱商事）。
   * 「買い増し」と「見送り」が同じ文にあり、主眼は見送り。
   */
  it("買い増しを見送る文は HOLD（買いの語が含まれても BUY にしない）", () => {
    const t =
      "前回の相談と同じ判断に基づき、現在は買い増しを見送り、株価 3,200 円近辺までの調整がない限り既存保有の継続に留めるべきです。";
    expect(detectStance(t)).toBe("HOLD");
  });

  it("返済を勧める文は REPAY", () => {
    expect(detectStance("借入の返済を優先すべきです。")).toBe("REPAY");
  });

  it("売却を勧める文は REDUCE", () => {
    expect(detectStance("一部を利益確定して売却すべきです。")).toBe("REDUCE");
  });

  it("静観を勧める文は HOLD", () => {
    expect(detectStance("現水準では静観すべきです。")).toBe("HOLD");
  });

  it("買い増しだけを勧める文は BUY", () => {
    expect(detectStance("この水準なら買い増してよいです。")).toBe("BUY");
  });

  it("判定できない文は null（無理に寄せると記録が汚れる）", () => {
    expect(detectStance("為替の動向が重要です。")).toBeNull();
  });

  it("返済を急ぐ必要はないという表現を REPAY にしない", () => {
    expect(detectStance("返済を急ぐ必要はないため、買い増しを検討してください。")).toBe("BUY");
  });
});

describe("回答全体から提案を取り出す", () => {
  it("向きと結論の 1 文を返す", () => {
    const answer = `借入は返済せず、買い増しに充てるべきです。理由は金利差です。

## 根拠
*   金利 1.73% に対し利回り 3.46%`;
    const r = parseAdvice(answer);
    expect(r?.stance).toBe("BUY");
    // 2 文目以降は含めない（一覧で読めなくなる）
    expect(r?.conclusion).toBe("借入は返済せず、買い増しに充てるべきです。");
  });

  it("向きが判定できなければ null（記録しない）", () => {
    expect(parseAdvice("為替の動向が重要です。")).toBeNull();
  });

  it("長すぎる結論は打ち切る", () => {
    const long = `${"あ".repeat(250)}買い増してよいです`;
    const r = parseAdvice(long);
    expect(r?.conclusion.length).toBeLessThanOrEqual(201);
  });
});
