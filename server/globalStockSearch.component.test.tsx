// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  searchMutate: vi.fn(),
  addMutate: vi.fn(),
  clearRecentMutate: vi.fn(),
  deleteRecentMutate: vi.fn(),
  generateMutate: vi.fn(),
  navigate: vi.fn(),
  searchSuccess: true,
  searchResult: [] as Array<Record<string, unknown>>,
  recentResult: [] as Array<Record<string, unknown>>,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", mocks.navigate],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      watchlist: { invalidate: vi.fn() },
      portfolio: { recentSecuritySearches: { invalidate: vi.fn() } },
    }),
    portfolio: {
      recentSecuritySearches: {
        useQuery: () => ({ data: mocks.recentResult }),
      },
      deleteRecentSecuritySearch: {
        useMutation: () => ({ mutate: mocks.deleteRecentMutate, isPending: false }),
      },
      clearRecentSecuritySearches: {
        useMutation: () => ({ mutate: mocks.clearRecentMutate, isPending: false }),
      },
      searchSecurities: {
        useMutation: () => ({
          mutate: mocks.searchMutate,
          data: mocks.searchSuccess ? mocks.searchResult : undefined,
          error: null,
          isPending: false,
          isSuccess: mocks.searchSuccess,
          reset: vi.fn(),
        }),
      },
    },
    watchlist: {
      add: {
        useMutation: () => ({ mutate: mocks.addMutate, isPending: false }),
      },
      generateProposal: {
        useMutation: () => ({ mutate: mocks.generateMutate, isPending: false }),
      },
    },
  },
}));

import { GlobalStockSearch } from "../client/src/components/investing/GlobalStockSearch";

const baseResult = {
  symbol: "V03.SI",
  tickerCode: "V03",
  name: "Venture Corporation Limited",
  market: "SG",
  marketLabel: "シンガポール株",
  exchangeName: "Singapore",
  currency: "SGD",
  price: 16.45,
  previousClose: 16.4,
  priceAsOf: new Date("2026-09-11T08:00:00Z"),
  quoteType: "EQUITY",
  registrationStatus: "UNREGISTERED",
  existingWatch: null,
  existingHoldings: [],
};

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.clearAllMocks();
  mocks.searchSuccess = true;
  mocks.searchResult = [baseResult];
  mocks.recentResult = [];
});

afterEach(() => cleanup());

describe("GlobalStockSearch", () => {
  for (const width of [390, 1280]) {
    it(`searches bare SGX codes and shows a confirmed result at ${width}px`, () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      render(<GlobalStockSearch />);

      const input = screen.getByLabelText("会社名または銘柄コードを検索");
      fireEvent.change(input, { target: { value: "V03" } });
      fireEvent.submit(input.closest("form")!);

      expect(mocks.searchMutate).toHaveBeenCalledWith({ query: "V03", limit: 8 });
      expect(screen.getByText("Venture Corporation Limited")).toBeTruthy();
      expect(screen.getByText("V03.SI")).toBeTruthy();
      expect(screen.getByText("シンガポール株")).toBeTruthy();
    });
  }

  it("adds only the validated full symbol", () => {
    render(<GlobalStockSearch />);
    fireEvent.click(screen.getByRole("button", { name: "ウォッチリストに追加" }));
    expect(mocks.addMutate).toHaveBeenCalledWith({
      code: "V03.SI",
      name: "Venture Corporation Limited",
    });
  });

  it("opens an existing holding instead of adding a duplicate", () => {
    mocks.searchResult = [
      {
        ...baseResult,
        registrationStatus: "HELD",
        existingHoldings: [{ id: 42, broker: "ibkr", symbol: "V03.SI", name: "Venture" }],
      },
    ];
    render(<GlobalStockSearch />);
    fireEvent.click(screen.getByRole("button", { name: /保有詳細を見る/ }));
    expect(mocks.navigate).toHaveBeenCalledWith("/holdings/42");
    expect(mocks.addMutate).not.toHaveBeenCalled();
  });

  it("opens an existing watch card instead of adding a duplicate", () => {
    mocks.searchResult = [
      {
        ...baseResult,
        registrationStatus: "WATCHED",
        existingWatch: { id: 9, symbol: "V03.SI", name: "Venture" },
      },
    ];
    render(<GlobalStockSearch />);
    fireEvent.click(screen.getByRole("button", { name: /ウォッチカードを見る/ }));
    expect(mocks.navigate).toHaveBeenCalledWith("/watchlist?focus=9");
    expect(mocks.addMutate).not.toHaveBeenCalled();
  });

  for (const width of [390, 1280]) {
    it(`shows recent searches and reruns the selected symbol at ${width}px`, () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      mocks.searchSuccess = false;
      mocks.recentResult = [
        {
          id: 7,
          symbol: "V03.SI",
          tickerCode: "V03",
          name: "Venture Corporation Limited",
          market: "SG",
          currency: "SGD",
          searchedAt: new Date("2026-09-14T00:00:00Z"),
        },
      ];

      render(<GlobalStockSearch />);
      expect(screen.getByText("最近の検索")).toBeTruthy();
      fireEvent.click(screen.getByText("Venture Corporation Limited"));
      expect(mocks.searchMutate).toHaveBeenCalledWith({ query: "V03.SI", limit: 8 });
      expect(
        (screen.getByLabelText("会社名または銘柄コードを検索") as HTMLInputElement)
          .value
      ).toBe("V03.SI");
    });
  }

  it("deletes one recent item or clears all items only after an explicit click", () => {
    mocks.searchSuccess = false;
    mocks.recentResult = [
      {
        id: 7,
        symbol: "V03.SI",
        tickerCode: "V03",
        name: "Venture Corporation Limited",
        market: "SG",
        currency: "SGD",
        searchedAt: new Date("2026-09-14T00:00:00Z"),
      },
    ];
    render(<GlobalStockSearch />);

    fireEvent.click(
      screen.getByRole("button", { name: "Venture Corporation Limitedを最近の検索から削除" })
    );
    expect(mocks.deleteRecentMutate).toHaveBeenCalledWith({ id: 7 });

    fireEvent.click(screen.getByRole("button", { name: "すべて削除" }));
    expect(mocks.clearRecentMutate).toHaveBeenCalledTimes(1);
  });
});
