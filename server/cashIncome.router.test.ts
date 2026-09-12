import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  upsertInterestAsset: vi.fn(),
  upsertInterestAssetIncomeSnapshot: vi.fn(),
  insertCashIncomeRecord: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    upsertInterestAsset: mocks.upsertInterestAsset,
    upsertInterestAssetIncomeSnapshot: mocks.upsertInterestAssetIncomeSnapshot,
    insertCashIncomeRecord: mocks.insertCashIncomeRecord,
    getSettings: mocks.getSettings,
  };
});

import { appRouter } from "./routers";

function createCaller(userId = 37) {
  const now = new Date("2026-09-13T00:00:00.000Z");
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: `income-user-${userId}`,
      email: "income@example.com",
      name: "Income Test",
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
  mocks.upsertInterestAsset.mockResolvedValue(91);
  mocks.upsertInterestAssetIncomeSnapshot.mockResolvedValue(undefined);
  mocks.insertCashIncomeRecord.mockResolvedValue(123);
  mocks.getSettings.mockResolvedValue({
    usdJpyRate: "150.00",
    sgdJpyRate: "115.00",
    hkdJpyRate: "19.20",
  });
});

describe("portfolio cash income routes", () => {
  it("现金宝保存时为认证用户追加真实日息快照并固定当时FX", async () => {
    await createCaller(37).portfolio.saveInterestAsset({
      broker: "futu_hk",
      name: "USD Money Market Fund",
      currency: "usd",
      amount: 100_000,
      annualRatePct: 3.4,
      dailyIncome: 10,
      cumulativeIncome: 500,
      compounding: true,
    });

    expect(mocks.upsertInterestAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 37,
        currency: "USD",
        dailyIncome: "10",
        cumulativeIncome: "500",
      })
    );
    expect(mocks.upsertInterestAssetIncomeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 37,
        interestAssetId: 91,
        currency: "USD",
        fxRateJpy: "150",
        dailyIncome: "10",
        source: "MANUAL_CAPTURE",
      })
    );
  });

  it("实际股息到账使用认证用户、净额、固定FX和客户端请求ID去重", async () => {
    const requestId = "c7b7ad37-2545-47af-b67d-86dd6eea6da0";
    await createCaller(88).portfolio.recordDividendIncome({
      requestId,
      occurredOn: "2026-09-10",
      broker: "ibkr",
      symbol: "txn",
      name: "Texas Instruments dividend",
      currency: "usd",
      grossAmount: 100,
      taxAmount: 15,
      feeAmount: 1,
    });

    expect(mocks.insertCashIncomeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 88,
        kind: "DIVIDEND",
        status: "SETTLED",
        occurredOn: "2026-09-10",
        symbol: "TXN",
        currency: "USD",
        grossAmount: "100",
        taxAmount: "15",
        feeAmount: "1",
        netAmount: "84",
        fxRateJpy: "150",
        dedupeKey: `manual:${requestId}`,
      })
    );
  });

  it("未知币种没有显式JPY汇率时拒绝，不写入伪造换算", async () => {
    await expect(
      createCaller().portfolio.recordDividendIncome({
        requestId: "cc67b42f-ae9a-4aea-bfd9-f6e55ad342da",
        occurredOn: "2026-09-10",
        broker: "other",
        name: "EUR dividend",
        currency: "EUR",
        grossAmount: 100,
        taxAmount: 0,
        feeAmount: 0,
      })
    ).rejects.toThrow("EUR のJPY換算レートを入力してください");

    expect(mocks.insertCashIncomeRecord).not.toHaveBeenCalled();
  });
});
