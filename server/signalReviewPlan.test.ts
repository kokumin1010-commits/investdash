import { describe, expect, it } from "vitest";
import {
  buildSignalReviewPlan,
  daysUntilJstDate,
  isReviewPlanInDashboardWindow,
} from "../shared/signalReviewPlan";

describe("buildSignalReviewPlan", () => {
  const now = new Date("2026-08-29T00:00:00.000Z");

  it.each([
    ["2026-09-05T03:00:00.000Z", 7, "UPCOMING", "D7", "あと7日で確認"],
    ["2026-08-29T03:00:00.000Z", 0, "DUE", "D0", "本日確認"],
    ["2026-08-28T03:00:00.000Z", -1, "POST_REVIEW", "D1", "結果を確認"],
    ["2026-08-24T03:00:00.000Z", -5, "OVERDUE", null, "5日超過"],
  ] as const)(
    "%s は JST で %s 日差、%s/%s になる",
    (validUntil, daysUntil, status, reminderWindow, headline) => {
      const plan = buildSignalReviewPlan({
        validUntil,
        reviewTriggers: ["次回決算で通期見通しを確認"],
        now,
      });
      expect(plan.daysUntil).toBe(daysUntil);
      expect(plan.windowStatus).toBe(status);
      expect(plan.reminderWindow).toBe(reminderWindow);
      expect(plan.headline).toBe(headline);
      expect(plan.dateConfidence).toBe("AI_ESTIMATE");
      expect(plan.dateSource).toBe("AI_REVIEW_CYCLE");
      expect(plan.primaryCheck).toBe("次回決算で通期見通しを確認");
    }
  );

  it("公式予定日を AI 目安より優先し、出所を明示する", () => {
    const plan = buildSignalReviewPlan({
      validUntil: "2026-09-05T03:00:00.000Z",
      officialDate: "2026-09-01T06:00:00.000Z",
      officialDateConfidence: "CONFIRMED",
      officialDateSource: "COMPANY",
      now,
    });
    expect(plan.nextReviewDate).toBe("2026-09-01T06:00:00.000Z");
    expect(plan.dateConfidence).toBe("CONFIRMED");
    expect(plan.dateSource).toBe("COMPANY");
  });

  it("日付が無い場合は日程未発表で、決算日を推測しない", () => {
    const plan = buildSignalReviewPlan({
      validUntil: null,
      reviewTriggers: [],
      now,
    });
    expect(plan).toMatchObject({
      nextReviewDate: null,
      dateConfidence: "UNANNOUNCED",
      dateSource: "NONE",
      windowStatus: "UNSCHEDULED",
      daysUntil: null,
      reminderWindow: null,
      headline: "日程未発表",
    });
    expect(isReviewPlanInDashboardWindow(plan)).toBe(false);
  });

  it("UTC 日付ではなく JST の暦日で判定する", () => {
    const beforeMidnightJst = new Date("2026-08-28T14:59:59.000Z");
    const afterMidnightJst = new Date("2026-08-28T15:00:00.000Z");
    const target = new Date("2026-08-29T12:00:00.000Z");
    expect(daysUntilJstDate(target, beforeMidnightJst)).toBe(1);
    expect(daysUntilJstDate(target, afterMidnightJst)).toBe(0);
  });
});
