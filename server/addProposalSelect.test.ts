import { describe, expect, it } from "vitest";
import { selectProposalTargets } from "./services/addProposalService";
import type { PlanOverviewRow } from "./services/priceBandService";

function row(over: Partial<PlanOverviewRow>): PlanOverviewRow {
  return {
    symbol: "AAA",
    name: "テスト",
    currency: "USD",
    currentPrice: 100,
    action: "HOLD",
    actionLabel: "様子見",
    outsideDirection: null,
    nextGapPct: -10,
    nextActionLabel: "打診買い",
    needsCheck: false,
    concernCount: 0,
    generatedAt: new Date("2026-08-01"),
    holdingValueJpy: 1_000_000,
    weightPct: 0.1,
    avgCost: 90,
    pnlPct: 11,
    costRecovered: false,
    held: true,
    watchTargetPrice: null,
    watchGapPct: null,
    watchPriority: null,
    targetTooFar: false,
    ...over,
  } as PlanOverviewRow;
}

describe("提案する銘柄の選別", () => {
  it("買い増しの段にいる銘柄を最優先で選ぶ", () => {
    const picked = selectProposalTargets([
      row({ symbol: "HOLD1", action: "HOLD", nextGapPct: -10 }),
      row({ symbol: "MAIN", action: "ADD_MAIN" }),
      row({ symbol: "SMALL", action: "ADD_SMALL" }),
    ]);
    expect(picked.map(p => p.row.symbol)).toEqual(["MAIN", "SMALL"]);
    expect(picked[0].reason).toContain("主力買い増し");
  });

  it("確認してから買う段も対象にする（材料の整理が最も役に立つ）", () => {
    const picked = selectProposalTargets([row({ symbol: "VER", action: "VERIFY" })]);
    expect(picked).toHaveLength(1);
    expect(picked[0].reason).toContain("確認してから買う");
  });

  it("懸念が記録されている銘柄を選ぶ", () => {
    const picked = selectProposalTargets([
      row({ symbol: "CONCERN", action: "HOLD", nextGapPct: -20, concernCount: 2 }),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0].reason).toContain("懸念が 2 件");
  });

  it("次の段まで 3% 以内の銘柄を選ぶ", () => {
    const picked = selectProposalTargets([
      row({ symbol: "NEAR", action: "HOLD", nextGapPct: -2.5 }),
      row({ symbol: "FAR", action: "HOLD", nextGapPct: -12 }),
    ]);
    expect(picked.map(p => p.row.symbol)).toEqual(["NEAR"]);
  });

  it("未保有で目標価格に近い銘柄を選ぶ（買い逃しを防ぐ）", () => {
    const picked = selectProposalTargets([
      row({
        symbol: "WATCH",
        action: null,
        actionLabel: null,
        nextGapPct: null,
        held: false,
        holdingValueJpy: null,
        watchGapPct: -1.2,
      }),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0].reason).toContain("目標価格まで");
  });

  it("株価が取れていない銘柄は対象にしない（古い値で判断させない）", () => {
    const picked = selectProposalTargets([
      row({ symbol: "NOPRICE", action: "ADD_MAIN", currentPrice: null }),
    ]);
    expect(picked).toHaveLength(0);
  });

  it("減らす段（REDUCE）は対象にしない（買い増しの是非に絞る）", () => {
    const picked = selectProposalTargets([
      row({ symbol: "RED", action: "REDUCE", nextGapPct: -30 }),
    ]);
    expect(picked).toHaveLength(0);
  });

  it("同じ優先度なら評価額の大きい順に並べる", () => {
    const picked = selectProposalTargets([
      row({ symbol: "SMALLV", action: "ADD_SMALL", holdingValueJpy: 1_000_000 }),
      row({ symbol: "BIGV", action: "ADD_SMALL", holdingValueJpy: 50_000_000 }),
    ]);
    expect(picked.map(p => p.row.symbol)).toEqual(["BIGV", "SMALLV"]);
  });

  it("上限件数を超えない（1 銘柄あたり十数秒かかるため）", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ symbol: `S${i}`, action: "ADD_SMALL", holdingValueJpy: i * 1000 })
    );
    expect(selectProposalTargets(rows, 5)).toHaveLength(5);
  });

  it("同じ銘柄を二重に選ばない", () => {
    // 買い増しの段かつ懸念あり。両方の条件に当たるが 1 件だけ
    const picked = selectProposalTargets([
      row({ symbol: "BOTH", action: "ADD_MAIN", concernCount: 3, nextGapPct: -1 }),
    ]);
    expect(picked).toHaveLength(1);
  });
});
