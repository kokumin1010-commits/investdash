import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  ListChecks,
  RefreshCw,
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
  const utils = trpc.useUtils();
  const list = trpc.actionQueue.list.useQuery({ view, limit: 100 });
  const summary = trpc.actionQueue.summary.useQuery();
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
      ]);
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

      {list.isLoading ? (
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
                            onClick={() =>
                              decide.mutate({ id: item.id, decision: "SKIP" })
                            }
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
