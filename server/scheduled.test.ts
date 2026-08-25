import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateRequest,
  listAllUserIds,
  getSettings,
  pruneOldNews,
  syncNewsForUser,
  syncSymbolNotes,
} = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  listAllUserIds: vi.fn(),
  getSettings: vi.fn(),
  pruneOldNews: vi.fn(),
  syncNewsForUser: vi.fn(),
  syncSymbolNotes: vi.fn(),
}));

vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest } }));
vi.mock("./db", () => ({
  listAllUserIds,
  getSettings,
  pruneOldNews,
}));
vi.mock("./services/portfolio", () => ({
  syncNewsForUser,
  syncPrices: vi.fn(),
}));
vi.mock("./services/reportService", () => ({ createWeeklyReport: vi.fn() }));
vi.mock("./services/urgentReport", () => ({ createUrgentReports: vi.fn() }));
vi.mock("./services/bandTransitionService", () => ({ recordTransitions: vi.fn() }));
vi.mock("./services/symbolNoteService", () => ({ syncSymbolNotes }));
vi.mock("./services/cardService", () => ({ draftTriggeredCards: vi.fn() }));

import { syncNewsHandler } from "./scheduled";

function createResponse() {
  const result = { statusCode: 200, body: undefined as unknown };
  const response = {
    status(code: number) {
      result.statusCode = code;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  };
  return { response, result };
}

describe("scheduled news batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticateRequest.mockResolvedValue({ isCron: true, taskUid: "cron-test" });
    listAllUserIds.mockResolvedValue([1]);
    getSettings.mockResolvedValue({ autoNewsEnabled: true });
    pruneOldNews.mockResolvedValue(undefined);
    syncSymbolNotes.mockResolvedValue({ added: 0 });
    syncNewsForUser.mockResolvedValue({
      fetched: 3,
      analyzed: 3,
      analysisUnavailable: false,
      failedSymbols: [],
      total: 123,
      processed: 16,
      nextOffset: 16,
    });
  });

  it("maps batch 3 to offset 12 with four symbols per request", async () => {
    const { response, result } = createResponse();

    await syncNewsHandler(
      { params: { batch: "3" }, originalUrl: "/api/scheduled/syncNews/3" } as never,
      response as never
    );

    expect(syncNewsForUser).toHaveBeenCalledWith(1, { offset: 12, batchSize: 4 });
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ ok: true, batch: 3, offset: 12, batchSize: 4 });
  });

  it("rejects invalid batch parameters without running work", async () => {
    const { response, result } = createResponse();

    await syncNewsHandler(
      { params: { batch: "bad" }, originalUrl: "/api/scheduled/syncNews/bad" } as never,
      response as never
    );

    expect(result.statusCode).toBe(400);
    expect(syncNewsForUser).not.toHaveBeenCalled();
  });

  it("rejects an authenticated caller that is not a cron identity", async () => {
    authenticateRequest.mockResolvedValueOnce({ isCron: false });
    const { response, result } = createResponse();

    await syncNewsHandler(
      { params: { batch: "0" }, originalUrl: "/api/scheduled/syncNews/0" } as never,
      response as never
    );

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: "cron-only" });
    expect(syncNewsForUser).not.toHaveBeenCalled();
  });

  it("returns unauthorized when scheduled authentication throws", async () => {
    authenticateRequest.mockRejectedValueOnce(new Error("invalid cron cookie"));
    const { response, result } = createResponse();

    await syncNewsHandler(
      { params: { batch: "0" }, originalUrl: "/api/scheduled/syncNews/0" } as never,
      response as never
    );

    expect(result.statusCode).toBe(403);
    expect(result.body).toMatchObject({ error: "unauthorized" });
    expect(syncNewsForUser).not.toHaveBeenCalled();
  });
});
