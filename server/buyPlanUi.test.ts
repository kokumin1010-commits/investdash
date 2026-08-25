import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BuffettLensBlock,
  WouldBuyNowBadge,
  WouldBuyNowMark,
} from "../client/src/components/investing/WouldBuyNowBadge";
import {
  buildProposalConsultHref,
  filterBuyPlanRows,
  formatNextBandHint,
} from "../shared/buyPlanUi";
import { BUFFETT_FILTER_LABELS } from "../shared/buffettFilter";

describe("buy-plan UI wording", () => {
  it("does not display negative zero for the next price band", () => {
    expect(formatNextBandHint(-0.001, "小幅に買い増し検討")).toBe(
      "現在の水準が「小幅に買い増し検討」の目安"
    );
    expect(formatNextBandHint(-4.26, "主力として買い増し")).toBe(
      "4.3% 下がると「主力として買い増し」"
    );
  });

  it("builds a consultation link with the symbol and proposal context", () => {
    const href = buildProposalConsultHref({
      symbol: "7203.T",
      name: "トヨタ自動車",
      stanceLabel: "見送る",
      conclusion: "構成比が上限を超えている",
      invalidation: "構成比が 5% を切る",
    });
    const url = new URL(href, "https://example.test");

    expect(url.pathname).toBe("/consult");
    expect(url.searchParams.get("symbol")).toBe("7203.T");
    expect(url.searchParams.get("question")).toContain("構成比が上限を超えている");
    expect(url.searchParams.get("question")).toContain("構成比が 5% を切る");
  });

  it("switches filters, shows an empty search, and restores all rows after clearing", () => {
    const rows = [
      {
        action: "ADD_SMALL",
        outsideDirection: null,
        symbol: "7203.T",
        name: "トヨタ自動車",
      },
      {
        action: "VERIFY",
        outsideDirection: null,
        symbol: "NVDA",
        name: "NVIDIA",
      },
      {
        action: null,
        outsideDirection: "ABOVE",
        symbol: "9984.T",
        name: "ソフトバンクグループ",
      },
    ];

    expect(filterBuyPlanRows(rows, "BUY", "").map(row => row.symbol)).toEqual([
      "7203.T",
    ]);
    expect(filterBuyPlanRows(rows, "VERIFY", "").map(row => row.symbol)).toEqual([
      "NVDA",
    ]);
    expect(filterBuyPlanRows(rows, "OUTSIDE", "").map(row => row.symbol)).toEqual([
      "9984.T",
    ]);
    expect(filterBuyPlanRows(rows, "ALL", "NO-SUCH-SYMBOL")).toEqual([]);
    expect(filterBuyPlanRows(rows, "ALL", "")).toHaveLength(3);
  });

  it("labels the separate Buffett question as a new-purchase decision", () => {
    expect(
      renderToStaticMarkup(createElement(WouldBuyNowBadge, { value: "YES" }))
    ).toContain("未保有なら買う");
    expect(
      renderToStaticMarkup(createElement(WouldBuyNowMark, { value: "YES" }))
    ).toContain("新規なら買う");
    expect(
      renderToStaticMarkup(
        createElement(BuffettLensBlock, {
          wouldBuyNow: "YES",
          wouldBuyNowReason: "価値に対して割高ではない",
          priceVsValue: "IN_LINE",
          priceVsValueReason: "釣り合っている",
        })
      )
    ).toContain("新規購入の判断");
    expect(BUFFETT_FILTER_LABELS.BUY_NOW).toBe("新規なら買う");
    expect(BUFFETT_FILTER_LABELS.ALL).toBe("すべての新規判定");
  });
});
