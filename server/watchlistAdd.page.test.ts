// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { invalidate: vi.fn() } }),
    portfolio: {
      lookup: {
        useMutation: () => ({
          data: {
            symbol: "PYPL",
            name: "PayPal Holdings, Inc.",
            price: 53.71,
            currency: "USD",
            sector: "Financial Services",
          },
          mutate: vi.fn(),
          reset: vi.fn(),
          isPending: false,
        }),
      },
    },
    watchlist: {
      add: { useMutation: () => ({ mutate: mocks.add, isPending: false }) },
      update: { useMutation: () => ({ mutate: mocks.update, isPending: false }) },
    },
  },
}));

vi.mock("@/components/investing/WatchProposalReviewDialog", () => ({
  WatchProposalReviewDialog: () => null,
}));

import { WatchFormDialog } from "../client/src/pages/Watchlist";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => cleanup());

describe("WatchFormDialog add flow", () => {
  it("asks only for a verified symbol and never requires target fields before adding", () => {
    render(
      React.createElement(WatchFormDialog, {
        open: true,
        onOpenChange: vi.fn(),
        onAdded: vi.fn(),
      })
    );
    fireEvent.change(screen.getByLabelText("銘柄コード"), { target: { value: "PYPL" } });
    expect(screen.queryByLabelText("目標買付価格")).toBeNull();
    expect(screen.queryByLabelText("投資予定額")).toBeNull();
    expect(screen.getByText(/この銘柄だけ先に保存します/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "この銘柄を追加" }));
    expect(mocks.add).toHaveBeenCalledWith({ code: "PYPL", name: "PayPal Holdings, Inc." });
  });
});
