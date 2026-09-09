import { describe, expect, it } from "vitest";
import {
  classifyUnheldPurchaseCandidate,
  groupRankedCandidates,
  selectAllRankedCandidates,
  selectUnheldPurchaseCandidates,
  selectUnheldQualityPriceOpportunities,
  type RankedBuyPlanLike,
} from "../shared/buyPlanOpportunity";

function row(overrides: Partial<RankedBuyPlanLike> = {}): RankedBuyPlanLike {
  return {
    symbol: "AAA",
    held: false,
    action: "ADD_MAIN",
    currentPrice: 100,
    outsideDirection: null,
    targetTooFar: false,
    needsCheck: false,
    pendingCheckCount: 0,
    concernCount: 0,
    signalAction: "HOLD",
    signalDataQuality: "MODERATE",
    cardConviction: 3,
    sizing: {
      status: "BUY",
      shares: 10,
      amountBase: 100_000,
      ibkrRiskLevel: "CAUTION",
      reasons: [],
    },
    ranking: {
      eligible: true,
      rank: 1,
      score: 70,
      breakdown: { quality: 20 },
      gateReasons: [],
    },
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
    expect(selectUnheldQualityPriceOpportunities([eligible])).toEqual([
      expect.objectContaining({
        symbol: "AAA",
        purchaseDecision: expect.objectContaining({ decision: "BUY_NOW" }),
      }),
    ]);
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

describe("真实未保有・购买判断", () => {
  it("全账户合计已持有的标的不进入未持有候选", () => {
    expect(classifyUnheldPurchaseCandidate(row({ held: true }))).toBeNull();
    expect(selectUnheldPurchaseCandidates([row({ held: true })])).toEqual([]);
  });

  it("资料、价格、核验、数量和风险均通过时才判断现在买", () => {
    expect(classifyUnheldPurchaseCandidate(row())).toMatchObject({
      decision: "BUY_NOW",
      label: "今すぐ購入を検討",
    });
  });

  it("价格尚未进入初回买入带时判断价格待", () => {
    expect(
      classifyUnheldPurchaseCandidate(
        row({ action: "HOLD", outsideDirection: "ABOVE", ranking: { eligible: false, rank: null, score: 55, breakdown: { quality: 20 }, gateReasons: ["現在の価格帯は買い増し対象ではありません"] } })
      )
    ).toMatchObject({ decision: "PRICE_WAIT" });
  });

  it.each([
    ["价格缺失", { currentPrice: null }],
    ["有待核验", { needsCheck: true, pendingCheckCount: 2 }],
    ["资料有限", { signalDataQuality: "LIMITED" }],
    ["卡片未设置", { cardConviction: null }],
  ])("%s时判断资料确认待", (_label, overrides) => {
    expect(classifyUnheldPurchaseCandidate(row(overrides))).toMatchObject({
      decision: "DATA_WAIT",
    });
  });

  it.each([
    ["有确认悬念", { concernCount: 1 }],
    ["信号退出", { signalAction: "EXIT" }],
    ["IBKR危险", { sizing: { status: "BLOCKED", shares: 0, amountBase: 0, ibkrRiskLevel: "DANGER", reasons: [] } }],
    ["质量不足", { cardConviction: 2 }],
  ])("%s时判断本次见送", (_label, overrides) => {
    expect(classifyUnheldPurchaseCandidate(row(overrides))).toMatchObject({
      decision: "SKIP",
    });
  });

  it("按现在买、价格待、资料待、见送排列，并以rank/score/symbol稳定同分", () => {
    const result = selectUnheldPurchaseCandidates([
      row({ symbol: "SKIP", concernCount: 1, ranking: { eligible: false, rank: null, score: 90, breakdown: { quality: 20 }, gateReasons: [] } }),
      row({ symbol: "WAIT", action: "HOLD", ranking: { eligible: false, rank: null, score: 80, breakdown: { quality: 20 }, gateReasons: [] } }),
      row({ symbol: "DATA", signalDataQuality: "LIMITED", ranking: { eligible: false, rank: null, score: 85, breakdown: { quality: 10 }, gateReasons: [] } }),
      row({ symbol: "BUY2", ranking: { eligible: true, rank: 2, score: 71, breakdown: { quality: 20 }, gateReasons: [] } }),
      row({ symbol: "BUY1", ranking: { eligible: true, rank: 1, score: 70, breakdown: { quality: 20 }, gateReasons: [] } }),
    ]);
    expect(result.map(item => item.symbol)).toEqual(["BUY1", "BUY2", "WAIT", "DATA", "SKIP"]);
  });
});
