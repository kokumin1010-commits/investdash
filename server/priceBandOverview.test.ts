import { describe, it, expect } from "vitest";
import { evaluateBands, type BandInput } from "../shared/priceBands";

/**
 * 買い増しプラン一覧の判定と並び順の検証。
 *
 * 112 銘柄を横断で見る画面なので、「今どの段にいるか」の判定と
 * 「上から見れば良い」並び順が壊れると使えなくなる。
 */

function band(over: Partial<BandInput> & { id: number }): BandInput {
  return {
    lowerPrice: null,
    upperPrice: null,
    action: "HOLD",
    actionLabel: "様子見",
    reason: "テスト",
    checkItems: null,
    plannedAmount: null,
    sortOrder: over.id,
    ...over,
  };
}

/** 一覧の並び順（画面と同じロジック） */
function rank(action: string | null): number {
  return action === "ADD_MAIN"
    ? 0
    : action === "ADD_SMALL"
      ? 1
      : action === "VERIFY"
        ? 2
        : action === "REDUCE"
          ? 3
          : 4;
}

describe("一覧の判定", () => {
  const bands = [
    band({ id: 1, lowerPrice: 200, upperPrice: null, action: "HOLD", actionLabel: "静観" }),
    band({
      id: 2,
      lowerPrice: 150,
      upperPrice: 199.99,
      action: "ADD_SMALL",
      actionLabel: "打診買い",
    }),
    band({
      id: 3,
      lowerPrice: 100,
      upperPrice: 149.99,
      action: "ADD_MAIN",
      actionLabel: "主力買い増し",
    }),
    band({
      id: 4,
      lowerPrice: null,
      upperPrice: 99.99,
      action: "VERIFY",
      actionLabel: "要確認",
      checkItems: ["受注の悪化", "顧客の離脱"],
    }),
  ];

  it("価格帯の中にいれば行動が出る", () => {
    expect(evaluateBands(160, bands).currentBand?.action).toBe("ADD_SMALL");
    expect(evaluateBands(120, bands).currentBand?.action).toBe("ADD_MAIN");
    expect(evaluateBands(50, bands).currentBand?.action).toBe("VERIFY");
  });

  it("次の段までの距離が出る", () => {
    const r = evaluateBands(210, bands);
    expect(r.currentBand?.action).toBe("HOLD");
    expect(r.nextBand?.action).toBe("ADD_SMALL");
    // 210 → 199.99 は (199.99 - 210) / 210 = -4.77%
    expect(r.gapToNextPct).toBeCloseTo(-4.77, 1);
  });

  it("株価が未取得なら判定しない（静観と混同してはならない）", () => {
    const r = evaluateBands(null, bands);
    expect(r.currentBand).toBeNull();
    expect(r.abovePlan).toBe(false);
    expect(r.belowPlan).toBe(false);
  });

  it("確認項目がある段にいるかどうかで未照合の判定が変わる", () => {
    // VERIFY の段にいるときだけ確認項目を持つ
    expect(evaluateBands(50, bands).currentBand?.checkItems).toHaveLength(2);
    expect(evaluateBands(160, bands).currentBand?.checkItems).toBeNull();
  });
});

describe("一覧の並び順", () => {
  it("買う量が多い段を上に出す", () => {
    const actions = ["HOLD", "VERIFY", "ADD_SMALL", "ADD_MAIN", null, "REDUCE"];
    const sorted = [...actions].sort((a, b) => rank(a) - rank(b));
    expect(sorted).toEqual(["ADD_MAIN", "ADD_SMALL", "VERIFY", "REDUCE", "HOLD", null]);
  });

  it("同じ段なら次の段まで近い順に並ぶ", () => {
    // gapToNextPct は負の数。-2% の方が -10% より近い
    const rows = [
      { action: "ADD_SMALL", gap: -10 },
      { action: "ADD_SMALL", gap: -2 },
      { action: "ADD_SMALL", gap: -6 },
    ];
    const sorted = [...rows].sort((a, b) => {
      const d = rank(a.action) - rank(b.action);
      if (d !== 0) return d;
      return b.gap - a.gap;
    });
    expect(sorted.map(r => r.gap)).toEqual([-2, -6, -10]);
  });
});
