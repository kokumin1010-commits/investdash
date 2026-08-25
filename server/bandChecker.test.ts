import { describe, it, expect } from "vitest";
import {
  buildCheckerPrompt,
  runBandChecks,
  matchCheckOutcomes,
  type CheckerNews,
} from "./services/bandChecker";

/**
 * 価格帯の確認項目とニュースの照合。
 *
 * ここで守りたいのは「材料がないことを問題なしと誤認しない」こと。
 * ニュースが取れていないだけの状態を CLEAR にすると、
 * 懸念を見落として買ってしまう。
 */

const NEWS: CheckerNews[] = [
  {
    title: "Marvell、AI向けカスタムシリコンの受注が拡大",
    summary: "大手クラウド事業者からの受注が前年比で増加した。",
    sentiment: "POSITIVE",
    impactScore: 70,
    publishedAt: new Date("2026-08-10T00:00:00Z"),
    source: "Reuters",
  },
];

describe("確認項目の照合プロンプト", () => {
  it("確認項目とニュースを両方載せる", () => {
    const p = buildCheckerPrompt({
      name: "マーベル・テクノロジー",
      symbol: "MRVL",
      actionLabel: "下落要因の徹底確認",
      checkItems: ["主要顧客のAI投資計画の縮小", "ASIC分野でのシェア流出"],
      news: NEWS,
    });
    expect(p).toContain("主要顧客のAI投資計画の縮小");
    expect(p).toContain("ASIC分野でのシェア流出");
    expect(p).toContain("Marvell、AI向けカスタムシリコンの受注が拡大");
    expect(p).toContain("下落要因の徹底確認");
  });

  it("ニュースが 0 件のときはその旨をプロンプトに書く", () => {
    const p = buildCheckerPrompt({
      name: "テスト",
      symbol: "TEST",
      actionLabel: "確認",
      checkItems: ["何か"],
      news: [],
    });
    expect(p).toContain("取得済みのニュースがありません");
    expect(p).toContain("UNKNOWN");
  });

  it("影響度と日付を載せて古い記事を見分けられるようにする", () => {
    const p = buildCheckerPrompt({
      name: "テスト",
      symbol: "TEST",
      actionLabel: "確認",
      checkItems: ["何か"],
      news: NEWS,
    });
    expect(p).toContain("2026-08-10");
    expect(p).toContain("影響度 70");
  });
});

describe("ニュースが無いときの挙動", () => {
  it("AI を呼ばずに UNKNOWN を返す（CLEAR にしない）", async () => {
    const out = await runBandChecks({
      name: "テスト",
      symbol: "TEST",
      actionLabel: "確認",
      checkItems: ["顧客離れ", "受注減少"],
      news: [],
    });
    expect(out).toHaveLength(2);
    expect(out.every(o => o.status === "UNKNOWN")).toBe(true);
    expect(out.every(o => o.sourceCount === 0)).toBe(true);
    expect(out.every(o => o.sourceIndexes.length === 0)).toBe(true);
    // 「懸念なし」と読める文言になっていないこと
    expect(out[0].finding).toContain("未取得");
    expect(out[0].finding).not.toContain("問題ありません");
  });

  it("確認項目が空なら何も返さない", async () => {
    const out = await runBandChecks({
      name: "テスト",
      symbol: "TEST",
      actionLabel: "確認",
      checkItems: [],
      news: NEWS,
    });
    expect(out).toEqual([]);
  });
});

/**
 * 突き合わせのリグレッション。
 *
 * 実測で gemini は項目名に番号を付けて返す（"1. 生成AI機能「Firefly」の…"）。
 * 素の一致比較だけだと全項目が突き合わせできず、確認したのに
 * 「判定が得られませんでした」しか出ない状態になった。
 */
describe("AI の返答とこちらの確認項目の突き合わせ", () => {
  const ITEMS = [
    "主要顧客のAI投資計画の縮小・延期",
    "ASIC分野でのブロードコムへのシェア流出",
  ];

  it("番号付きで返ってきても突き合わせできる", () => {
    const out = matchCheckOutcomes(
      ITEMS,
      [
        {
          checkItem: "1. 主要顧客のAI投資計画の縮小・延期",
          status: "CONCERN",
          finding: "投資計画の見直し報道あり",
          sourceCount: 2,
          sourceIndexes: [1, 2],
        },
        {
          checkItem: "2. ASIC分野でのブロードコムへのシェア流出",
          status: "CLEAR",
          finding: "受注拡大の報道あり",
          sourceCount: 1,
          sourceIndexes: [3],
        },
      ],
      5
    );
    expect(out[0].status).toBe("CONCERN");
    expect(out[1].status).toBe("CLEAR");
    // 項目名はこちらが渡した文言のまま返す（番号を混ぜない）
    expect(out[0].checkItem).toBe(ITEMS[0]);
  });

  it("括弧や全角空白のゆれを吸収する", () => {
    const out = matchCheckOutcomes(
      ["米連邦取引委員会（FTC）による訴訟の進展"],
      [
        {
          checkItem: "「米連邦取引委員会(FTC)による訴訟の進展」",
          status: "UNKNOWN",
          finding: "記述なし",
          sourceCount: 0,
          sourceIndexes: [],
        },
      ],
      3
    );
    expect(out[0].status).toBe("UNKNOWN");
    expect(out[0].finding).toBe("記述なし");
  });

  it("返ってこなかった項目は UNKNOWN で埋めて消さない", () => {
    const out = matchCheckOutcomes(
      ITEMS,
      [{ checkItem: "1. 主要顧客のAI投資計画の縮小・延期", status: "CONCERN", finding: "x", sourceCount: 1, sourceIndexes: [1] }],
      4
    );
    expect(out).toHaveLength(2);
    expect(out[1].status).toBe("UNKNOWN");
    expect(out[1].checkItem).toBe(ITEMS[1]);
  });

  it("1 つの回答が 2 項目に使い回されない", () => {
    const out = matchCheckOutcomes(
      ["売上の減速", "売上の減速に伴う利益率の低下"],
      [{ checkItem: "売上の減速", status: "CONCERN", finding: "減速あり", sourceCount: 2, sourceIndexes: [1, 2] }],
      4
    );
    expect(out[0].status).toBe("CONCERN");
    expect(out[1].status).toBe("UNKNOWN");
  });

  it("根拠件数はニュース件数を超えない", () => {
    const out = matchCheckOutcomes(
      ["何か"],
      [{ checkItem: "何か", status: "CONCERN", finding: "x", sourceCount: 99, sourceIndexes: [1, 2, 3] }],
      3
    );
    expect(out[0].sourceCount).toBe(3);
  });

  it("知らない status は UNKNOWN に寄せる", () => {
    const out = matchCheckOutcomes(
      ["何か"],
      [{ checkItem: "何か", status: "OK" as never, finding: "x", sourceCount: 1, sourceIndexes: [1] }],
      3
    );
    expect(out[0].status).toBe("UNKNOWN");
  });

  it("ニュース番号は重複を除き、範囲外を保存しない", () => {
    const out = matchCheckOutcomes(
      ["何か"],
      [{
        checkItem: "何か",
        status: "CONCERN",
        finding: "x",
        sourceCount: 4,
        sourceIndexes: [2, 2, 0, 5, 1],
      }],
      3
    );
    expect(out[0].sourceIndexes).toEqual([2, 1]);
  });
});
