import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  listSchedulerRuns: vi.fn(),
  withSchedulerRunLog: vi.fn(),
  draftMissingCards: vi.fn(),
  runMissingBandChecksBatch: vi.fn(),
}));

vi.mock("./services/schedulerRunLog", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/schedulerRunLog")>();
  return {
    ...actual,
    listSchedulerRuns: mocks.listSchedulerRuns,
    withSchedulerRunLog: mocks.withSchedulerRunLog,
  };
});

vi.mock("./services/cardService", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/cardService")>();
  return { ...actual, draftMissingCards: mocks.draftMissingCards };
});

vi.mock("./services/priceBandService", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/priceBandService")>();
  return { ...actual, runMissingBandChecksBatch: mocks.runMissingBandChecksBatch };
});

import { appRouter } from "./routers";

function createCaller() {
  const now = new Date();
  const ctx: TrpcContext = {
    user: {
      id: 1,
      openId: "route-test-user",
      email: "route@example.com",
      name: "Route Test",
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
  mocks.withSchedulerRunLog.mockImplementation(async params => params.run());
});

describe("运用与批处理路由", () => {
  it("schedulerRuns 传递任务、状态、触发来源与时间筛选并返回统计", async () => {
    const from = new Date("2026-08-20T00:00:00Z");
    const rows = [
      { id: 1, status: "SUCCESS" },
      { id: 2, status: "FAILED" },
      { id: 3, status: "PARTIAL" },
    ];
    mocks.listSchedulerRuns.mockResolvedValue(rows);

    const result = await createCaller().portfolio.schedulerRuns({
      kind: "band_check_backfill",
      status: "FAILED",
      trigger: "MANUAL",
      from,
      limit: 20,
    });

    expect(mocks.listSchedulerRuns).toHaveBeenCalledWith(1, {
      kind: "band_check_backfill",
      status: "FAILED",
      trigger: "MANUAL",
      from,
      limit: 20,
    });
    expect(result.stats).toEqual({ total: 3, success: 1, partial: 1, failed: 1, running: 0 });
    expect(result.kinds).toContain("investment_card_backfill");
  });

  it("draftMissingCards 限制为 4 个并以 MANUAL 触发写运行日志", async () => {
    const batch = {
      total: 112,
      processed: 4,
      created: 4,
      skipped: 0,
      failed: [],
      errors: [],
      deferred: [],
      remaining: 108,
      quotaExhausted: false,
    };
    mocks.draftMissingCards.mockResolvedValue(batch);

    const result = await createCaller().portfolio.draftMissingCards({
      batchSize: 4,
      retryFailed: true,
    });

    expect(result).toEqual(batch);
    expect(mocks.draftMissingCards).toHaveBeenCalledWith(1, {
      batchSize: 4,
      retryFailed: true,
    });
    expect(mocks.withSchedulerRunLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, kind: "investment_card_backfill", trigger: "MANUAL" })
    );
    await expect(
      createCaller().portfolio.draftMissingCards({ batchSize: 5, retryFailed: false })
    ).rejects.toThrow();
  });

  it("runMissingBandChecks 返回项目数并以 MANUAL 触发写运行日志", async () => {
    const batch = {
      total: 51,
      processed: 2,
      checked: 2,
      itemsChecked: 5,
      failed: [],
      errors: [],
      deferred: [],
      remaining: 49,
      quotaExhausted: false,
    };
    mocks.runMissingBandChecksBatch.mockResolvedValue(batch);

    const result = await createCaller().portfolio.runMissingBandChecks({
      batchSize: 2,
      retryFailed: false,
    });

    expect(result.itemsChecked).toBe(5);
    expect(mocks.runMissingBandChecksBatch).toHaveBeenCalledWith(1, {
      batchSize: 2,
      retryFailed: false,
    });
    expect(mocks.withSchedulerRunLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, kind: "band_check_backfill", trigger: "MANUAL" })
    );
    await expect(
      createCaller().portfolio.runMissingBandChecks({ batchSize: 4, retryFailed: false })
    ).rejects.toThrow();
  });
});
