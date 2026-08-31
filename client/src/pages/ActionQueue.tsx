import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ListChecks,
  RefreshCw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Link } from "wouter";

const VIEW_OPTIONS = [
  { value: "ACTIVE", label: "対応中" },
  { value: "PENDING", label: "確認待ち" },
  { value: "APPROVED", label: "計画済み" },
  { value: "HISTORY", label: "履歴" },
  { value: "SKIP_REVIEWS", label: "見送り検証" },
] as const;

type View = (typeof VIEW_OPTIONS)[number]["value"];

function formatShares(value: number | null) {
  if (value === null) return "—";
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 }).format(value)} 株`;
}

function formatMoney(value: number | null) {
  if (value === null) return "—";
  const abs = Math.abs(value);
  if (abs >= 10_000)
    return `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value / 10_000)}万`;
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value: number | null) {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

const actionLabel = {
  ADD: "買い増し検討",
  HOLD: "継続保有",
  WATCH: "材料確認",
  REDUCE: "一部売却検討",
  EXIT: "退出検討",
} as const;

const statusLabel = {
  WAITING_MATERIAL: "材料待ち",
  REANALYZING: "再分析中",
  PENDING_ACTION: "確認待ち",
  APPROVED: "計画済み",
  SNOOZED: "あとで確認",
  SKIPPED: "見送り",
  COMPLETED: "確認済み",
  FAILED: "再試行待ち",
} as const;

export default function ActionQueue() {
  const [view, setView] = useState<View>("ACTIVE");
  const [skipTarget, setSkipTarget] = useState<{
    id: number;
    name: string;
    symbol: string;
  } | null>(null);
  const [skipNote, setSkipNote] = useState("");
  const isSkipReviewView = view === "SKIP_REVIEWS";
  const utils = trpc.useUtils();
  const list = trpc.actionQueue.list.useQuery(
    { view: isSkipReviewView ? "ACTIVE" : view, limit: 100 },
    { enabled: !isSkipReviewView }
  );
  const summary = trpc.actionQueue.summary.useQuery();
  const skipReviews = trpc.actionQueue.skipReviews.useQuery(
    { limit: 100 },
    { enabled: isSkipReviewView }
  );
  const skipReviewSummary = trpc.actionQueue.skipReviewSummary.useQuery(
    undefined,
    { enabled: isSkipReviewView }
  );
  const backfill = trpc.actionQueue.backfillInitial.useMutation({
    onSuccess: result => {
      toast.success(`${result.queued} 銘柄をアクション待ちに整理しました`);
      void Promise.all([
        utils.actionQueue.list.invalidate(),
        utils.actionQueue.summary.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });
  const decide = trpc.actionQueue.decide.useMutation({
    onSuccess: result => {
      toast.success(statusLabel[result.status]);
      void Promise.all([
        utils.actionQueue.list.invalidate(),
        utils.actionQueue.summary.invalidate(),
        utils.actionQueue.skipReviews.invalidate(),
        utils.actionQueue.skipReviewSummary.invalidate(),
      ]);
      if (result.status === "SKIPPED") {
        setSkipTarget(null);
        setSkipNote("");
      }
    },
    onError: error => toast.error(error.message),
  });

  return (
    <div className="mx-auto max-w-[1280px] space-y-5 pb-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-primary">
            ACTION CONTROL
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            アクション待ち
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            決算・重要材料後の具体案です。AI
            は注文せず、計画への追加は必ず本人が確認します。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => backfill.mutate()}
          disabled={backfill.isPending}
          className="self-start bg-background sm:self-auto"
        >
          <RefreshCw
            className={`h-4 w-4 ${backfill.isPending ? "animate-spin" : ""}`}
          />
          既存シグナルを整理
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Summary
          label="確認待ち"
          value={summary.data?.pending ?? 0}
          tone="amber"
        />
        <Summary
          label="48時間以内"
          value={summary.data?.urgent ?? 0}
          tone="red"
        />
        <Summary
          label="計画済み"
          value={summary.data?.approved ?? 0}
          tone="green"
        />
        <Summary
          label="あとで確認"
          value={summary.data?.snoozed ?? 0}
          tone="slate"
        />
      </section>

      <div className="flex gap-1 overflow-x-auto rounded-xl border bg-card p-1">
        {VIEW_OPTIONS.map(option => (
          <Button
            key={option.value}
            size="sm"
            variant={view === option.value ? "default" : "ghost"}
            onClick={() => setView(option.value)}
            className="shrink-0"
          >
            {option.label}
          </Button>
        ))}
      </div>

      {isSkipReviewView ? (
        <SkipReviewPanel
          reviews={skipReviews.data ?? []}
          isLoading={skipReviews.isLoading}
          error={skipReviews.error?.message ?? null}
          summary={skipReviewSummary.data}
        />
      ) : list.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : list.data?.length ? (
        <div className="space-y-3">
          {list.data.map(item => {
            const evidence = (item.evidence ?? {}) as {
              reviewTriggers?: string[];
              riskFlags?: string[];
              accountCount?: number;
              planRationale?: string;
              sizingReasons?: string[];
            };
            const isBusy = decide.isPending && decide.variables?.id === item.id;
            const isHistory =
              item.status === "SKIPPED" || item.status === "COMPLETED";
            const isApproved = item.status === "APPROVED";
            const ActionIcon =
              item.direction === "BUY"
                ? ArrowUpRight
                : item.direction === "SELL" || item.direction === "EXIT"
                  ? ArrowDownRight
                  : ShieldCheck;
            return (
              <Card
                key={item.id}
                className="overflow-hidden border-border/70 shadow-sm"
              >
                <CardContent className="p-0">
                  <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">{item.name}</h2>
                        <Badge variant="outline">{item.symbol}</Badge>
                        {item.action ? (
                          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                            {actionLabel[item.action]}
                          </Badge>
                        ) : null}
                        <Badge variant="outline">
                          {statusLabel[item.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.triggerSummary || "シグナル更新"} ·{" "}
                        {item.triggerType === "INITIAL_REVIEW"
                          ? "既存判断の初回整理"
                          : "新しい材料から再判定"}
                      </p>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <p className="text-xs text-muted-foreground">確認期限</p>
                      <p className="font-mono text-sm font-semibold">
                        {item.deadline
                          ? new Date(item.deadline).toLocaleDateString(
                              "ja-JP",
                              { timeZone: "Asia/Tokyo" }
                            )
                          : "未設定"}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-px bg-border/60 sm:grid-cols-[1fr_auto_1fr]">
                    <PositionBlock
                      label="現在"
                      shares={item.currentQuantity}
                      weight={item.currentWeightPct}
                      amount={item.currentValueBase}
                    />
                    <div className="flex items-center justify-center bg-card px-3 py-2 text-primary">
                      <ActionIcon className="h-5 w-5" />
                    </div>
                    <PositionBlock
                      label="実行後"
                      shares={item.afterQuantity}
                      weight={item.afterWeightPct}
                      amount={null}
                    />
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="rounded-xl border border-primary/15 bg-primary/[0.04] p-3">
                      <p className="text-xs font-semibold text-primary">
                        今回の具体案
                      </p>
                      <p className="mt-1 text-base font-semibold">
                        {item.direction === "BUY"
                          ? "買い増し"
                          : item.direction === "SELL"
                            ? "一部売却"
                            : item.direction === "EXIT"
                              ? "全売却を検討"
                              : "材料を確認"}
                        {item.recommendedShares !== null &&
                        item.recommendedShares > 0
                          ? ` ${formatShares(item.recommendedShares)}`
                          : ""}
                        {item.recommendedAmountBase !== null &&
                        item.recommendedAmountBase > 0
                          ? `（概算 ${formatMoney(item.recommendedAmountBase)}）`
                          : ""}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {item.rationale || "理由を確認中です"}
                      </p>
                    </div>

                    {[
                      ...(evidence.reviewTriggers ?? []),
                      ...(evidence.riskFlags ?? []),
                    ].length > 0 ? (
                      <details className="rounded-xl border px-3 py-2 text-sm">
                        <summary className="cursor-pointer font-medium">
                          判断理由と確認事項
                        </summary>
                        <ul className="mt-2 space-y-1 text-muted-foreground">
                          {[
                            ...(evidence.reviewTriggers ?? []),
                            ...(evidence.riskFlags ?? []),
                            ...(evidence.sizingReasons ?? []),
                          ]
                            .slice(0, 6)
                            .map((text, index) => (
                              <li key={`${text}-${index}`}>・{text}</li>
                            ))}
                        </ul>
                      </details>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/holdings?symbol=${encodeURIComponent(item.symbol)}`}
                        className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        保有詳細を見る <ArrowRight className="h-4 w-4" />
                      </Link>
                      {!isHistory ? (
                        <>
                          {!isApproved ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                decide.mutate({
                                  id: item.id,
                                  decision: "APPROVE",
                                })
                              }
                              disabled={isBusy}
                            >
                              <ListChecks className="h-4 w-4" /> 計画に追加
                            </Button>
                          ) : null}
                          {isApproved ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                decide.mutate({
                                  id: item.id,
                                  decision: "COMPLETE",
                                })
                              }
                              disabled={isBusy}
                            >
                              <CheckCircle2 className="h-4 w-4" /> 確認済み
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                decide.mutate({
                                  id: item.id,
                                  decision: "SNOOZE",
                                  snoozeDays: 3,
                                })
                              }
                              disabled={isBusy}
                            >
                              <Clock3 className="h-4 w-4" /> あとで確認
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSkipTarget({
                                id: item.id,
                                name: item.name,
                                symbol: item.symbol,
                              });
                              setSkipNote("");
                            }}
                            disabled={isBusy}
                          >
                            今回は見送る
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 font-semibold">
                現在、対応が必要な銘柄はありません
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                決算・重要材料後の再分析で、具体的な行動だけがここに入ります。
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={skipTarget !== null}
        onOpenChange={open => {
          if (!open && !decide.isPending) {
            setSkipTarget(null);
            setSkipNote("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>今回の見送り理由を記録</DialogTitle>
            <DialogDescription>
              {skipTarget
                ? `${skipTarget.name}（${skipTarget.symbol}）を見送る時点の判断を保存します。後日の値動きで理由を書き換えることはありません。`
                : "見送り理由を保存します。"}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={skipNote}
            onChange={event => setSkipNote(event.target.value)}
            placeholder="例：決算の受注推移を確認するまで待つ／IBKR 借入を増やさない／現在の構成比が高い"
            rows={5}
            maxLength={1000}
            disabled={decide.isPending}
          />
          <p className="text-xs leading-5 text-muted-foreground">
            30・90・180日後と次の決算後に、判断過程と結果を別々に検証します。価格が上がっただけで「間違い」とは判定しません。
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSkipTarget(null);
                setSkipNote("");
              }}
              disabled={decide.isPending}
            >
              戻る
            </Button>
            <Button
              variant="destructive"
              disabled={!skipTarget || skipNote.trim().length < 4 || decide.isPending}
              onClick={() => {
                if (!skipTarget) return;
                decide.mutate({
                  id: skipTarget.id,
                  decision: "SKIP",
                  note: skipNote.trim(),
                });
              }}
            >
              理由を保存して見送る
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SkipReviewView = {
  id: number;
  symbol: string;
  name: string;
  action: "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT" | null;
  direction: "BUY" | "SELL" | "EXIT" | "REVIEW" | "NONE" | null;
  status: "OPEN" | "CLOSED";
  currency: string;
  skippedAt: Date;
  decisionNote: string | null;
  processQuality:
    | "DISCIPLINE_SOUND"
    | "DISCIPLINE_NEEDS_IMPROVEMENT"
    | "PROCESS_UNCLEAR";
  processReasons: string[];
  baselinePrice: number | null;
  recommendedAmountBase: number | null;
  latestPrice: number | null;
  latestObservedAt: Date | null;
  observationCount: number;
  milestones: Array<{
    id: number;
    milestoneType: "DAY_30" | "DAY_90" | "DAY_180" | "AFTER_EARNINGS";
    dueAt: Date;
    status: "PENDING" | "COMPLETED" | "CANCELLED";
    currentPrice: number | null;
    returnPct: number | null;
    maxUpsidePct: number | null;
    maxDrawdownPct: number | null;
    observedTradingDays: number;
    outcomeQuality:
      | "OUTCOME_FAVORABLE"
      | "OUTCOME_UNFAVORABLE"
      | "OUTCOME_NOT_YET_CLEAR"
      | null;
    summary: string | null;
    counterfactualEffectBase: number | null;
    evaluatedAt: Date | null;
  }>;
};

const processLabel = {
  DISCIPLINE_SOUND: "判断過程は規律的",
  DISCIPLINE_NEEDS_IMPROVEMENT: "判断過程に改善余地",
  PROCESS_UNCLEAR: "判断過程は資料不足",
} as const;

const outcomeLabel = {
  OUTCOME_FAVORABLE: "見送り後の結果は有利",
  OUTCOME_UNFAVORABLE: "見送り後の結果は不利",
  OUTCOME_NOT_YET_CLEAR: "結果はまだ不明確",
} as const;

const milestoneLabel = {
  DAY_30: "30日",
  DAY_90: "90日",
  DAY_180: "180日",
  AFTER_EARNINGS: "次の決算後",
} as const;

function formatReviewDate(value: Date) {
  return new Date(value).toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function signedPct(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function SkipReviewPanel({
  reviews,
  isLoading,
  error,
  summary,
}: {
  reviews: SkipReviewView[];
  isLoading: boolean;
  error: string | null;
  summary?: {
    total: number;
    open: number;
    pendingMilestones: number;
    completedMilestones: number;
    needsProcessImprovement: number;
  };
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1].map(index => <Skeleton key={index} className="h-80 rounded-2xl" />)}
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-rose-600">
          見送り検証を読み込めませんでした: {error}
        </CardContent>
      </Card>
    );
  }
  if (reviews.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="grid min-h-56 place-items-center p-8 text-center">
          <div>
            <Scale className="mx-auto size-8 text-primary" />
            <p className="mt-3 font-semibold">まだ見送り検証はありません</p>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              今後「今回は見送る」を選ぶと、当時の理由を固定し、30・90・180日後と次の決算後に検証します。
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/20">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="font-semibold">判断過程と結果を分けて検証</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              値上がり・値下がりだけで当時の判断を採点しません。見送り時点の規律と、その後の結果を独立して記録します。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-background p-2"><b className="block text-base">{summary?.open ?? 0}</b>検証中</div>
            <div className="rounded-lg bg-background p-2"><b className="block text-base">{summary?.completedMilestones ?? 0}</b>完了節目</div>
            <div className="rounded-lg bg-background p-2"><b className="block text-base">{summary?.needsProcessImprovement ?? 0}</b>改善候補</div>
          </div>
        </CardContent>
      </Card>

      {reviews.map(review => (
        <Card key={review.id} className="overflow-hidden shadow-sm">
          <CardContent className="p-0">
            <div className="border-b bg-muted/20 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{review.name}</h2>
                    <Badge variant="outline">{review.symbol}</Badge>
                    <Badge variant="outline">
                      {review.action ? actionLabel[review.action] : "判断記録"}
                    </Badge>
                    <Badge variant={review.status === "OPEN" ? "default" : "secondary"}>
                      {review.status === "OPEN" ? "検証中" : "検証完了"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatReviewDate(review.skippedAt)} に見送り · 日次観測 {review.observationCount} 日
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-xs text-muted-foreground">基準 → 最新</p>
                  <p className="font-mono text-sm font-semibold">
                    {review.baselinePrice?.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) ?? "—"}
                    {" → "}
                    {review.latestPrice?.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) ?? "—"} {review.currency}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {review.latestObservedAt ? `${formatReviewDate(review.latestObservedAt)} 観測` : "価格観測待ち"}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-px bg-border/60 lg:grid-cols-2">
              <div className="space-y-2 bg-card p-4">
                <p className="text-xs font-semibold tracking-wide text-primary">PROCESS QUALITY</p>
                <p className="font-semibold">{processLabel[review.processQuality]}</p>
                <p className="rounded-lg bg-muted/50 p-3 text-sm leading-6">
                  {review.decisionNote || "見送り理由は記録されていません"}
                </p>
                {review.processReasons.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {review.processReasons.map((reason, index) => (
                      <li key={`${reason}-${index}`}>・{reason}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2 bg-card p-4">
                <p className="text-xs font-semibold tracking-wide text-indigo-600">OUTCOME QUALITY</p>
                <div className="space-y-2">
                  {review.milestones.map(milestone => (
                    <div key={milestone.id} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{milestoneLabel[milestone.milestoneType]}検証</p>
                        <Badge variant="outline">
                          {milestone.status === "COMPLETED"
                            ? milestone.outcomeQuality
                              ? outcomeLabel[milestone.outcomeQuality]
                              : "完了"
                            : `${formatReviewDate(milestone.dueAt)} 予定`}
                        </Badge>
                      </div>
                      {milestone.status === "COMPLETED" ? (
                        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                          <p>
                            基準比 {signedPct(milestone.returnPct)} · 記録開始後の上昇 {signedPct(milestone.maxUpsidePct)} · 下落 {signedPct(milestone.maxDrawdownPct)}
                          </p>
                          {milestone.counterfactualEffectBase !== null && (
                            <p>
                              もし当時実行していた場合の概算差分 {milestone.counterfactualEffectBase >= 0 ? "+" : ""}{formatMoney(milestone.counterfactualEffectBase)}
                            </p>
                          )}
                          <p>{milestone.summary || "評価内容を記録しました"}</p>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          到期後に価格経路と新しい材料を確認します。日々の通知は送りません。
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "amber" | "red" | "green" | "slate";
}) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    red: "border-red-200 bg-red-50 text-red-950",
    green: "border-emerald-200 bg-emerald-50 text-emerald-950",
    slate: "border-slate-200 bg-slate-50 text-slate-900",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="text-[11px] font-medium opacity-70">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
    </div>
  );
}

function PositionBlock({
  label,
  shares,
  weight,
  amount,
}: {
  label: string;
  shares: number | null;
  weight: number | null;
  amount: number | null;
}) {
  return (
    <div className="bg-card p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-base font-semibold">
        {formatShares(shares)}
      </p>
      <p className="text-xs text-muted-foreground">
        構成比 {formatPct(weight)}
        {amount !== null ? ` · ${formatMoney(amount)}` : ""}
      </p>
    </div>
  );
}
