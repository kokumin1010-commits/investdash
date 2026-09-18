/** @vitest-environment jsdom */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const history = [
  {
    jobId: 21,
    broker: "moomoo_jp" as const,
    asOfDate: "2026-09-18",
    createdAt: new Date("2026-09-18T15:10:00.000Z"),
    appliedCount: 28,
    holdingCount: 27,
    accountCashCount: 1,
    interestCount: 0,
    dividendCount: 0,
    images: [
      { index: 0, fileName: "IMG_8822.PNG", digest: "a" },
      { index: 1, fileName: "IMG_8823.PNG", digest: "b" },
      { index: 2, fileName: "IMG_8824.PNG", digest: "c" },
    ],
  },
  {
    jobId: 22,
    broker: "sc_sg" as const,
    asOfDate: "2026-09-17",
    createdAt: new Date("2026-09-18T16:10:00.000Z"),
    appliedCount: 1,
    holdingCount: 0,
    accountCashCount: 1,
    interestCount: 0,
    dividendCount: 0,
    images: [{ index: 0, fileName: "IMG_8828.PNG", digest: "d" }],
  },
];

vi.mock("@/lib/trpc", () => ({
  trpc: {
    import: {
      history: {
        useQuery: () => ({ data: history, isLoading: false, error: null }),
      },
    },
  },
}));

vi.mock("@/lib/passcodeSession", () => ({
  getStoredToken: () => "private-token",
}));

import { ScreenshotHistoryCard } from "../client/src/components/investing/ScreenshotHistoryCard";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["image"], { type: "image/webp" }),
    })
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:test-image"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScreenshotHistoryCard", () => {
  it("shows saved images separately by broker and evidence date", async () => {
    render(<ScreenshotHistoryCard />);

    expect(screen.getByText("スクリーンショット履歴")).toBeTruthy();
    expect(screen.getByText("パスコード保護")).toBeTruthy();
    expect(screen.getByText("moomoo 日本版")).toBeTruthy();
    expect(screen.getByText("渣打銀行 シンガポール")).toBeTruthy();
    expect(screen.getByText("2026-09-18")).toBeTruthy();
    expect(screen.getByText("2026-09-17")).toBeTruthy();
    expect(
      screen.getByText("保有 27・現金 1・3枚・取込 9/19 00:10")
    ).toBeTruthy();
    expect(screen.getByText("現金 1・1枚・取込 9/19 01:10")).toBeTruthy();

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/import-evidence/22/0"),
      expect.objectContaining({
        headers: { Authorization: "Bearer private-token" },
      })
    );
  });

  it("opens a protected full-size preview without exposing a raw storage URL", async () => {
    render(<ScreenshotHistoryCard />);
    fireEvent.click(screen.getByRole("button", { name: /IMG_8828.PNG/ }));

    expect(
      await screen.findByText("保存済み原画像", { exact: false })
    ).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("/files/9-imports/");
  });
});
