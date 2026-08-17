/**
 * 買い増しプランの判定が変わった履歴。
 *
 * 月 1 回程度しか画面を開かない使い方だと、その間に株価が買い増し圏へ
 * 下がって戻っていても気付けない。切り替わった時点を並べることで
 * 「8/20 に打診買い圏に入り 8/25 に抜けた」と後から追える。
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Check, History } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

/** 重要度ごとの見せ方。判断を要するものだけ色を付ける */
const IMPORTANCE_STYLE: Record<string, { label: string; className: string }> = {
  HIGH: {
    label: "要判断",
    className:
      "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  },
  MEDIUM: {
    label: "参考",
    className:
      "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  },
  LOW: { label: "記録", className: "border-border bg-muted/50 text-muted-foreground" },
};

function formatDate(d: Date | string) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

/**
 * 価格の表示。
 * 記号を持たない通貨（SGD / HKD など）は記号を省くと単位が分からなくなるので
 * 通貨コードをそのまま前に置く。
 */
function formatPrice(price: number, currency: string | null): string {
  const num = price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (currency === "JPY") return `¥${num}`;
  if (currency === "USD") return `$${num}`;
  return currency ? `${currency} ${num}` : num;
}

export function TransitionHistoryCard() {
  /*
   * 既定では「要判断・参考」だけを出す。
   * 静観のままの記録（LOW）は 100 件以上あり、混ぜると重要な変化が埋もれる。
   */
  const [showAll, setShowAll] = useState(false);
  const utils = trpc.useUtils();
  const { data, isPending, isError, error } = trpc.portfolio.bandTransitions.useQuery({
    limit: 300,
  });
  const acknowledge = trpc.portfolio.acknowledgeBandTransitions.useMutation({
    onSuccess: () => utils.portfolio.bandTransitions.invalidate(),
  });

  if (isPending) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">判定が変わった履歴</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-rose-600">
          履歴を読み込めませんでした: {error.message}
        </CardContent>
      </Card>
    );
  }

  const rows = data ?? [];
  const notable = rows.filter(r => r.importance !== "LOW");
  const shown = showAll ? rows : notable;
  const unacknowledged = notable.filter(r => r.acknowledgedAt === null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-base">
              <History className="h-4 w-4" />
              判定が変わった履歴
            </CardTitle>
            <CardDescription className="text-xs">
              株価更新のたびに判定を比べ、変わったときだけ記録します。
              同じ段の中で株価が動いただけでは残しません。
            </CardDescription>
          </div>
          {unacknowledged.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate({})}
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              {unacknowledged.length} 件を確認済みに
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            判定が変わった記録はまだありません
          </p>
        ) : (
          shown.slice(0, 30).map(r => {
            const style = IMPORTANCE_STYLE[r.importance] ?? IMPORTANCE_STYLE.LOW;
            return (
              <Link
                key={r.id}
                href={`/holdings?symbol=${encodeURIComponent(r.symbol)}`}
                className="block rounded-md border px-2.5 py-2 transition-colors hover:bg-accent/50"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${style.className}`}>
                    {style.label}
                  </Badge>
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <span className="tabular ml-auto shrink-0 text-[11px] text-muted-foreground">
                    {formatDate(r.createdAt)}
                    {r.price !== null ? (
                      <span className="ml-1.5 border-l pl-1.5">
                        {formatPrice(r.price, r.currency)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  {r.fromLabel ? (
                    <>
                      <span className="truncate">{r.fromLabel}</span>
                      <ArrowRight className="h-3 w-3 shrink-0" />
                    </>
                  ) : null}
                  <span className="truncate text-foreground">
                    {r.outsideDirection === "ABOVE"
                      ? "価格帯より上（対象外）"
                      : r.outsideDirection === "BELOW"
                        ? "価格帯より下（想定を超える下落）"
                        : (r.toLabel ?? "不明")}
                  </span>
                  {r.priceChangePct !== null ? (
                    <span className="tabular ml-1 shrink-0">
                      （株価 {r.priceChangePct > 0 ? "+" : ""}
                      {r.priceChangePct.toFixed(1)}%）
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })
        )}

        {rows.length > notable.length ? (
          <button
            type="button"
            onClick={() => setShowAll(v => !v)}
            className="w-full pt-1 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showAll
              ? "判断が必要なものだけ表示"
              : `静観のままの記録も表示（ほか ${rows.length - notable.length} 件）`}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}
