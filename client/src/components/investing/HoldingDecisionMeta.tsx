import { Badge } from "@/components/ui/badge";
import type { HoldingDurationView } from "@shared/holdingDuration";
import type { SignalFreshness } from "@shared/signalFreshness";
import { buildSignalReviewPlan, type SignalReviewPlan } from "@shared/signalReviewPlan";
import { SignalReviewPlanCard } from "./SignalReviewPlan";

function durationText(days: number): string {
  if (days < 31) return `${days}日`;
  if (days < 365) return `${Math.floor(days / 30)}か月`;
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  return months > 0 ? `${years}年${months}か月` : `${years}年`;
}

const BASIS = { EXACT: "正確", AT_LEAST: "少なくとも", TRACKED_SINCE: "記録開始から" } as const;
const SOURCE = {
  USER_CONFIRMED: "ユーザー確認",
  BROKER_TRADE: "取引履歴",
  MONTHLY_SNAPSHOT: "月次記録",
  SYSTEM_IMPORT: "システム記録",
} as const;

export function HoldingDurationSummary({ duration }: { duration: HoldingDurationView | null }) {
  if (!duration) return <span>—</span>;
  return (
    <span className="block">
      <span className="block text-base font-semibold">
        {BASIS[duration.confidence]} {durationText(duration.days)}
      </span>
      <span className="mt-1 block text-xs font-normal text-muted-foreground">
        {new Date(duration.startDate).toLocaleDateString("ja-JP")}（{SOURCE[duration.source]}）
      </span>
    </span>
  );
}

const QUALITY = { STRONG: "材料充足", MODERATE: "材料あり", LIMITED: "材料限定" } as const;
const STALE_REASON = {
  SCHEMA: "新しい分析形式で再判定が必要",
  EXPIRED: "通常の再確認期限を経過",
  NEW_NEWS: "分析後に新しいニュースあり",
  CARD_UPDATED: "分析後に投資カード更新あり",
  PRICE_MOVE: "分析時から株価が10%以上変動",
} as const;

export type DecisionMetaSignal = {
  dataQuality: keyof typeof QUALITY | null;
  freshness: SignalFreshness;
  validUntil: Date | string | null;
  reviewTriggers: string[];
  riskFlags: string[];
  reviewPlan?: SignalReviewPlan;
};

export function SignalQualityBadges({ signal }: { signal: DecisionMetaSignal }) {
  return (
    <>
      {signal.dataQuality ? (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{QUALITY[signal.dataQuality]}</Badge>
      ) : null}
      <Badge
        variant="outline"
        className={`h-5 px-1.5 text-[10px] ${signal.freshness.isStale ? "border-amber-300 bg-amber-50 text-amber-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}`}
      >
        {signal.freshness.isStale ? "再分析待ち" : "最新"}
      </Badge>
    </>
  );
}

export function SignalDecisionMeta({ signal }: { signal: DecisionMetaSignal }) {
  const reviewPlan = signal.reviewPlan ?? buildSignalReviewPlan({
    validUntil: signal.validUntil,
    reviewTriggers: signal.reviewTriggers,
  });
  return (
    <>
      {signal.freshness.isStale ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
          <span className="font-medium">再分析が必要です。</span>{" "}
          {signal.freshness.reasons.map(reason => STALE_REASON[reason]).join("・")}
        </div>
      ) : null}
      <SignalReviewPlanCard plan={reviewPlan} />
      {signal.riskFlags.length > 0 ? (
        <div className="grid gap-3">
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="mb-2 text-xs font-medium">確認中のリスク</p>
            <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
              {signal.riskFlags.map((item, index) => <li key={`${item}-${index}`}>・{item}</li>)}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
