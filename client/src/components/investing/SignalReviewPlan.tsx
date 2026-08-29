import { Badge } from "@/components/ui/badge";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import type {
  ReviewDateConfidence,
  ReviewWindowStatus,
  SignalReviewPlan,
} from "@shared/signalReviewPlan";

const CONFIDENCE_LABELS: Record<ReviewDateConfidence, string> = {
  CONFIRMED: "確定日",
  SCHEDULED: "公式予定",
  AI_ESTIMATE: "AI目安",
  UNANNOUNCED: "日程未発表",
};

const STATUS_STYLES: Record<ReviewWindowStatus, string> = {
  SCHEDULED: "border-slate-200 bg-slate-50 text-slate-700",
  UPCOMING: "border-amber-200 bg-amber-50 text-amber-800",
  DUE: "border-orange-300 bg-orange-50 text-orange-800",
  POST_REVIEW: "border-sky-200 bg-sky-50 text-sky-800",
  OVERDUE: "border-rose-200 bg-rose-50 text-rose-800",
  UNSCHEDULED: "border-slate-200 bg-slate-50 text-slate-600",
};

export function formatReviewDateJa(value: string | null): string {
  if (!value) return "日程未発表";
  return new Date(value).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

export function SignalReviewPlanBadge({ plan }: { plan: SignalReviewPlan }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Badge
        variant="outline"
        className={`h-auto max-w-full gap-1 px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[plan.windowStatus]}`}
      >
        <CalendarClock className="h-3 w-3 shrink-0" />
        <span className="truncate">{plan.headline}</span>
      </Badge>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {CONFIDENCE_LABELS[plan.dateConfidence]}
      </span>
    </span>
  );
}

function Checklist({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border bg-background/70 p-3">
      <p className="mb-2 text-xs font-semibold">{title}</p>
      <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-1.5">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SignalReviewPlanCard({ plan }: { plan: SignalReviewPlan }) {
  return (
    <section
      className={`rounded-xl border p-3 sm:p-4 ${STATUS_STYLES[plan.windowStatus]}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <CalendarClock className="h-4 w-4" />
            次回確認
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatReviewDateJa(plan.nextReviewDate)}
          </p>
          <p className="mt-0.5 text-xs">{plan.headline}</p>
        </div>
        <Badge variant="outline" className="bg-background/70 text-[10px]">
          {CONFIDENCE_LABELS[plan.dateConfidence]}
        </Badge>
      </div>

      <p className="mt-3 rounded-lg bg-background/70 px-3 py-2 text-xs leading-relaxed">
        <span className="font-semibold">この前後に確認：</span>{" "}
        {plan.primaryCheck}
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Checklist title="確認前に見ること" items={plan.beforeChecklist} />
        <Checklist title="確認後に見ること" items={plan.afterChecklist} />
      </div>

      {plan.dateConfidence === "AI_ESTIMATE" ? (
        <p className="mt-2 text-[10px] leading-relaxed opacity-80">
          AI分析の再確認目安です。会社の決算発表予定日を示すものではありません。
        </p>
      ) : null}
    </section>
  );
}
