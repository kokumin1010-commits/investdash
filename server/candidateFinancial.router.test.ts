import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  buildCandidateCardInsights: vi.fn(),
}));

vi.mock("./services/candidateFinancialService", () => ({
  buildCandidateCardInsights: mocks.buildCandidateCardInsights,
}));

import { appRouter } from "./routers";

function createCaller(userId = 37) {
  const now = new Date();
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: `candidate-user-${userId}`,
      email: "candidate@example.com",
      name: "Candidate Test",
      loginMethod: "passcode",
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildCandidateCardInsights.mockResolvedValue([]);
});

describe("portfolio.candidateCardInsights", () => {
  it("passes only the authenticated user id and requested symbols to the batch service", async () => {
    await createCaller(37).portfolio.candidateCardInsights({
      symbols: ["TXN", "6954.T"],
    });

    expect(mocks.buildCandidateCardInsights).toHaveBeenCalledTimes(1);
    expect(mocks.buildCandidateCardInsights).toHaveBeenCalledWith(
      37,
      ["TXN", "6954.T"]
    );
  });

  it("keeps requests from different users isolated", async () => {
    await createCaller(37).portfolio.candidateCardInsights({ symbols: ["TXN"] });
    await createCaller(88).portfolio.candidateCardInsights({ symbols: ["D"] });

    expect(mocks.buildCandidateCardInsights.mock.calls).toEqual([
      [37, ["TXN"]],
      [88, ["D"]],
    ]);
  });

  it("rejects more than 60 symbols before running the service", async () => {
    await expect(
      createCaller().portfolio.candidateCardInsights({
        symbols: Array.from({ length: 61 }, (_, index) => `TEST${index}`),
      })
    ).rejects.toThrow();

    expect(mocks.buildCandidateCardInsights).not.toHaveBeenCalled();
  });
});
