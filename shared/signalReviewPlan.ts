const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type ReviewDateConfidence =
  | "CONFIRMED"
  | "SCHEDULED"
  | "AI_ESTIMATE"
  | "UNANNOUNCED";

export type ReviewWindowStatus =
  | "SCHEDULED"
  | "UPCOMING"
  | "DUE"
  | "POST_REVIEW"
  | "OVERDUE"
  | "UNSCHEDULED";

export type ReviewReminderWindow = "D7" | "D0" | "D1" | null;

export type SignalReviewPlan = {
  nextReviewDate: string | null;
  dateConfidence: ReviewDateConfidence;
  dateSource: "COMPANY" | "EXCHANGE" | "AI_REVIEW_CYCLE" | "NONE";
  windowStatus: ReviewWindowStatus;
  daysUntil: number | null;
  reminderWindow: ReviewReminderWindow;
  headline: string;
  primaryCheck: string;
  beforeChecklist: string[];
  afterChecklist: string[];
};

export type BuildSignalReviewPlanInput = {
  validUntil?: Date | string | null;
  reviewTriggers?: string[] | null;
  officialDate?: Date | string | null;
  officialDateConfidence?: "CONFIRMED" | "SCHEDULED" | null;
  officialDateSource?: "COMPANY" | "EXCHANGE" | null;
  now?: Date;
};

function asValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function jstDayNumber(value: Date): number {
  return Math.floor((value.getTime() + JST_OFFSET_MS) / DAY_MS);
}

export function daysUntilJstDate(target: Date, now: Date): number {
  return jstDayNumber(target) - jstDayNumber(now);
}

function resolveWindowStatus(daysUntil: number | null): ReviewWindowStatus {
  if (daysUntil === null) return "UNSCHEDULED";
  if (daysUntil > 7) return "SCHEDULED";
  if (daysUntil >= 2) return "UPCOMING";
  if (daysUntil >= 0) return "DUE";
  if (daysUntil >= -3) return "POST_REVIEW";
  return "OVERDUE";
}

function resolveReminderWindow(daysUntil: number | null): ReviewReminderWindow {
  if (daysUntil === 7) return "D7";
  if (daysUntil === 0) return "D0";
  if (daysUntil === -1) return "D1";
  return null;
}

function headlineFor(
  status: ReviewWindowStatus,
  daysUntil: number | null
): string {
  switch (status) {
    case "UPCOMING":
      return `あと${daysUntil}日で確認`;
    case "DUE":
      return daysUntil === 1 ? "明日確認" : "本日確認";
    case "POST_REVIEW":
      return daysUntil === -1
        ? "結果を確認"
        : `${Math.abs(daysUntil ?? 0)}日経過・結果確認`;
    case "OVERDUE":
      return `${Math.abs(daysUntil ?? 0)}日超過`;
    case "SCHEDULED":
      return `あと${daysUntil}日`;
    default:
      return "日程未発表";
  }
}

function cleanTriggers(values: string[] | null | undefined): string[] {
  return (values ?? [])
    .filter((value): value is string => typeof value === "string")
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function buildSignalReviewPlan(
  input: BuildSignalReviewPlanInput
): SignalReviewPlan {
  const officialDate = asValidDate(input.officialDate);
  const aiReviewDate = asValidDate(input.validUntil);
  const nextReviewDate = officialDate ?? aiReviewDate;
  const dateConfidence: ReviewDateConfidence = officialDate
    ? (input.officialDateConfidence ?? "SCHEDULED")
    : aiReviewDate
      ? "AI_ESTIMATE"
      : "UNANNOUNCED";
  const dateSource: SignalReviewPlan["dateSource"] = officialDate
    ? (input.officialDateSource ?? "EXCHANGE")
    : aiReviewDate
      ? "AI_REVIEW_CYCLE"
      : "NONE";
  const now = input.now ?? new Date();
  const daysUntil = nextReviewDate
    ? daysUntilJstDate(nextReviewDate, now)
    : null;
  const windowStatus = resolveWindowStatus(daysUntil);
  const beforeChecklist = cleanTriggers(input.reviewTriggers);
  const normalizedBefore =
    beforeChecklist.length > 0
      ? beforeChecklist
      : ["投資ロジック・業績見通し・主要リスクに変化がないか確認"];
  const afterChecklist = [
    "発表内容と従来の想定との差を確認",
    "通期見通し・配当・資本政策の変更を確認",
    "新しい材料を反映してAIシグナルを再分析",
  ];

  return {
    nextReviewDate: nextReviewDate?.toISOString() ?? null,
    dateConfidence,
    dateSource,
    windowStatus,
    daysUntil,
    reminderWindow: resolveReminderWindow(daysUntil),
    headline: headlineFor(windowStatus, daysUntil),
    primaryCheck: normalizedBefore[0],
    beforeChecklist: normalizedBefore,
    afterChecklist,
  };
}

export function isReviewPlanInDashboardWindow(plan: SignalReviewPlan): boolean {
  return ["UPCOMING", "DUE", "POST_REVIEW", "OVERDUE"].includes(
    plan.windowStatus
  );
}
