// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn(),
  lookupData: {} as Record<string, unknown>,
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { invalidate: vi.fn() } }),
    portfolio: {
      lookup: {
        useMutation: () => ({
          data: mocks.lookupData,
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

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  mocks.lookupData = {
    symbol: "PYPL",
    name: "PayPal Holdings, Inc.",
    price: 53.71,
    currency: "USD",
    sector: "Financial Services",
    existingWatch: null,
    existingHoldings: [],
  };
});
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

  it("replaces add with the existing watch-card action", () => {
    mocks.lookupData = {
      ...mocks.lookupData,
      existingWatch: { id: 41, symbol: "PYPL", name: "PayPal Holdings, Inc." },
    };
    const onExistingWatch = vi.fn();

    render(
      React.createElement(WatchFormDialog, {
        open: true,
        onOpenChange: vi.fn(),
        onExistingWatch,
      })
    );

    expect(screen.getByText("ウォッチリスト登録済み")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "この銘柄を追加" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "登録済みの銘柄を見る" }));
    expect(onExistingWatch).toHaveBeenCalledWith(41);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("replaces add with the holding-detail action", () => {
    mocks.lookupData = {
      ...mocks.lookupData,
      existingHoldings: [
        { id: 77, symbol: "PYPL", name: "PayPal Holdings, Inc.", broker: "ibkr" },
      ],
    };
    const onExistingHolding = vi.fn();

    render(
      React.createElement(WatchFormDialog, {
        open: true,
        onOpenChange: vi.fn(),
        onExistingHolding,
      })
    );

    expect(screen.getByText("保有銘柄として登録済み")).toBeTruthy();
    expect(screen.getByText(/IBKR シンガポール で保有しています/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保有詳細を見る" }));
    expect(onExistingHolding).toHaveBeenCalledWith(77);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("shows both destinations and prioritizes the first stable holding id", () => {
    mocks.lookupData = {
      ...mocks.lookupData,
      existingWatch: { id: 41, symbol: "PYPL", name: "PayPal Holdings, Inc." },
      existingHoldings: [
        { id: 77, symbol: "PYPL", name: "PayPal Holdings, Inc.", broker: "ibkr" },
        { id: 88, symbol: "PYPL", name: "PayPal Holdings, Inc.", broker: "rakuten" },
      ],
    };
    const onExistingWatch = vi.fn();
    const onExistingHolding = vi.fn();

    render(
      React.createElement(WatchFormDialog, {
        open: true,
        onOpenChange: vi.fn(),
        onExistingWatch,
        onExistingHolding,
      })
    );

    expect(screen.getByText("ウォッチリスト登録済み")).toBeTruthy();
    expect(screen.getByText("保有銘柄として登録済み")).toBeTruthy();
    expect(screen.getByText(/2口座で保有しています/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ウォッチカードを見る" }));
    fireEvent.click(screen.getByRole("button", { name: "保有詳細を見る" }));
    expect(onExistingWatch).toHaveBeenCalledWith(41);
    expect(onExistingHolding).toHaveBeenCalledWith(77);
  });
});
