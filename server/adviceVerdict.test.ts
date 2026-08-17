/**
 * 提案の当否判定を検証する。
 *
 * ここが甘いと「実は外れていた提案」を正しかったと数えてしまい、
 * 実績が信用できなくなる。特に短期の値動きで判定しないことと、
 * 見送りの提案では上下の意味が逆になることを重点的に見る。
 */
import { describe, expect, it } from "vitest";
import { judgeAdvice, summarizeVerdicts } from "../shared/adviceVerdict";

describe("提案の当否を判定する", () => {
  it("買いを勧めた後に上がれば正しい", () => {
    const r = judgeAdvice({ stance: "BUY", priceAtAdvice: 40, priceNow: 48, daysElapsed: 60 });
    expect(r.verdict).toBe("CORRECT");
    expect(r.changePct).toBeCloseTo(20, 1);
  });

  it("買いを勧めた後に下がれば外れ", () => {
    const r = judgeAdvice({ stance: "BUY", priceAtAdvice: 40, priceNow: 32, daysElapsed: 60 });
    expect(r.verdict).toBe("WRONG");
  });

  /*
   * 見送りは上下の意味が逆。ここを取り違えると実績が反転する。
   */
  it("見送りを勧めた後に下がれば正しい", () => {
    const r = judgeAdvice({ stance: "HOLD", priceAtAdvice: 100, priceNow: 85, daysElapsed: 60 });
    expect(r.verdict).toBe("CORRECT");
  });

  it("見送りを勧めた後に上がれば外れ（買う機会を逃した）", () => {
    const r = judgeAdvice({ stance: "HOLD", priceAtAdvice: 100, priceNow: 130, daysElapsed: 60 });
    expect(r.verdict).toBe("WRONG");
    expect(r.reason).toContain("逃");
  });

  it("売却を勧めた後に下がれば正しい", () => {
    const r = judgeAdvice({ stance: "REDUCE", priceAtAdvice: 200, priceNow: 150, daysElapsed: 90 });
    expect(r.verdict).toBe("CORRECT");
  });

  it("経過日数が足りなければ判定しない（3 日の値動きで当否を決めない）", () => {
    const r = judgeAdvice({ stance: "BUY", priceAtAdvice: 40, priceNow: 60, daysElapsed: 3 });
    expect(r.verdict).toBe("UNCLEAR");
    // 変動率自体は出す（参考として見せるため）
    expect(r.changePct).toBeCloseTo(50, 1);
  });

  it("横ばいなら判定しない（日々の揺れを実績に数えない）", () => {
    const r = judgeAdvice({ stance: "BUY", priceAtAdvice: 100, priceNow: 103, daysElapsed: 90 });
    expect(r.verdict).toBe("UNCLEAR");
  });

  it("株価が取れていなければ判定しない", () => {
    const r = judgeAdvice({ stance: "BUY", priceAtAdvice: null, priceNow: 100, daysElapsed: 90 });
    expect(r.verdict).toBe("UNCLEAR");
  });

  it("借入の返済は株価で測らない", () => {
    const r = judgeAdvice({ stance: "REPAY", priceAtAdvice: 100, priceNow: 200, daysElapsed: 90 });
    expect(r.verdict).toBe("UNCLEAR");
    expect(r.reason).toContain("借入");
  });

  it("提案時の株価が 0 以下なら判定しない（ゼロ除算を避ける）", () => {
    const r = judgeAdvice({ stance: "BUY", priceAtAdvice: 0, priceNow: 100, daysElapsed: 90 });
    expect(r.verdict).toBe("UNCLEAR");
  });
});

describe("実績を集計する", () => {
  it("判定済みだけを数える（UNCLEAR は勝敗に入れない）", () => {
    const s = summarizeVerdicts([
      { stance: "BUY", verdict: "CORRECT" },
      { stance: "BUY", verdict: "WRONG" },
      { stance: "HOLD", verdict: "CORRECT" },
      { stance: "BUY", verdict: "UNCLEAR" },
      { stance: "BUY", verdict: null },
    ]);
    expect(s.total).toBe(5);
    expect(s.judged).toBe(3);
    expect(s.correct).toBe(2);
    expect(s.wrong).toBe(1);
  });

  it("提案の向きごとに分けて数える（得意・不得意が分かる）", () => {
    const s = summarizeVerdicts([
      { stance: "BUY", verdict: "CORRECT" },
      { stance: "BUY", verdict: "CORRECT" },
      { stance: "HOLD", verdict: "WRONG" },
    ]);
    const buy = s.byStance.find(x => x.stance === "BUY");
    const hold = s.byStance.find(x => x.stance === "HOLD");
    expect(buy).toEqual({ stance: "BUY", correct: 2, wrong: 0 });
    expect(hold).toEqual({ stance: "HOLD", correct: 0, wrong: 1 });
  });

  it("何もなければ 0 件（例外を投げない）", () => {
    const s = summarizeVerdicts([]);
    expect(s.judged).toBe(0);
    expect(s.byStance).toEqual([]);
  });
});
