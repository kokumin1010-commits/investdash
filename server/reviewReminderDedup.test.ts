import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSchedulerRuns: vi.fn(),
}));

vi.mock("./services/schedulerRunLog", () => ({
  listSchedulerRuns: mocks.listSchedulerRuns,
}));

vi.mock("./services/portfolio", () => ({
  buildPortfolio: vi.fn(),
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn(),
}));

import { hasSuccessfulReviewReminderRun } from "./services/reviewReminder";

describe("review reminder dedup", () => {
  beforeEach(() => {
    mocks.listSchedulerRuns.mockReset();
  });

  it("same JST date success prevents duplicate delivery", async () => {
    mocks.listSchedulerRuns.mockResolvedValue([
      { detailJson: { dateKey: "2026-08-29", sent: true } },
    ]);
    await expect(
      hasSuccessfulReviewReminderRun(1, new Date("2026-08-29T10:00:00.000Z"))
    ).resolves.toBe(true);
    expect(mocks.listSchedulerRuns).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        kind: "review_reminder",
        status: "SUCCESS",
      })
    );
  });

  it("different date or failed run remains retryable", async () => {
    mocks.listSchedulerRuns.mockResolvedValue([
      { detailJson: { dateKey: "2026-08-28", sent: true } },
    ]);
    await expect(
      hasSuccessfulReviewReminderRun(1, new Date("2026-08-29T10:00:00.000Z"))
    ).resolves.toBe(false);
  });
});
