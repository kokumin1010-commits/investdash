import { describe, expect, it } from "vitest";
import { buildSignalReviewPlan } from "../shared/signalReviewPlan";
import {
  buildReviewReminderDigest,
  jstDateKey,
  jstDayBounds,
} from "./services/reviewReminder";

type PortfolioGroups = Parameters<typeof buildReviewReminderDigest>[0];

function group(params: {
  symbol: string;
  name: string;
  action: "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT";
  validUntil: string;
  value: number;
}): PortfolioGroups[number] {
  return {
    symbol: params.symbol,
    name: params.name,
    marketValueBase: params.value,
    signal: {
      action: params.action,
      reviewPlan: buildSignalReviewPlan({
        validUntil: params.validUntil,
        reviewTriggers: [`${params.name} の確認項目`],
        now: new Date("2026-08-29T00:00:00.000Z"),
      }),
    },
  } as PortfolioGroups[number];
}

describe("review reminder", () => {
  const now = new Date("2026-08-29T00:00:00.000Z");

  it("D0、D+1、D-7 だけを1通にまとめ、実行優先順で並べる", () => {
    const groups = [
      group({
        symbol: "HOLD",
        name: "保有",
        action: "HOLD",
        validUntil: "2026-08-29T03:00:00Z",
        value: 9_000_000,
      }),
      group({
        symbol: "RED",
        name: "縮小",
        action: "REDUCE",
        validUntil: "2026-08-29T03:00:00Z",
        value: 1_000_000,
      }),
      group({
        symbol: "POST",
        name: "翌日",
        action: "WATCH",
        validUntil: "2026-08-28T03:00:00Z",
        value: 2_000_000,
      }),
      group({
        symbol: "WEEK",
        name: "一週間前",
        action: "EXIT",
        validUntil: "2026-09-05T03:00:00Z",
        value: 3_000_000,
      }),
      group({
        symbol: "LATER",
        name: "対象外",
        action: "EXIT",
        validUntil: "2026-09-04T03:00:00Z",
        value: 4_000_000,
      }),
    ];
    const digest = buildReviewReminderDigest(groups, now);
    expect(digest.dateKey).toBe("2026-08-29");
    expect(digest.items.map(item => item.symbol)).toEqual([
      "RED",
      "HOLD",
      "POST",
      "WEEK",
    ]);
    expect(digest.title).toContain("4銘柄");
    expect(digest.content).toContain("本日｜縮小 (RED)｜REDUCE");
    expect(digest.content).toContain("結果確認｜翌日 (POST)｜WATCH");
    expect(digest.content).toContain("7日前｜一週間前 (WEEK)｜EXIT");
    expect(digest.content).not.toContain("対象外");
  });

  it("JST 日付キーと1日の UTC 境界を正しく返す", () => {
    const atJstMorning = new Date("2026-12-31T23:00:00.000Z");
    expect(jstDateKey(atJstMorning)).toBe("2027-01-01");
    const bounds = jstDayBounds(atJstMorning);
    expect(bounds.from.toISOString()).toBe("2026-12-31T15:00:00.000Z");
    expect(bounds.to.toISOString()).toBe("2027-01-01T14:59:59.999Z");
  });
});
