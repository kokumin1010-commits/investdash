// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashboardDividendSummary,
  DashboardSignalActionSelector,
  DashboardSignalStatsStrip,
} from "../client/src/components/investing/DashboardDividendSignalSummary";

afterEach(() => cleanup());
beforeEach(() => vi.stubGlobal("React", React));

describe("Dashboard 年間配当・AI シグナル", () => {
  it("未取得は横線、取得済み無配は ¥0 として区別する", () => {
    const money = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
    const { rerender } = render(
      React.createElement(DashboardDividendSummary, {
        annualIncomeBase: 0,
        unknownCount: 112,
        totalSymbols: 112,
        formatMoney: money,
      })
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("配当データ未取得")).toBeTruthy();
    rerender(
      React.createElement(DashboardDividendSummary, {
        annualIncomeBase: 0,
        unknownCount: 0,
        totalSymbols: 112,
        formatMoney: money,
      })
    );
    expect(screen.getByText("¥0")).toBeTruthy();
    expect(screen.getByText("配当データ取得済み 112/112")).toBeTruthy();
  });

  it("五类行动、平均置信度、资料质量和再分析待ちを显示", () => {
    const counts = new Map([
      ["ADD", 2], ["HOLD", 40], ["WATCH", 60], ["REDUCE", 8], ["EXIT", 2],
    ] as const);
    const onSelect = vi.fn();
    render(
      React.createElement(React.Fragment, null,
        React.createElement(DashboardSignalStatsStrip, {
          stats: { total: 112, judged: 112, stale: 3, averageConfidence: 68.4, strong: 90, moderate: 20, limited: 2 },
        }),
        React.createElement(DashboardSignalActionSelector, { counts, active: "REDUCE", onSelect })
      )
    );
    expect(screen.getByText("判定済み 112/112")).toBeTruthy();
    expect(screen.getByText("平均確信度 68")).toBeTruthy();
    expect(screen.getByText("再分析待ち 3")).toBeTruthy();
    expect(screen.getByText("材料充足 90 / 材料あり 20 / 限定 2")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });
});
