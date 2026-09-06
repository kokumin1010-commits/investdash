import { describe, expect, it } from "vitest";
import {
  groupRankedCandidates,
  selectAllRankedCandidates,
  selectUnheldQualityPriceOpportunities,
  type RankedBuyPlanLike,
} from "../shared/buyPlanOpportunity";

function row(overrides: Partial<RankedBuyPlanLike> = {}): RankedBuyPlanLike {
  return {
    held: false,
    action: "ADD_MAIN",
    needsCheck: false,
    pendingCheckCount: 0,
    concernCount: 0,
    signalDataQuality: "MODERATE",
    cardConviction: 3,
    sizing: { status: "BUY", shares: 10, amountBase: 100_000 },
    ranking: { eligible: true, rank: 1, breakdown: { quality: 20 } },
    ...overrides,
  };
}

describe("Buy Plans 全量候補", () => {
  it("可执行候选按 rank 全量返回，数量或金额为0者不冒充买入候选", () => {
    const result = selectAllRankedCandidates([
      row({ ranking: { eligible: true, rank: 3, breakdown: { quality: 20 } } }),
      row({ ranking: { eligible: true, rank: 1, breakdown: { quality: 20 } } }),
      row({ sizing: { status: "BLOCKED", shares: 0, amountBase: 0 } }),
      row({ ranking: { eligible: false, rank: null, breakdown: { quality: 20 } } }),
    ]);
    expect(result.map(item => item.ranking.rank)).toEqual([1, 3]);
  });

  it("每10名分组但不截断全部候选", () => {
    const candidates = Array.from({ length: 23 }, (_, index) => index + 1);
    expect(groupRankedCandidates(candidates).map(group => group.length)).toEqual([10, 10, 3]);
    expect(groupRankedCandidates(candidates).flat()).toEqual(candidates);
  });
});

describe("未保有・品質資料と価格条件を通過", () => {
  it("仅纳入未持有、无核验/懸念、资料质量和卡片确信度达标的可执行候选", () => {
    const eligible = row();
    expect(selectUnheldQualityPriceOpportunities([eligible])).toEqual([eligible]);
  });

  it.each([
    ["已持有", { held: true }],
    ["有悬念", { concernCount: 1 }],
    ["有待核验", { needsCheck: true, pendingCheckCount: 2 }],
    ["资料有限", { signalDataQuality: "LIMITED" }],
    ["卡片确信度不足", { cardConviction: 2 }],
    ["结构资料分不足", { ranking: { eligible: true, rank: 1, breakdown: { quality: 17 } } }],
    ["不是买入价格带", { action: "HOLD" }],
  ])("排除%s的候选", (_label, overrides) => {
    expect(selectUnheldQualityPriceOpportunities([row(overrides)])).toEqual([]);
  });
});
