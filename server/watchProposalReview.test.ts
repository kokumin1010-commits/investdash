import { describe, expect, it } from "vitest";
import { buildConfirmedWatchPlan } from "./services/watchProposalService";

const proposal = {
  limitPrice: "48.5",
  amountBase: "500000",
  rationale: "利益率の回復を確認しながら検討する。",
  buyConditions: "決算で利益率改善を確認する",
  invalidation: "ガイダンスが再度下方修正された場合",
  stance: "BUY" as const,
};

describe("watch proposal confirmation", () => {
  it("builds an accepted plan from the saved AI draft", () => {
    expect(buildConfirmedWatchPlan(proposal, { proposalId: 1, decision: "ACCEPT" })).toEqual({
      targetPrice: 48.5,
      plannedAmount: 500000,
      watchReason: proposal.rationale,
      buyConditions: "決算で利益率改善を確認する\n判断を見直す条件: ガイダンスが再度下方修正された場合",
      priority: "HIGH",
      status: "ACCEPTED",
    });
  });

  it("uses user-edited values and records EDITED", () => {
    expect(
      buildConfirmedWatchPlan(proposal, {
        proposalId: 1,
        decision: "EDIT",
        targetPrice: 45,
        plannedAmount: 300000,
        watchReason: "自分で確認した理由",
        buyConditions: "45ドル以下かつ次回決算後",
      })
    ).toEqual({
      targetPrice: 45,
      plannedAmount: 300000,
      watchReason: "自分で確認した理由",
      buyConditions: "45ドル以下かつ次回決算後",
      priority: "HIGH",
      status: "EDITED",
    });
  });
});
