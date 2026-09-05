import { describe, expect, it } from "vitest";
import type { ActionQueueView } from "./services/actionQueueService";
import { resolveActionQueueDecisionNote } from "./services/actionQueueService";
import { applyLiveSellDiscipline } from "./services/actionQueueCommandCenterService";

function item(overrides: Partial<ActionQueueView> = {}): ActionQueueView {
  return {
    id: 1,
    userId: 1,
    symbol: "6920.T",
    name: "Lasertec",
    status: "PENDING_ACTION",
    triggerType: "SIGNAL_CHANGE",
    triggerKey: "signal:6920.T:1",
    triggerSummary: "HOLD から REDUCE へ判断変更",
    sourceNewsId: null,
    sourceSignalId: 1,
    previousSignalId: null,
    previousAction: "HOLD",
    action: "REDUCE",
    direction: "SELL",
    currency: "JPY",
    rationale: "一部売却を検討",
    evidence: {},
    currentQuantity: 100,
    currentPrice: 34_640,
    currentValueBase: 3_464_000,
    currentWeightPct: 0.4,
    recommendedShares: 100,
    recommendedAmountLocal: 3_464_000,
    recommendedAmountBase: 3_464_000,
    afterQuantity: 0,
    afterWeightPct: 0,
    priority: 90,
    deadline: null,
    snoozedUntil: null,
    decisionNote: null,
    approvedAt: null,
    skippedAt: null,
    completedAt: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    pending: true,
    ...overrides,
  };
}

const smallJapanesePosition = {
  symbol: "6920.T",
  quantity: 100,
  currentPrice: 34_640,
  marketValueBase: 3_464_000,
  weightPct: 0.4,
  market: "JP",
  entries: [{}],
} as any;

describe("applyLiveSellDiscipline", () => {
  it("未確認の1単元 REDUCE を全売却にせず要確認へ降格する", () => {
    const [result] = applyLiveSellDiscipline(
      [item()],
      [smallJapanesePosition]
    );
    expect(result.direction).toBe("REVIEW");
    expect(result.recommendedShares).toBe(0);
    expect(result.afterQuantity).toBe(100);
    expect((result.evidence as { planRationale?: string }).planRationale).toContain(
      "EXIT"
    );
  });

  it("本人確認済みの APPROVED 数量は後から自動改写しない", () => {
    const approved = item({ status: "APPROVED", recommendedShares: 100 });
    const [result] = applyLiveSellDiscipline(
      [approved],
      [smallJapanesePosition]
    );
    expect(result.direction).toBe("SELL");
    expect(result.recommendedShares).toBe(100);
  });
});

describe("resolveActionQueueDecisionNote", () => {
  it("理由なし見送は以前の备注を继承せず未记录にする", () => {
    expect(
      resolveActionQueueDecisionNote({
        decision: "SKIP",
        note: "   ",
        currentDecisionNote: "以前の备注",
      })
    ).toBeNull();
  });

  it("理由を書いた見送は前後空白を除いて固定する", () => {
    expect(
      resolveActionQueueDecisionNote({
        decision: "SKIP",
        note: "  次の決算まで待つ  ",
        currentDecisionNote: null,
      })
    ).toBe("次の決算まで待つ");
  });

  it("見送以外で备注省略时は既存备注を保持する", () => {
    expect(
      resolveActionQueueDecisionNote({
        decision: "APPROVE",
        currentDecisionNote: "確認済み",
      })
    ).toBe("確認済み");
  });
});
