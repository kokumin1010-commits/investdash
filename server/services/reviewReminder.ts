import type { SignalAction } from "../../shared/investing";
import type { ReviewReminderWindow } from "../../shared/signalReviewPlan";
import { notifyOwner } from "../_core/notification";
import { buildPortfolio } from "./portfolio";
import { listSchedulerRuns } from "./schedulerRunLog";

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type ReviewReminderItem = {
  symbol: string;
  name: string;
  action: SignalAction;
  reminderWindow: Exclude<ReviewReminderWindow, null>;
  nextReviewDate: string;
  primaryCheck: string;
  marketValueBase: number | null;
};

export type ReviewReminderDigest = {
  dateKey: string;
  items: ReviewReminderItem[];
  title: string;
  content: string;
};

function jstDayParts(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function jstDateKey(now: Date): string {
  const { year, month, day } = jstDayParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function jstDayBounds(now: Date): { from: Date; to: Date } {
  const { year, month, day } = jstDayParts(now);
  const fromMs = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
  return { from: new Date(fromMs), to: new Date(fromMs + DAY_MS - 1) };
}

const WINDOW_LABELS: Record<Exclude<ReviewReminderWindow, null>, string> = {
  D7: "7日前",
  D0: "本日",
  D1: "結果確認",
};

const WINDOW_RANK: Record<Exclude<ReviewReminderWindow, null>, number> = {
  D0: 0,
  D1: 1,
  D7: 2,
};

const ACTION_RANK: Record<SignalAction, number> = {
  EXIT: 0,
  REDUCE: 1,
  WATCH: 2,
  ADD: 3,
  HOLD: 4,
};

export function buildReviewReminderDigest(
  groups: Awaited<ReturnType<typeof buildPortfolio>>["groups"],
  now: Date
): ReviewReminderDigest {
  const items = groups
    .flatMap(group => {
      const plan = group.signal?.reviewPlan;
      if (!group.signal || !plan?.reminderWindow || !plan.nextReviewDate)
        return [];
      return [
        {
          symbol: group.symbol,
          name: group.name,
          action: group.signal.action,
          reminderWindow: plan.reminderWindow,
          nextReviewDate: plan.nextReviewDate,
          primaryCheck: plan.primaryCheck,
          marketValueBase: group.marketValueBase,
        } satisfies ReviewReminderItem,
      ];
    })
    .sort((a, b) => {
      const windowDelta =
        WINDOW_RANK[a.reminderWindow] - WINDOW_RANK[b.reminderWindow];
      if (windowDelta !== 0) return windowDelta;
      const actionDelta = ACTION_RANK[a.action] - ACTION_RANK[b.action];
      if (actionDelta !== 0) return actionDelta;
      return (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0);
    });
  const dateKey = jstDateKey(now);
  const lines = items
    .slice(0, 12)
    .map(
      item =>
        `・${WINDOW_LABELS[item.reminderWindow]}｜${item.name} (${item.symbol})｜${item.action}\n  ${item.primaryCheck}`
    );
  if (items.length > 12) lines.push(`・ほか ${items.length - 12} 銘柄`);

  return {
    dateKey,
    items,
    title: `【InvestDash】次回確認 ${items.length}銘柄（${dateKey}）`,
    content: [
      "保有銘柄の確認タイミングです。売買の自動実行は行いません。",
      "",
      ...lines,
      "",
      "InvestDash の「今週確認する銘柄」から内容を確認し、必要ならAI再分析を実行してください。",
    ].join("\n"),
  };
}

export async function hasSuccessfulReviewReminderRun(
  userId: number,
  now: Date
): Promise<boolean> {
  const { from, to } = jstDayBounds(now);
  const runs = await listSchedulerRuns(userId, {
    kind: "review_reminder",
    status: "SUCCESS",
    from,
    to,
    limit: 20,
  });
  return runs.some(run => run.detailJson?.dateKey === jstDateKey(now));
}

export async function deliverReviewReminderDigest(
  userId: number,
  now: Date = new Date(),
  send: typeof notifyOwner = notifyOwner
): Promise<ReviewReminderDigest & { sent: boolean }> {
  const portfolio = await buildPortfolio(userId);
  const digest = buildReviewReminderDigest(portfolio.groups, now);
  if (digest.items.length === 0) return { ...digest, sent: false };
  const sent = await send({ title: digest.title, content: digest.content });
  if (!sent) throw new Error("次回確認リマインドを送信できませんでした");
  return { ...digest, sent: true };
}
