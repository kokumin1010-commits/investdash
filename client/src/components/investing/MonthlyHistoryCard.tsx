import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDownRight, ArrowUpRight, CalendarClock, Minus, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/** 月の表記を「2026年8月」の形にする。 */
function labelOf(periodYm: string): string {
  const [y, m] = periodYm.split("-");
  if (!y || !m) return periodYm;
  return `${y}年${Number(m)}月`;
}

function yen(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function signedYen(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const s = n >= 0 ? "+" : "−";
  return `${s}¥${Math.round(Math.abs(n)).toLocaleString("ja-JP")}`;
}

const KIND_LABEL: Record<string, string> = {
  NEW: "新規",
  SOLD: "売却",
  ADDED: "買い増し",
  REDUCED: "一部売却",
  SAME: "変化なし",
};

const KIND_STYLE: Record<string, string> = {
  NEW: "border-sky-300 bg-sky-50 text-sky-700",
  SOLD: "border-rose-300 bg-rose-50 text-rose-700",
  ADDED: "border-emerald-300 bg-emerald-50 text-emerald-700",
  REDUCED: "border-amber-300 bg-amber-50 text-amber-700",
  SAME: "border-border bg-muted/40 text-muted-foreground",
};

/**
 * 月ごとの保有記録と、前回記録との差分を表示する。
 *
 * 月 1 回スクショを送る使い方のため、記録がないと「売った銘柄」が
 * 行ごと消えて後から追えない。ここで記録の有無と差分を見せる。
 */
export function MonthlyHistoryCard() {
  const utils = trpc.useUtils();
  const list = trpc.import.monthlyList.useQuery();
  const [showSame, setShowSame] = useState(false);

  const compare = trpc.import.monthlyCompare.useQuery(
    {},
    { enabled: (list.data?.length ?? 0) >= 2 }
  );

  const save = trpc.import.monthlySave.useMutation({
    onSuccess: r => {
      toast.success(
        `${labelOf(r.periodYm)} の記録を${r.replaced ? "更新" : "保存"}しました（${r.symbolCount} 銘柄）`
      );
      void utils.import.monthlyList.invalidate();
      void utils.import.monthlyCompare.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const remove = trpc.import.monthlyDelete.useMutation({
    onSuccess: () => {
      toast.success("記録を削除しました");
      void utils.import.monthlyList.invalidate();
      void utils.import.monthlyCompare.invalidate();
    },
    onError: e => toast.error(e.message),
  });

  const changed = useMemo(
    () => (compare.data?.rows ?? []).filter(r => r.kind !== "SAME"),
    [compare.data]
  );
  const same = useMemo(
    () => (compare.data?.rows ?? []).filter(r => r.kind === "SAME"),
    [compare.data]
  );

  if (list.isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">月ごとの記録</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  const rows = list.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-1.5 text-base">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              月ごとの記録
            </CardTitle>
            <CardDescription className="text-xs">
              取込のたびにその時点の保有を保存します。次の月と比べて売買が分かります。
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={save.isPending}
            onClick={() => save.mutate({})}
          >
            今の状態を記録する
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            まだ記録がありません。スクリーンショットを取り込むと自動で保存されます。
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div
                key={r.periodYm}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{labelOf(r.periodYm)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.symbolCount} 銘柄 / {r.recordCount} 口座分
                    {r.usdJpy ? ` ・ 1ドル ${r.usdJpy.toFixed(2)} 円` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="tabular text-sm font-semibold">{yen(r.totalValueJpy)}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      純資産 {yen(r.netAssetsJpy)}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ periodYm: r.periodYm })}
                    aria-label={`${labelOf(r.periodYm)} の記録を削除`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {rows.length === 1 && (
          <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            比べる相手がまだありません。次の月に取り込むと、増えた分が値上がりによるものか
            買い増しによるものかを分けて表示します。
          </p>
        )}

        {compare.data && (
          <div className="space-y-3 rounded-lg border border-border/70 p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="text-sm font-semibold">
                {labelOf(compare.data.fromPeriod)} → {labelOf(compare.data.toPeriod)}
              </p>
              {compare.data.totals && (
                <p className="tabular text-xs text-muted-foreground">
                  {yen(compare.data.totals.fromValueJpy)} →{" "}
                  {yen(compare.data.totals.toValueJpy)}（
                  {signedYen(
                    compare.data.totals.toValueJpy - compare.data.totals.fromValueJpy
                  )}
                  ）
                </p>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md bg-muted/40 px-2.5 py-2">
                <p className="text-xs text-muted-foreground">買い増し・新規</p>
                <p className="tabular text-sm font-semibold text-emerald-700">
                  {signedYen(
                    compare.data.breakdown.newBuyJpy + compare.data.breakdown.addedCostJpy
                  )}
                </p>
              </div>
              <div className="rounded-md bg-muted/40 px-2.5 py-2">
                <p className="text-xs text-muted-foreground">売却</p>
                <p className="tabular text-sm font-semibold text-rose-700">
                  {signedYen(
                    compare.data.breakdown.soldJpy + compare.data.breakdown.reducedJpy
                  )}
                </p>
              </div>
              <div className="rounded-md bg-muted/40 px-2.5 py-2">
                <p className="text-xs text-muted-foreground">値動きによる分</p>
                <p className="tabular text-sm font-semibold">
                  {signedYen(compare.data.breakdown.priceMoveJpy)}
                </p>
              </div>
            </div>

            {changed.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                売買はありませんでした（値動きのみ）。
              </p>
            ) : (
              <div className="space-y-1.5">
                {changed.map(r => (
                  <div
                    key={`${r.symbol}-${r.broker}`}
                    className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border border-border/60 px-2.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[11px] ${KIND_STYLE[r.kind] ?? ""}`}
                      >
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </Badge>
                      <Link
                        href={`/holdings?symbol=${encodeURIComponent(r.symbol)}`}
                        className="truncate text-sm hover:underline"
                      >
                        {r.name}
                      </Link>
                      <span className="shrink-0 text-xs text-muted-foreground">{r.symbol}</span>
                    </div>
                    <div className="tabular flex shrink-0 items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {r.prevQuantity.toLocaleString("ja-JP")} →{" "}
                        {r.currQuantity.toLocaleString("ja-JP")} 株
                      </span>
                      {r.quantityDelta !== 0 && (
                        <span
                          className={
                            r.quantityDelta > 0
                              ? "flex items-center text-emerald-700"
                              : "flex items-center text-rose-700"
                          }
                        >
                          {r.quantityDelta > 0 ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          {Math.abs(r.quantityDelta).toLocaleString("ja-JP")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {same.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setShowSame(v => !v)}
              >
                {showSame ? (
                  <>
                    <Minus className="mr-1 h-3 w-3" />
                    変化のない {same.length} 件を隠す
                  </>
                ) : (
                  <>
                    <Plus className="mr-1 h-3 w-3" />
                    変化のない {same.length} 件を見る
                  </>
                )}
              </Button>
            )}

            {showSame && (
              <div className="space-y-1">
                {same.map(r => (
                  <div
                    key={`same-${r.symbol}-${r.broker}`}
                    className="flex flex-wrap items-center justify-between gap-x-2 rounded-md px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    <span className="truncate">
                      {r.name} <span className="opacity-70">{r.symbol}</span>
                    </span>
                    <span className="tabular shrink-0">
                      {r.currQuantity.toLocaleString("ja-JP")} 株
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
