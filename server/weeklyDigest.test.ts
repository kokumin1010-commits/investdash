import { describe, expect, it } from "vitest";
import { buildWeeklyPrompt } from "./services/reportWriter";
import { NEWS_IMPACT_THRESHOLD, MAX_TOPICS, type DigestInput } from "./services/weeklyDigest";

const baseOverview: DigestInput["overview"] = {
  stockValueJpy: 860_000_000,
  borrowedJpy: 227_496_210,
  netAssetsJpy: 726_117_239,
  leverage: 1.18,
  annualDividendJpy: 20_026_496,
  holdingsCount: 156,
  interestAssetsJpy: 94_000_000,
};

const makeInput = (overrides: Partial<DigestInput> = {}): DigestInput => ({
  periodStart: new Date("2026-08-10T00:00:00Z"),
  periodEnd: new Date("2026-08-17T00:00:00Z"),
  overview: baseOverview,
  buyZoneCount: 0,
  topics: [],
  quietReason: null,
  ...overrides,
});

describe("レポートのプロンプト", () => {
  it("材料がない場合は「ありません」と理由を明記する", () => {
    /*
     * 何もなかった週も生成する。出さないと「レポートが来ないのは
     * 壊れているのか」と区別できなくなる。無理に話を作らせないため、
     * 材料がないことを明示して渡す。
     */
    const prompt = buildWeeklyPrompt(
      makeInput({ quietReason: "判定の変化・買い増し圏の銘柄・影響度の高いニュースのいずれもありませんでした" })
    );

    expect(prompt).toContain("ありません");
    expect(prompt).toContain("判定の変化・買い増し圏の銘柄");
    // 銘柄の節は作らない
    expect(prompt).not.toContain("今期間に取り上げる銘柄");
  });

  it("借入と純資産を必ず渡す（レバレッジの判断材料になる）", () => {
    const prompt = buildWeeklyPrompt(makeInput());

    expect(prompt).toContain("借入: ¥227,496,210");
    expect(prompt).toContain("純資産: ¥726,117,239");
    expect(prompt).toContain("レバレッジ: 1.18 倍");
  });

  it("レバレッジが出せない場合は算出不可と書く（0 倍と混同しない）", () => {
    const prompt = buildWeeklyPrompt(
      makeInput({ overview: { ...baseOverview, leverage: null } })
    );

    expect(prompt).toContain("レバレッジ: 算出不可");
    expect(prompt).not.toContain("0.00 倍");
  });

  it("銘柄ごとに取り上げる理由・現在値・段を渡す", () => {
    const prompt = buildWeeklyPrompt(
      makeInput({
        buyZoneCount: 1,
        topics: [
          {
            symbol: "NKE",
            name: "ナイキ",
            reasons: ["買い増しの価格帯にいる", "判定が変わった"],
            currentPrice: 40.73,
            currency: "USD",
            actionLabel: "安値圏での打診買い増し",
            nextGapPct: -4.3,
            nextActionLabel: "主力買い増しの検討水準",
            transitions: [
              { description: "安値圏での打診買い増し", importance: "HIGH", at: new Date("2026-08-15T00:00:00Z") },
            ],
            news: [
              {
                title: "決算は市場予想を上回る",
                summary: "北米売上が回復",
                impactScore: 75,
                sentiment: "POSITIVE",
              },
            ],
            valueLocal: 120_000,
            needsAction: true,
          },
        ],
      })
    );

    expect(prompt).toContain("ナイキ（NKE）");
    expect(prompt).toContain("買い増しの価格帯にいる / 判定が変わった");
    expect(prompt).toContain("USD 40.73");
    expect(prompt).toContain("安値圏での打診買い増し");
    expect(prompt).toContain("次の段まで: -4.3%");
    expect(prompt).toContain("決算は市場予想を上回る");
  });

  it("断定を禁じる指示が必ず入る", () => {
    // 「買え・売れ」を出させると、判断を委ねる作りにした意味がなくなる
    const prompt = buildWeeklyPrompt(makeInput());
    expect(prompt).toContain("書き方");
  });
});

describe("絞り込みのしきい値", () => {
  it("ニュースの影響度は 0〜100 に対する値である", () => {
    /*
     * impactScore は 0〜100 で保存される。7 のような小さい値にすると
     * ほぼ全件が該当してしまい、絞り込みの意味がなくなる。
     */
    expect(NEWS_IMPACT_THRESHOLD).toBeGreaterThan(50);
    expect(NEWS_IMPACT_THRESHOLD).toBeLessThanOrEqual(100);
  });

  it("AI に渡す銘柄数に上限がある", () => {
    // 112 銘柄すべてを渡すと生成が長くなり、読む側も追えない
    expect(MAX_TOPICS).toBeGreaterThan(0);
    expect(MAX_TOPICS).toBeLessThanOrEqual(20);
  });
});
