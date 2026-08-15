import { describe, expect, it } from "vitest";
import { pnlLabel } from "@shared/pnlLabel";

/**
 * ダッシュボードの数字ラベルに関する仕様をテストする。
 *
 * ユーザーから「+240.67% や 3.0% が何の数字か分からない」という指摘があり、
 * 数字だけを並べず必ずラベルを添える方針にした。
 * ここでは表示ロジック（含み益 / 含み損の出し分け）を検証する。
 */

describe("pnlLabel", () => {
  it("含み益がある場合は「含み益」を返す", () => {
    expect(pnlLabel(240.67)).toBe("含み益");
    expect(pnlLabel(0.01)).toBe("含み益");
  });

  it("含み損がある場合は「含み損」を返す", () => {
    expect(pnlLabel(-7.17)).toBe("含み損");
    expect(pnlLabel(-23.79)).toBe("含み損");
  });

  it("損益ゼロは「含み益」側に寄せる（マイナス表記を避ける）", () => {
    expect(pnlLabel(0)).toBe("含み益");
  });

  it("データがない場合は中立的な「含み損益」を返す", () => {
    expect(pnlLabel(null)).toBe("含み損益");
  });

  it("WATCH 銘柄でも含み益が大きい場合は「含み益」と表示する", () => {
    // SUMCO のように決算悪化で WATCH でも含み益が大きいケース。
    // ラベルがないと「良い銘柄なのに注意枠にある」矛盾に見えるため明示が必要。
    expect(pnlLabel(240.67)).toBe("含み益");
  });
});
