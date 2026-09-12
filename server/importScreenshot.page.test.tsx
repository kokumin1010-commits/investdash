/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseInput: vi.fn(),
  applyInput: vi.fn(),
  invalidate: vi.fn(),
  setLocation: vi.fn(),
}));

const cashIncomeDraft = {
  batchKey: "7a60b11cd84b6bd94a8aa1549b5127b9",
  uploadDate: "2026-09-13",
  model: "gemini-3.1-pro-preview",
  evidence: [
    {
      fileName: "futu-fund.webp",
      fileKey: "imports/futu-fund.webp",
      imageUrl: "https://example.invalid/futu-fund.webp",
      digest: "abc",
    },
  ],
  interestAssets: [
    {
      draftKey: "a860b11cd84b6bd94a8aa1549b5127b",
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
      existingInterestAssetId: 7,
      previousCumulativeIncome: 697.62,
      previousAsOfDate: "2026-08-24",
      periodIncome: 202.38,
      deltaStatus: "READY" as const,
      issues: [],
    },
  ],
  dividendIncomes: [
    {
      draftKey: "b960b11cd84b6bd94a8aa1549b5127b",
      mode: "APPLY" as const,
      broker: "futu_hk" as const,
      symbol: "TXN",
      name: "Texas Instruments Dividend",
      currency: "USD",
      grossAmount: null,
      taxAmount: null,
      feeAmount: null,
      netAmount: 84,
      occurredOn: "2026-09-10",
      confidence: 96,
      evidence: "Dividend USD 84 Settled",
      issues: ["税前額は画面にないため未取得のまま保存します"],
    },
  ],
};

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ invalidate: mocks.invalidate }),
    import: {
      formats: {
        useQuery: () => ({
          data: [
            { id: "futu_hk", label: "富途證券 香港", verified: true },
            { id: "generic", label: "その他", verified: false },
          ],
        }),
      },
      parseScreenshots: {
        useMutation: (options: { onSuccess: (value: unknown) => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            mocks.parseInput(input);
            options.onSuccess({
              jobId: 77,
              rows: [],
              account: { netAssets: null, cash: null, currency: null, broker: "富途證券 香港" },
              warnings: [],
              cashIncomeDraft,
              evidence: cashIncomeDraft.evidence,
              model: cashIncomeDraft.model,
              formatId: "futu_hk",
              detectedFormatId: "futu_hk",
            });
          },
        }),
      },
      applyRows: {
        useMutation: (options: { onSuccess: (value: unknown) => Promise<void> }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            mocks.applyInput(input);
            void options.onSuccess({
              created: 0,
              updated: 0,
              skipped: [],
              cashIncomeResult: {
                interestAssetsSaved: 1,
                interestIncomeRecordsSaved: 1,
                dividendRecordsSaved: 1,
                skipped: [],
              },
              executionCheck: null,
              actionQueueCheck: null,
              snapshot: null,
            });
          },
        }),
      },
    },
  },
}));

vi.mock("@/lib/imageFile", () => ({
  looksLikeImage: () => true,
  prepareImage: async (file: File) => ({
    dataUrl: "data:image/webp;base64,AAAA",
    fileName: file.name,
    byteSize: 4,
  }),
}));

vi.mock("@/components/investing/MonthlyHistoryCard", () => ({
  MonthlyHistoryCard: () => null,
}));

vi.mock("@/components/investing/DisclaimerNote", () => ({
  DisclaimerNote: () => null,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/import", mocks.setLocation],
}));

import ImportScreenshot from "../client/src/pages/ImportScreenshot";

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem("investdesk.import.format", "futu_hk");
});

describe("ImportScreenshot cash income flow", () => {
  it("持仓0行でも现金宝と实际配当の草稿を確認して同じ任务へ保存する", async () => {
    render(<ImportScreenshot />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "futu-fund.webp", { type: "image/webp" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "読み取りを開始" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "読み取りを開始" }));

    await waitFor(() => {
      expect(screen.getByText("キャッシュ収入の自動計算")).toBeTruthy();
    });
    expect(screen.getByText("USD 202.38")).toBeTruthy();
    expect(screen.getByText("ネット入金のみ取得")).toBeTruthy();
    expect(
      screen.getByText("保有 0 件・キャッシュ収入 2 件を保存します")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(mocks.applyInput).toHaveBeenCalledTimes(1));
    expect(mocks.applyInput).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 77,
        batchKey: cashIncomeDraft.batchKey,
        rows: [],
        formatId: "futu_hk",
        interestAssets: [
          expect.objectContaining({
            draftKey: cashIncomeDraft.interestAssets[0].draftKey,
            cumulativeIncome: 900,
            asOfDate: "2026-09-13",
            mode: "APPLY",
          }),
        ],
        dividendIncomes: [
          expect.objectContaining({
            draftKey: cashIncomeDraft.dividendIncomes[0].draftKey,
            grossAmount: null,
            netAmount: 84,
            occurredOn: "2026-09-10",
            mode: "APPLY",
          }),
        ],
      })
    );
    await waitFor(() => expect(mocks.setLocation).toHaveBeenCalledWith("/"));
  });
});

