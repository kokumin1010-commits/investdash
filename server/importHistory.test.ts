import { describe, expect, it } from "vitest";
import type { BrokerCashSnapshot, ImportJob } from "../drizzle/schema";
import {
  getImportEvidenceAt,
  summarizeImportJob,
} from "./services/importHistory";

function makeJob(patch: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 77,
    userId: 9,
    fileKey: "9-imports/fallback_abcd1234.webp",
    imageUrl: "/investdash/files/9-imports/fallback_abcd1234.webp",
    status: "APPLIED",
    parsed: {
      rows: [{ mode: "UPDATE" }, { mode: "SKIP" }],
      evidence: [
        {
          fileName: "cash.webp",
          fileKey: "9-imports/cash_1234abcd.webp",
          imageUrl: "/investdash/files/9-imports/cash_1234abcd.webp",
          digest: "digest-1",
        },
      ],
      cashIncomeDraft: {
        uploadDate: "2026-09-19",
        accountCash: {
          mode: "APPLY",
          broker: "sc_sg",
          asOfDate: "2026-09-18",
        },
        interestAssets: [],
        dividendIncomes: [],
      },
    },
    accountSummary: { broker: "Standard Chartered" },
    errorMessage: null,
    appliedCount: 2,
    createdAt: new Date("2026-09-18T16:00:00.000Z"),
    updatedAt: new Date("2026-09-18T16:01:00.000Z"),
    ...patch,
  };
}

function makeCashSnapshot(): BrokerCashSnapshot {
  return {
    id: 12,
    userId: 9,
    broker: "sc_sg",
    currency: "SGD",
    asOfDate: "2026-09-17",
    cashBalance: "40455.0100",
    source: "SCREENSHOT_CONFIRMED",
    sourceReference: "import-job:77:cash:draft-key",
    evidenceDigest: null,
    capturedAt: new Date("2026-09-18T16:10:00.000Z"),
    createdAt: new Date("2026-09-18T16:10:00.000Z"),
    updatedAt: new Date("2026-09-18T16:10:00.000Z"),
  };
}

describe("screenshot import history", () => {
  it("returns only safe image indexes and uses the confirmed cash checkpoint date", () => {
    const item = summarizeImportJob(makeJob(), {
      cashSnapshot: makeCashSnapshot(),
    });

    expect(item).toEqual(
      expect.objectContaining({
        jobId: 77,
        broker: "sc_sg",
        asOfDate: "2026-09-17",
        holdingCount: 1,
        accountCashCount: 1,
        images: [{ index: 0, fileName: "cash.webp", digest: "digest-1" }],
      })
    );
    expect(item).not.toHaveProperty("fileKey");
    expect(item).not.toHaveProperty("imageUrl");
  });

  it("keeps draft and failed jobs out of the saved screenshot history", () => {
    expect(summarizeImportJob(makeJob({ status: "PARSED" }))).toBeNull();
    expect(summarizeImportJob(makeJob({ status: "FAILED" }))).toBeNull();
  });

  it("allows image access only for an applied job and a valid image index", () => {
    expect(getImportEvidenceAt(makeJob(), 0)?.fileKey).toBe(
      "9-imports/cash_1234abcd.webp"
    );
    expect(getImportEvidenceAt(makeJob(), 1)).toBeNull();
    expect(getImportEvidenceAt(makeJob({ status: "PARSED" }), 0)).toBeNull();
  });
});
