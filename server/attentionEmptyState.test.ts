// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttentionEmptyState } from "../client/src/components/investing/AttentionEmptyState";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttentionEmptyState", () => {
  it("warns that an empty attention list is not proof of safety while signals are pending", () => {
    vi.stubGlobal("React", React);
    render(React.createElement(AttentionEmptyState, { unjudgedSignalCount: 111 }));

    expect(screen.getByText("まだ全銘柄の判断が完了していません")).toBeTruthy();
    expect(screen.getByText("111 銘柄の判断を小分けで生成中です。", { exact: false })).toBeTruthy();
    expect(screen.getByText("リスクがないことを意味しません。", { exact: false })).toBeTruthy();
    expect(screen.getByRole("link", { name: "保有一覧で全銘柄を見る" }).getAttribute("href")).toBe(
      "/holdings"
    );
  });

  it("shows the clean state only after every signal has been judged", () => {
    vi.stubGlobal("React", React);
    render(React.createElement(AttentionEmptyState, { unjudgedSignalCount: 0 }));

    expect(
      screen.getByText("全銘柄の判定済みシグナルに、現在 EXIT / REDUCE / WATCH はありません")
    ).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
