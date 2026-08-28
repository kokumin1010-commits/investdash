// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ review: vi.fn(), invalidate: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ watchlist: { invalidate: mocks.invalidate } }),
    watchlist: {
      reviewProposal: {
        useMutation: () => ({ mutate: mocks.review, isPending: false }),
      },
    },
  },
}));

import {
  WatchProposalReviewDialog,
  type WatchProposalDraftView,
} from "../client/src/components/investing/WatchProposalReviewDialog";

const draft: WatchProposalDraftView = {
  id: 9,
  watchItemId: 3,
  symbol: "PYPL",
  stance: "WAIT",
  conclusion: "今は価格を待つ",
  rationale: "利益率の改善を確認するまで待つ。",
  amountBase: null,
  limitPrice: 48,
  priceAtProposal: 53.71,
  buyConditions: "48ドル以下かつ利益率改善",
  invalidation: "決算で利益率が悪化",
  confidence: 72,
  evidence: {
    generatedAt: "2026-08-29T00:00:00Z",
    price: 53.71,
    priceUpdatedAt: "2026-08-29T00:00:00Z",
    rangeLow6m: 44,
    rangeHigh6m: 79,
    annualDividend: 0,
    dividendCurrency: "USD",
    sector: "Financial Services",
    industry: "Credit Services",
    newsCount: 4,
    latestNewsAt: "2026-08-28T00:00:00Z",
    fetchedNews: 2,
    analyzedNews: 2,
  },
  model: "gemini-3-flash-preview",
  createdAt: "2026-08-29T00:00:00Z",
};

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => cleanup());

describe("WatchProposalReviewDialog", () => {
  it("shows the AI draft, evidence and explicit confirmation choices", () => {
    render(
      React.createElement(WatchProposalReviewDialog, {
        proposal: draft,
        open: true,
        onOpenChange: vi.fn(),
      })
    );
    expect(screen.getByText("AI提案・要確認")).toBeTruthy();
    expect(screen.getByText("価格を待つ")).toBeTruthy();
    expect(screen.getByText("確信度 72")).toBeTruthy();
    expect(screen.getByText("現在値")).toBeTruthy();
    expect(screen.getByText("AI目標")).toBeTruthy();
    expect(screen.getByText("53.71")).toBeTruthy();
    expect(screen.getAllByText("48").length).toBeGreaterThan(0);
    expect(screen.getByText("-10.6%")).toBeTruthy();
    expect(screen.getByText(/株価取得/)).toBeTruthy();
    expect(screen.getByText("ニュース 4 件")).toBeTruthy();
    expect(screen.getByRole("button", { name: "あとで確認" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "今回は見送る" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "提案を採用して保存" })).toBeTruthy();
  });

  it("submits edited values only after the user confirms", () => {
    render(
      React.createElement(WatchProposalReviewDialog, {
        proposal: draft,
        open: true,
        onOpenChange: vi.fn(),
      })
    );
    fireEvent.change(screen.getByLabelText("目標買付価格（現地通貨）"), { target: { value: "46" } });
    fireEvent.click(screen.getByRole("button", { name: "修正して保存" }));
    expect(mocks.review).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 9, decision: "EDIT", targetPrice: 46 })
    );
  });
});
