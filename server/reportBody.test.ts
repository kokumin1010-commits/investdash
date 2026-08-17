import { describe, expect, it } from "vitest";
import { parseReportBody } from "../client/src/pages/Reports";

describe("レポート本文の整形", () => {
  it("改行のない本文でも見出しと本文を切り分ける", () => {
    /*
     * 実測した AI の応答は改行がほとんど無く、見出しと本文が
     * 全部 1 行に繋がっていた。空行だけで区切ると見出しの中に
     * 本文が丸ごと入り、見出しが数百文字になって読めなくなる。
     */
    const body =
      "## 判断・確認が必要な銘柄  ### 買い増し候補の検討（5銘柄）  " +
      "現在、伊藤忠商事（1,992円）が買い増しの価格帯にあります。  " +
      "## 全体の状況  純資産は726,117,239円、レバレッジは1.18倍です。";

    const blocks = parseReportBody(body);

    const h3 = blocks.filter(b => b.kind === "h3");
    const h4 = blocks.filter(b => b.kind === "h4");
    const p = blocks.filter(b => b.kind === "p");

    expect(h3.map(b => (b.kind === "h3" ? b.text : ""))).toEqual([
      "判断・確認が必要な銘柄",
      "全体の状況",
    ]);
    expect(h4.map(b => (b.kind === "h4" ? b.text : ""))).toEqual([
      "買い増し候補の検討（5銘柄）",
    ]);
    // 本文は見出しから切り離されている
    expect(p.length).toBe(2);
    expect(p[0].kind === "p" && p[0].text).toContain("伊藤忠商事");
    expect(p[1].kind === "p" && p[1].text).toContain("純資産は726,117,239円");
  });

  it("見出しが本文を巻き込まない（長さで検証）", () => {
    const body = "## 全体の状況  " + "あ".repeat(300);
    const blocks = parseReportBody(body);
    const heading = blocks.find(b => b.kind === "h3");

    expect(heading?.kind === "h3" && heading.text).toBe("全体の状況");
    // 見出しに 300 文字の本文が混ざっていないこと
    expect(heading?.kind === "h3" && heading.text.length).toBeLessThan(20);
  });

  it("箇条書きを箇条書きとして扱う", () => {
    const body = "## 確認事項\n- 受注の動向\n- 在庫の水準";
    const blocks = parseReportBody(body);
    const list = blocks.find(b => b.kind === "list");

    expect(list?.kind === "list" && list.items).toEqual(["受注の動向", "在庫の水準"]);
  });

  it("通常の Markdown（空行区切り）も崩さない", () => {
    const body = "## 見出し\n\n本文です。\n\n### 小見出し\n\nもう一つの本文。";
    const blocks = parseReportBody(body);

    expect(blocks.map(b => b.kind)).toEqual(["h3", "p", "h4", "p"]);
  });

  it("空の本文でも落ちない", () => {
    expect(parseReportBody("")).toEqual([]);
    expect(parseReportBody("   \n\n  ")).toEqual([]);
  });
});
