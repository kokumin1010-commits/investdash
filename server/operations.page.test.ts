// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useSchedulerRuns: vi.fn(),
  useSystemEvents: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    portfolio: {
      schedulerRuns: { useQuery: mocks.useSchedulerRuns },
      systemEvents: { useQuery: mocks.useSystemEvents },
    },
  },
}));

import Operations from "../client/src/pages/Operations";

beforeEach(() => {
  vi.stubGlobal("React", React);
  mocks.useSchedulerRuns.mockReturnValue({
    data: {
      kinds: ["price_sync_jp", "investment_card_backfill", "band_check_backfill"],
      stats: { total: 2, success: 1, partial: 0, failed: 1, running: 0 },
      rows: [
        {
          id: 2,
          kind: "investment_card_backfill",
          trigger: "SCHEDULED",
          status: "SUCCESS",
          processed: 2,
          succeeded: 2,
          failed: 0,
          skipped: 0,
          remaining: 110,
          detailJson: { quotaExhausted: false },
          errorMessage: null,
          startedAt: new Date("2026-08-25T18:40:00Z"),
          finishedAt: new Date("2026-08-25T18:40:20Z"),
          createdAt: new Date("2026-08-25T18:40:00Z"),
          userId: 1,
        },
        {
          id: 1,
          kind: "band_check_backfill",
          trigger: "MANUAL",
          status: "FAILED",
          processed: 1,
          succeeded: 0,
          failed: 1,
          skipped: 0,
          remaining: 51,
          detailJson: null,
          errorMessage: "429 quota exhausted",
          startedAt: new Date("2026-08-25T18:20:00Z"),
          finishedAt: new Date("2026-08-25T18:20:01Z"),
          createdAt: new Date("2026-08-25T18:20:00Z"),
          userId: 1,
        },
      ],
    },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: mocks.refetch,
  });
  mocks.useSystemEvents.mockReturnValue({
    data: [{
      id: 1,
      userId: 1,
      source: "APP",
      kind: "MEMORY_THRESHOLD",
      severity: "WARNING",
      eventKey: "memory:warning:1",
      title: "メモリ使用率 WARNING",
      message: "cgroup 82% / RSS 1024",
      details: null,
      occurredAt: new Date("2026-08-27T08:00:00Z"),
      resolvedAt: null,
      createdAt: new Date("2026-08-27T08:00:00Z"),
    }],
    refetch: mocks.refetch,
  });
});

afterEach(() => cleanup());

describe("运用履历页面", () => {
  it("显示任务结果、失败原因、四个筛选器和移动端卡片内容", () => {
    render(React.createElement(Operations));
    expect(screen.getByRole("heading", { name: "運用履歴" })).toBeTruthy();
    expect(screen.getAllByText("投資カード補完").length).toBeGreaterThan(0);
    expect(screen.getAllByText("価格帯確認").length).toBeGreaterThan(0);
    expect(screen.getAllByText("429 quota exhausted").length).toBeGreaterThan(0);
    expect(screen.getByText("メモリ使用率 WARNING")).toBeTruthy();
    expect(screen.getAllByRole("combobox")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /更新/ })).toBeTruthy();
  });
});
