import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getImportJob: vi.fn(),
  listInterestAssets: vi.fn(),
  listInterestAssetIncomeSnapshots: vi.fn(),
  getSettings: vi.fn(),
  upsertInterestAsset: vi.fn(),
  upsertInterestAssetIncomeSnapshot: vi.fn(),
  insertCashIncomeRecord: vi.fn(),
  updateImportJob: vi.fn(),
  saveMonthlySnapshot: vi.fn(),
  checkExecutions: vi.fn(),
  reconcileApprovedActionQueue: vi.fn(),
}));

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getImportJob: mocks.getImportJob,
    listInterestAssets: mocks.listInterestAssets,
    listInterestAssetIncomeSnapshots: mocks.listInterestAssetIncomeSnapshots,
    getSettings: mocks.getSettings,
    upsertInterestAsset: mocks.upsertInterestAsset,
    upsertInterestAssetIncomeSnapshot: mocks.upsertInterestAssetIncomeSnapshot,
    insertCashIncomeRecord: mocks.insertCashIncomeRecord,
    updateImportJob: mocks.updateImportJob,
  };
});

vi.mock("./services/monthlySnapshotService", async importOriginal => {
  const actual = await importOriginal<
    typeof import("./services/monthlySnapshotService")
  >();
  return { ...actual, saveMonthlySnapshot: mocks.saveMonthlySnapshot };
});

vi.mock("./services/outcomeService", async importOriginal => {
  const actual = await importOriginal<typeof import("./services/outcomeService")>();
  return { ...actual, checkExecutions: mocks.checkExecutions };
});

vi.mock("./services/actionQueueService", async importOriginal => {
  const actual = await importOriginal<
    typeof import("./services/actionQueueService")
  >();
  return {
    ...actual,
    reconcileApprovedActionQueue: mocks.reconcileApprovedActionQueue,
  };
});

import { appRouter } from "./routers";

const batchKey = "7a60b11cd84b6bd94a8aa1549b5127b9";
const interestKey = "a860b11cd84b6bd94a8aa1549b5127b";
const dividendKey = "b960b11cd84b6bd94a8aa1549b5127b";

function caller(userId = 51) {
  const now = new Date("2026-09-13T00:00:00.000Z");
  const ctx: TrpcContext = {
    user: {
      id: userId,
      openId: `screenshot-${userId}`,
      email: "screenshot@example.com",
      name: "Screenshot Test",
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

function parsedJob(status: "PARSED" | "APPLIED" = "PARSED") {
  return {
    id: 77,
    userId: 51,
    status,
    parsed: {
      cashIncomeDraft: {
        batchKey,
        interestAssets: [{ draftKey: interestKey }],
        dividendIncomes: [{ draftKey: dividendKey }],
      },
    },
  };
}

function baseInput() {
  return {
    jobId: 77,
    batchKey,
    rows: [],
    formatId: "futu_hk" as const,
    cashBalance: null,
    interestAssets: [],
    dividendIncomes: [],
  };
}

function interestDraft() {
  return {
    draftKey: interestKey,
    mode: "APPLY" as const,
    broker: "futu_hk" as const,
    name: "易方達(香港)美元貨幣市場基金",
    currency: "USD",
    amount: 145_500,
    annualRatePct: 3.4,
    dailyIncome: 8.7,
    cumulativeIncome: 900,
    asOfDate: "2026-09-13",
    dateSource: "SCREEN" as const,
    confidence: 98,
    evidence: "累計収益 USD 900",
  };
}

function dividendDraft(currency = "USD") {
  return {
    draftKey: dividendKey,
    mode: "APPLY" as const,
    broker: "ibkr" as const,
    symbol: "TXN",
    name: "Texas Instruments Dividend",
    currency,
    grossAmount: null,
    taxAmount: null,
    feeAmount: null,
    netAmount: 84,
    occurredOn: "2026-09-10",
    confidence: 96,
    evidence: "Dividend USD 84 Settled",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getImportJob.mockResolvedValue(parsedJob());
  mocks.listInterestAssets.mockResolvedValue([
    {
      id: 7,
      userId: 51,
      broker: "futu_hk",
      name: "易方達(香港)美元貨幣市場基金",
      currency: "USD",
      cumulativeIncome: "697.62",
      capturedAt: new Date("2026-08-25T04:41:08Z"),
    },
  ]);
  mocks.listInterestAssetIncomeSnapshots.mockResolvedValue([
    {
      interestAssetId: 7,
      broker: "futu_hk",
      name: "易方達(香港)美元貨幣市場基金",
      currency: "USD",
      incomeDate: "2026-08-24",
      cumulativeIncome: "697.62",
      capturedAt: new Date("2026-08-25T04:41:08Z"),
    },
  ]);
  mocks.getSettings.mockResolvedValue({
    usdJpyRate: "150",
    sgdJpyRate: "115",
    hkdJpyRate: "19.2",
  });
  mocks.upsertInterestAsset.mockResolvedValue(7);
  mocks.upsertInterestAssetIncomeSnapshot.mockResolvedValue(undefined);
  mocks.insertCashIncomeRecord.mockResolvedValue(501);
  mocks.updateImportJob.mockResolvedValue(undefined);
  mocks.saveMonthlySnapshot.mockResolvedValue(null);
  mocks.checkExecutions.mockResolvedValue(null);
  mocks.reconcileApprovedActionQueue.mockResolvedValue(null);
});

describe("screenshot cash income apply route", () => {
  it("认证用户确认后保存现金宝快照，并只把相邻累计差额写成实际利息", async () => {
    const result = await caller(51).import.applyRows({
      ...baseInput(),
      interestAssets: [interestDraft()],
    });

    expect(mocks.upsertInterestAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 51,
        broker: "futu_hk",
        currency: "USD",
        cumulativeIncome: "900",
      })
    );
    expect(mocks.upsertInterestAssetIncomeSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 51,
        interestAssetId: 7,
        incomeDate: "2026-09-13",
        source: "SCREENSHOT_CONFIRMED",
        fxRateJpy: "150",
      })
    );
    expect(mocks.insertCashIncomeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 51,
        kind: "INTEREST",
        grossAmount: null,
        netAmount: "202.38",
        source: "SCREENSHOT_CUMULATIVE_DELTA",
        dedupeKey: `screenshot:${batchKey}:interest:${interestKey}`,
      })
    );
    expect(result.cashIncomeResult).toMatchObject({
      interestAssetsSaved: 1,
      interestIncomeRecordsSaved: 1,
      dividendRecordsSaved: 0,
    });
  });

  it("只显示净入金的已结算股息保持税前额为空并固定当时FX", async () => {
    const result = await caller(51).import.applyRows({
      ...baseInput(),
      dividendIncomes: [dividendDraft()],
    });

    expect(mocks.insertCashIncomeRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 51,
        kind: "DIVIDEND",
        status: "SETTLED",
        symbol: "TXN",
        grossAmount: null,
        taxAmount: null,
        feeAmount: null,
        netAmount: "84",
        fxRateJpy: "150",
        source: "SCREENSHOT_CONFIRMED",
      })
    );
    expect(result.cashIncomeResult.dividendRecordsSaved).toBe(1);
  });

  it("未知币种没有JPY汇率时只跳过该股息，不写入伪造换算", async () => {
    const result = await caller(51).import.applyRows({
      ...baseInput(),
      dividendIncomes: [dividendDraft("EUR")],
    });

    expect(mocks.insertCashIncomeRecord).not.toHaveBeenCalled();
    expect(result.cashIncomeResult.skipped.join(" ")).toContain(
      "EURのJPY換算レートが未取得"
    );
  });

  it("草稿键不属于该用户导入任务时在任何收入写入前拒绝", async () => {
    await expect(
      caller(51).import.applyRows({
        ...baseInput(),
        dividendIncomes: [
          { ...dividendDraft(), draftKey: "ffffffffffffffffffffffffffffffff" },
        ],
      })
    ).rejects.toThrow("取込草稿と一致しない収入行");

    expect(mocks.insertCashIncomeRecord).not.toHaveBeenCalled();
    expect(mocks.upsertInterestAsset).not.toHaveBeenCalled();
  });

  it("响应丢失后重试使用相同幂等键，不生成第二种收入标识", async () => {
    mocks.getImportJob.mockResolvedValue(parsedJob("APPLIED"));
    const input = { ...baseInput(), dividendIncomes: [dividendDraft()] };

    await caller(51).import.applyRows(input);
    await caller(51).import.applyRows(input);

    expect(mocks.insertCashIncomeRecord).toHaveBeenCalledTimes(2);
    const first = mocks.insertCashIncomeRecord.mock.calls[0][0].dedupeKey;
    const second = mocks.insertCashIncomeRecord.mock.calls[1][0].dedupeKey;
    expect(first).toBe(`screenshot:${batchKey}:dividend:${dividendKey}`);
    expect(second).toBe(first);
  });
});

