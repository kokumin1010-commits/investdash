// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

const decide = vi.fn();
const backfill = vi.fn();
const invalidate = vi.fn();

vi.mock("../client/src/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      actionQueue: {
        list: { invalidate },
        summary: { invalidate },
        skipReviews: { invalidate },
        skipReviewSummary: { invalidate },
      },
    }),
    actionQueue: {
      list: {
        useQuery: () => ({
          isLoading: false,
          data: [
            {
              id: 1,
              userId: 1,
              symbol: "2733.T",
              name: "あらた",
              status: "PENDING_ACTION",
              triggerType: "EARNINGS",
              triggerKey: "earnings:2733.T:news-77",
              triggerSummary: "四半期決算を確認",
              sourceNewsId: 77,
              sourceSignalId: 11,
              previousSignalId: 10,
              previousAction: "HOLD",
              action: "REDUCE",
              direction: "SELL",
              currency: "JPY",
              rationale: "利益減少が続くため一部売却を検討します",
              evidence: {
                reviewTriggers: ["次回決算で純利益を確認"],
                riskFlags: ["業績悪化リスク"],
                accountCount: 1,
              },
              currentQuantity: 2000,
              currentPrice: 2738,
              currentValueBase: 5476000,
              currentWeightPct: 0.63,
              recommendedShares: 500,
              recommendedAmountLocal: 1369000,
              recommendedAmountBase: 1369000,
              afterQuantity: 1500,
              afterWeightPct: 0.4725,
              priority: 96,
              deadline: new Date("2026-08-31T00:00:00Z"),
              snoozedUntil: null,
              decisionNote: null,
              approvedAt: null,
              skippedAt: null,
              completedAt: null,
              createdAt: new Date("2026-08-29T00:00:00Z"),
              updatedAt: new Date("2026-08-29T00:00:00Z"),
              pending: true,
            },
          ],
        }),
      },
      summary: {
        useQuery: () => ({
          data: {
            pending: 1,
            urgent: 1,
            approved: 0,
            snoozed: 0,
            reviewing: 0,
            failed: 0,
            top: [],
          },
        }),
      },
      skipReviews: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: [
            {
              id: 10,
              symbol: "2733.T",
              name: "あらた",
              action: "REDUCE",
              direction: "SELL",
              status: "OPEN",
              currency: "JPY",
              skippedAt: new Date("2026-07-01T00:00:00Z"),
              decisionNote: "次の決算で利益回復を確認してから判断する",
              processQuality: "DISCIPLINE_SOUND",
              processReasons: ["確認条件が明記されています"],
              baselinePrice: 2738,
              recommendedAmountBase: 1369000,
              latestPrice: 2600,
              latestObservedAt: new Date("2026-08-01T00:00:00Z"),
              observationCount: 22,
              milestones: [
                {
                  id: 100,
                  milestoneType: "DAY_30",
                  dueAt: new Date("2026-07-31T00:00:00Z"),
                  status: "COMPLETED",
                  currentPrice: 2600,
                  returnPct: -5.04,
                  maxUpsidePct: 2.1,
                  maxDrawdownPct: -8.2,
                  observedTradingDays: 22,
                  outcomeQuality: "OUTCOME_NOT_YET_CLEAR",
                  summary: "30日では結果を断定しません",
                  counterfactualEffectBase: 69000,
                  evaluatedAt: new Date("2026-07-31T00:00:00Z"),
                },
              ],
            },
          ],
        }),
      },
      skipReviewSummary: {
        useQuery: () => ({
          data: {
            total: 1,
            open: 1,
            pendingMilestones: 3,
            completedMilestones: 1,
            needsProcessImprovement: 0,
          },
        }),
      },
      backfillInitial: {
        useMutation: () => ({ mutate: backfill, isPending: false }),
      },
      decide: {
        useMutation: () => ({
          mutate: decide,
          isPending: false,
          variables: undefined,
        }),
      },
    },
  },
}));

import ActionQueue from "../client/src/pages/ActionQueue";

beforeEach(() => {
  vi.stubGlobal("React", React);
  decide.mockReset();
  backfill.mockReset();
  Object.defineProperty(window, "innerWidth", {
    value: 390,
    configurable: true,
  });
});
afterEach(() => cleanup());

describe("アクション待ち page", () => {
  it.each([390, 1280])("%dpx 相当で現在・具体案・実行後を同時に示す", width => {
    Object.defineProperty(window, "innerWidth", {
      value: width,
      configurable: true,
    });
    render(React.createElement(Router, null, React.createElement(ActionQueue)));

    expect(screen.getByText("アクション待ち")).toBeTruthy();
    expect(screen.getByText("2,000 株")).toBeTruthy();
    expect(screen.getByText(/一部売却 500 株/)).toBeTruthy();
    expect(screen.getByText(/概算 ¥136.9万/)).toBeTruthy();
    expect(screen.getByText("1,500 株")).toBeTruthy();
    expect(screen.getByText(/構成比 0.63%/)).toBeTruthy();
    expect(screen.getByText(/構成比 0.47%/)).toBeTruthy();
    expect(screen.getByText(/四半期決算を確認/)).toBeTruthy();
    expect(screen.getByText(/次回決算で純利益を確認/)).toBeTruthy();
    expect(screen.queryByText(/自動注文/)).toBeNull();
  });

  it("本人が計画追加・延後・理由付き見送を明示的に選ぶ", () => {
    render(React.createElement(Router, null, React.createElement(ActionQueue)));
    fireEvent.click(screen.getByRole("button", { name: "計画に追加" }));
    fireEvent.click(screen.getByRole("button", { name: "あとで確認" }));
    fireEvent.click(screen.getByRole("button", { name: "今回は見送る" }));
    expect(
      screen.getByRole("button", { name: "理由を保存して見送る" }).hasAttribute("disabled")
    ).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/決算の受注推移/), {
      target: { value: "次の決算で利益回復を確認する" },
    });
    fireEvent.click(screen.getByRole("button", { name: "理由を保存して見送る" }));
    expect(decide).toHaveBeenNthCalledWith(1, { id: 1, decision: "APPROVE" });
    expect(decide).toHaveBeenNthCalledWith(2, {
      id: 1,
      decision: "SNOOZE",
      snoozeDays: 3,
    });
    expect(decide).toHaveBeenNthCalledWith(3, {
      id: 1,
      decision: "SKIP",
      note: "次の決算で利益回復を確認する",
    });
  });

  it("見送り検証で判断過程と結果を別々に表示する", () => {
    render(React.createElement(Router, null, React.createElement(ActionQueue)));
    fireEvent.click(screen.getByRole("button", { name: "見送り検証" }));

    expect(screen.getByText("判断過程と結果を分けて検証")).toBeTruthy();
    expect(screen.getByText("判断過程は規律的")).toBeTruthy();
    expect(screen.getByText("結果はまだ不明確")).toBeTruthy();
    expect(screen.getByText(/30日では結果を断定しません/)).toBeTruthy();
    expect(screen.getByText(/もし当時実行していた場合の概算差分/)).toBeTruthy();
  });
});
