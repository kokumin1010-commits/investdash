// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HoldingDurationSummary,
  SignalDecisionMeta,
  SignalQualityBadges,
} from "../client/src/components/investing/HoldingDecisionMeta";

afterEach(() => cleanup());
beforeEach(() => vi.stubGlobal("React", React));

describe("HoldingDetail 保有期間・AI シグナル", () => {
  it("保有期間の起算日、月次依据、资料质量、stale理由、条件与风险を显示", () => {
    const signal = {
      dataQuality: "STRONG" as const,
      freshness: { isStale: true, reasons: ["NEW_NEWS", "PRICE_MOVE"] as const, priceMovePct: 12 },
      validUntil: new Date("2026-09-05T00:00:00Z"),
      reviewTriggers: ["次回決算で通期見通しを確認"],
      riskFlags: ["株価が52週高値圏"],
    };
    render(
      React.createElement(React.Fragment, null,
        React.createElement(HoldingDurationSummary, {
          duration: { days: 3, startDate: new Date("2026-08-26T00:00:00Z"), confidence: "AT_LEAST", source: "MONTHLY_SNAPSHOT" },
        }),
        React.createElement(SignalQualityBadges, { signal }),
        React.createElement(SignalDecisionMeta, { signal })
      )
    );
    expect(screen.getByText("少なくとも 3日")).toBeTruthy();
    expect(screen.getByText(/月次記録/)).toBeTruthy();
    expect(screen.getByText("材料充足")).toBeTruthy();
    expect(screen.getByText("再分析待ち")).toBeTruthy();
    expect(screen.getByText(/分析後に新しいニュースあり/)).toBeTruthy();
    expect(screen.getAllByText(/次回決算で通期見通しを確認/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("次回確認")).toBeTruthy();
    expect(screen.getByText("AI目安")).toBeTruthy();
    expect(screen.getByText(/株価が52週高値圏/)).toBeTruthy();
  });

  it("最新信号は有效期限を显示", () => {
    const signal = {
      dataQuality: "MODERATE" as const,
      freshness: { isStale: false, reasons: [] as const, priceMovePct: 2 },
      validUntil: new Date("2026-09-05T00:00:00Z"),
      reviewTriggers: [],
      riskFlags: [],
    };
    render(React.createElement(SignalDecisionMeta, { signal }));
    expect(screen.getByText("次回確認")).toBeTruthy();
    expect(screen.getByText("AI目安")).toBeTruthy();
    expect(screen.getByText(/会社の決算発表予定日を示すものではありません/)).toBeTruthy();
  });
});
