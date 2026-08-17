import { describe, expect, it } from "vitest";
import {
  NOTE_EARNINGS_THRESHOLD,
  NOTE_NEWS_THRESHOLD,
  noteFromBandTransition,
  noteFromConsult,
  noteFromNews,
  noteFromOutcome,
  selectNotesForPrompt,
} from "../shared/noteBuilder";

const NOW = new Date("2026-08-18T09:00:00+09:00");

describe("ニュースからのメモ", () => {
  it("影響度が下限を超えるニュースを残す", () => {
    const n = noteFromNews({
      id: 1,
      symbol: "NVDA",
      title: "SpaceX への 210 億ドルの巨額出資が判明",
      summary: "AI インフラへの資本参加が進む",
      impactScore: 78,
      publishedAt: NOW,
      createdAt: NOW,
    });
    expect(n).not.toBeNull();
    expect(n!.kind).toBe("NEWS");
    expect(n!.importance).toBe(78);
    expect(n!.sourceKey).toBe("news:1");
  });

  it("影響度が低いニュースは残さない（毎日 112 銘柄で埋まると読めなくなる）", () => {
    const n = noteFromNews({
      id: 2,
      symbol: "NVDA",
      title: "アナリストが目標株価を据え置き",
      summary: null,
      impactScore: NOTE_NEWS_THRESHOLD - 1,
      publishedAt: NOW,
      createdAt: NOW,
    });
    expect(n).toBeNull();
  });

  it("決算関連は基準を下げて残す（内容が判断に直結する）", () => {
    const n = noteFromNews({
      id: 3,
      symbol: "6920.T",
      title: "レーザーテック、26年6月期の業績予想は減収減益",
      summary: "受注高は 2.3 倍へ回復の見通し",
      impactScore: NOTE_EARNINGS_THRESHOLD,
      publishedAt: NOW,
      createdAt: NOW,
    });
    expect(n).not.toBeNull();
    expect(n!.kind).toBe("EARNINGS");
  });

  it("影響度が未取得のニュースは残さない（重要度が分からず並べられない）", () => {
    const n = noteFromNews({
      id: 4,
      symbol: "NVDA",
      title: "何らかのニュース",
      summary: null,
      impactScore: null,
      publishedAt: NOW,
      createdAt: NOW,
    });
    expect(n).toBeNull();
  });

  it("公開日が無い場合は取得日を出来事の日時にする", () => {
    const created = new Date("2026-08-10T00:00:00Z");
    const n = noteFromNews({
      id: 5,
      symbol: "NVDA",
      title: "重要なニュース",
      summary: null,
      impactScore: 90,
      publishedAt: null,
      createdAt: created,
    });
    expect(n!.occurredAt.getTime()).toBe(created.getTime());
  });
});

describe("判定変化からのメモ", () => {
  it("段の移動をそのまま書く", () => {
    const n = noteFromBandTransition({
      id: 10,
      symbol: "NKE",
      fromLabel: "静観",
      toLabel: "安値圏での打診買い増し",
      fromAction: "HOLD",
      toAction: "ADD_SMALL",
      outsideDirection: null,
      price: 40.73,
      currency: "USD",
      createdAt: NOW,
    });
    expect(n.headline).toBe(
      "買い増しプランの判定が「静観」から「安値圏での打診買い増し」に変わった"
    );
    expect(n.detail).toContain("40.73");
    expect(n.sourceKey).toBe("band:10");
  });

  it("買い増し圏に入った変化は重要度を高くする", () => {
    const a = noteFromBandTransition({
      id: 11,
      symbol: "X",
      fromLabel: "静観",
      toLabel: "主力買い増し",
      fromAction: "HOLD",
      toAction: "ADD_MAIN",
      outsideDirection: null,
      price: 100,
      currency: "USD",
      createdAt: NOW,
    });
    const b = noteFromBandTransition({
      id: 12,
      symbol: "X",
      fromLabel: "打診買い",
      toLabel: "静観",
      fromAction: "ADD_SMALL",
      toAction: "HOLD",
      outsideDirection: null,
      price: 120,
      currency: "USD",
      createdAt: NOW,
    });
    expect(a.importance).toBeGreaterThan(b.importance!);
  });

  it("帯の外に出た場合は方向を文言にする（action が null では区別できない）", () => {
    const n = noteFromBandTransition({
      id: 13,
      symbol: "X",
      fromLabel: "静観",
      toLabel: null,
      fromAction: "HOLD",
      toAction: null,
      outsideDirection: "BELOW",
      price: 50,
      currency: "USD",
      createdAt: NOW,
    });
    expect(n.headline).toContain("価格帯より下");
  });

  it("通貨記号を持たない通貨は通貨コードを添える", () => {
    const n = noteFromBandTransition({
      id: 14,
      symbol: "0823.HK",
      fromLabel: "静観",
      toLabel: "打診買い",
      fromAction: "HOLD",
      toAction: "ADD_SMALL",
      outsideDirection: null,
      price: 38.88,
      currency: "HKD",
      createdAt: NOW,
    });
    expect(n.detail).toContain("HKD");
  });
});

describe("相談からのメモ", () => {
  it("銘柄を指定した相談を残す", () => {
    const n = noteFromConsult({
      id: 20,
      symbol: "8058.T",
      title: "[8058.T] 三菱商事を今から買い増してよいか",
      conclusion: "結論：取得単価の低減には寄与しますが、借入リスクは増大します",
      createdAt: NOW,
    });
    expect(n).not.toBeNull();
    expect(n!.headline).toContain("AI に相談した");
    expect(n!.sourceKey).toBe("consult:20");
  });

  it("銘柄を指定していない相談は残さない（関係ない銘柄に混ざる）", () => {
    const n = noteFromConsult({
      id: 21,
      symbol: null,
      title: "借入を返すべきか",
      conclusion: "返済せず打診買いに回すべきです",
      createdAt: NOW,
    });
    expect(n).toBeNull();
  });
});

describe("提案の当否からのメモ", () => {
  it("判定が確定したものを残す", () => {
    const n = noteFromOutcome({
      id: 30,
      symbol: "NKE",
      stance: "BUY",
      verdict: "CORRECT",
      priceAtAdvice: 40.73,
      priceAtVerdict: 45.5,
      verdictAt: NOW,
      createdAt: NOW,
    });
    expect(n).not.toBeNull();
    expect(n!.headline).toBe("「買い」の判断が結果的に正しかった");
    expect(n!.detail).toContain("11.7%");
  });

  it("判定待ちは残さない（まだ分からない記録が並ぶと邪魔になる）", () => {
    const n = noteFromOutcome({
      id: 31,
      symbol: "NKE",
      stance: "BUY",
      verdict: "UNCLEAR",
      priceAtAdvice: 40.73,
      priceAtVerdict: null,
      verdictAt: null,
      createdAt: NOW,
    });
    expect(n).toBeNull();
  });
});

describe("相談 AI に渡すメモの選び方", () => {
  const mk = (importance: number, daysAgo: number) => ({
    importance,
    occurredAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    kind: "NEWS" as const,
  });

  it("上限以下なら全件を新しい順で返す", () => {
    const notes = [mk(50, 3), mk(90, 1), mk(60, 2)];
    const picked = selectNotesForPrompt(notes, 12);
    expect(picked).toHaveLength(3);
    expect(picked[0].occurredAt.getTime()).toBeGreaterThan(picked[1].occurredAt.getTime());
  });

  it("上限を超える場合は古くて重要な出来事も残す", () => {
    const notes = [
      mk(10, 1),
      mk(10, 2),
      mk(10, 3),
      mk(10, 4),
      // 3 か月前の重要な出来事（新しさだけで選ぶと落ちる）
      mk(95, 90),
    ];
    const picked = selectNotesForPrompt(notes, 4);
    expect(picked).toHaveLength(4);
    expect(picked.some(p => p.importance === 95)).toBe(true);
  });

  it("直近の出来事も落とさない", () => {
    const notes = [
      mk(5, 0),
      mk(95, 100),
      mk(94, 101),
      mk(93, 102),
      mk(92, 103),
    ];
    const picked = selectNotesForPrompt(notes, 3);
    expect(picked.some(p => p.importance === 5)).toBe(true);
  });

  it("結果は新しい順に並ぶ", () => {
    const notes = [mk(10, 5), mk(99, 40), mk(50, 1)];
    const picked = selectNotesForPrompt(notes, 2);
    for (let i = 1; i < picked.length; i += 1) {
      expect(picked[i - 1].occurredAt.getTime()).toBeGreaterThanOrEqual(
        picked[i].occurredAt.getTime()
      );
    }
  });
});
