// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PriceBandPlanCard } from "../client/src/components/investing/PriceBandPlanCard";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("价格带确认结果 UI", () => {
  it("无新闻时显示信息不足、JST 时间、0 件证据和非安全提示", () => {
    const band = {
      id: 26,
      lowerPrice: 190,
      upperPrice: 220,
      action: "ADD_SMALL" as const,
      actionLabel: "小幅買い増しを検討",
      reason: "現在の価格帯を確認",
      checkItems: ["AI向け受注動向"],
      plannedAmount: null,
      sortOrder: 1,
      checks: [
        {
          checkItem: "AI向け受注動向",
          status: "UNKNOWN" as const,
          finding: "この銘柄のニュースが未取得のため確認できません。",
          sourceCount: 0,
          sources: [],
          checkedAt: new Date("2026-08-25T19:37:00Z"),
        },
      ],
    };
    const plan = {
      id: 9,
      symbol: "NVDA",
      currency: "USD",
      strategy: "段階的に確認する",
      rationale: "価格とニュースを併用",
      model: "gemini-3-flash-preview",
      editedByUser: false,
      generatedAt: new Date("2026-08-25T18:00:00Z"),
      bands: [band],
      currentPrice: 212.31,
      evaluation: {
        currentBand: band,
        abovePlan: false,
        belowPlan: false,
        nextBand: null,
        gapToNextPct: null,
        nextBandPrice: null,
      },
    };

    render(
      React.createElement(PriceBandPlanCard, {
        plan,
        isGenerating: false,
        onGenerate: vi.fn(),
        onRunChecks: vi.fn(),
        isCheckingBandId: null,
      })
    );

    expect(screen.getByText("情報不足")).toBeTruthy();
    expect(screen.getByText("根拠ニュース 0 件", { exact: false })).toBeTruthy();
    expect(screen.getByText("安全を意味しません。", { exact: false })).toBeTruthy();
    expect(screen.getByText("08/26 04:37 JST", { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "確認をやり直す" })).toBeTruthy();
  });
});
