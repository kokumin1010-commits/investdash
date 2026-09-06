import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, updateSettings: mocks.updateSettings };
});

import { appRouter } from "./routers";

function createCaller(userId = 37) {
  const now = new Date();
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: `goal-user-${userId}`,
      email: "goal@example.com",
      name: "Goal Test",
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
  mocks.updateSettings.mockResolvedValue({ id: 1 });
});

describe("portfolio.updateSettings long-term goal", () => {
  it("persists the authenticated user's 2030 asset target and optional income targets", async () => {
    await createCaller(37).portfolio.updateSettings({
      longTermTargetNetAssetsJpy: 100_000_000_000,
      longTermTargetDate: "2030-12-31",
      longTermTargetAnnualDividendJpy: null,
      longTermTargetAnnualInterestJpy: null,
      longTermTargetAnnualNetCashJpy: 50_000_000,
    });

    expect(mocks.updateSettings).toHaveBeenCalledWith(
      37,
      expect.objectContaining({
        longTermTargetNetAssetsJpy: "100000000000",
        longTermTargetDate: "2030-12-31",
        longTermTargetAnnualDividendJpy: null,
        longTermTargetAnnualInterestJpy: null,
        longTermTargetAnnualNetCashJpy: "50000000",
        longTermTargetUpdatedAt: expect.any(Date),
      })
    );
  });

  it("rejects malformed dates and non-positive asset targets", async () => {
    await expect(
      createCaller().portfolio.updateSettings({
        longTermTargetDate: "2030/12/31",
      })
    ).rejects.toThrow();
    await expect(
      createCaller().portfolio.updateSettings({
        longTermTargetNetAssetsJpy: 0,
      })
    ).rejects.toThrow();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
