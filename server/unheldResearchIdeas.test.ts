import { describe, expect, it } from "vitest";
import {
  selectUnheldResearchIdeas,
  UNHELD_RESEARCH_POOL_LIMIT,
  type UnheldResearchIdeaInput,
} from "../shared/unheldResearchIdeas";

function idea(
  symbol: string,
  overrides: Partial<UnheldResearchIdeaInput> = {}
): UnheldResearchIdeaInput {
  return {
    symbol,
    name: `${symbol} company`,
    market: "US",
    track: "EXPAND",
    basedOn: "Semiconductors",
    gapKind: "SECTOR",
    reason: "既存の関心分野に近いが、収益源が異なるため研究する",
    concern: "景気循環と顧客集中を確認する必要がある",
    priority: "MEDIUM",
    priceAtSuggestion: 100,
    targetPrice: 85,
    targetBasis: "過去の調整局面",
    currency: "USD",
    sector: "Technology",
    industry: "Semiconductors",
    addedToWatchlist: false,
    dismissed: false,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

describe("selectUnheldResearchIdeas", () => {
  it("全账户已持有、观察中、已加入和已拒绝的候补を除外する", () => {
    const result = selectUnheldResearchIdeas(
      [
        idea("HELD"),
        idea("WATCHED"),
        idea("ADDED", { addedToWatchlist: true }),
        idea("DISMISSED", { dismissed: true }),
        idea("NEW"),
      ],
      ["held"],
      ["watched"]
    );
    expect(result.map(row => row.symbol)).toEqual(["NEW"]);
    expect(result[0].nextAction).toContain("ウォッチリスト");
    expect(result[0].missingChecks).toContain("企業資料の再確認");
  });

  it("同一symbolは最新记录だけを残し、优先度と来源で稳定排序する", () => {
    const result = selectUnheldResearchIdeas(
      [
        idea("DUP", { reason: "旧", createdAt: new Date("2026-08-01T00:00:00Z") }),
        idea("DUP", { reason: "新", createdAt: new Date("2026-09-02T00:00:00Z") }),
        idea("LOW", { priority: "LOW" }),
        idea("FILL", { priority: "HIGH", track: "FILL", basedOn: null }),
        idea("EXPAND", { priority: "HIGH" }),
      ],
      [],
      []
    );
    expect(result.map(row => row.symbol)).toEqual(["EXPAND", "FILL", "DUP", "LOW"]);
    expect(result.find(row => row.symbol === "DUP")?.reason).toBe("新");
  });

  it("研究候补は最大30件に制限する", () => {
    const result = selectUnheldResearchIdeas(
      Array.from({ length: 35 }, (_, index) => idea(`IDEA${index + 1}`)),
      [],
      []
    );
    expect(result).toHaveLength(UNHELD_RESEARCH_POOL_LIMIT);
  });
});
