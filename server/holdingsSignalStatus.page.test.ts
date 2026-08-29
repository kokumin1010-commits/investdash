// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldingSignalStatus } from "../client/src/components/investing/HoldingSignalStatus";
import { SIGNAL_ACTIONS, SIGNAL_LABELS } from "../shared/investing";

afterEach(() => cleanup());
beforeEach(() => vi.stubGlobal("React", React));

describe("保有銘柄一覧の実保有シグナル", () => {
  it.each(["mobile", "desktop"] as const)(
    "%s は五種類の実際の保有行動だけを表示する",
    surface => {
      for (const action of SIGNAL_ACTIONS) {
        const view = render(
          React.createElement(HoldingSignalStatus, { action, surface })
        );

        expect(screen.getByTestId(`holding-signal-${surface}`)).toBeTruthy();
        expect(screen.getByText(action)).toBeTruthy();
        expect(screen.getByText(SIGNAL_LABELS[action])).toBeTruthy();
        expect(screen.queryByText(/未保有/)).toBeNull();
        expect(screen.queryByText(/仮に未保有なら/)).toBeNull();
        view.unmount();
      }
    }
  );

  it("信号がない場合は未生成と表示し、未保有とは表示しない", () => {
    render(
      React.createElement(HoldingSignalStatus, {
        action: null,
        surface: "desktop",
      })
    );

    expect(screen.getByText("未生成")).toBeTruthy();
    expect(screen.queryByText(/未保有/)).toBeNull();
  });
});
