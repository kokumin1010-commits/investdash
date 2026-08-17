import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * 株価データの健全性。
 *
 * 自動更新は稼働しているが、失敗した銘柄があっても気付けなかった。
 * 古い株価で買い増し圏を判定すると、実際には圏外なのに「買い場」と
 * 出てしまう。判断を誤らせる方向の不具合なので、常時見える場所に置く。
 *
 * 正常なときは 1 行に収める。毎回大きく出すと見なくなり、
 * 本当に古くなったときの警告も読み飛ばされる。
 */

function manYen(jpy: number): string {
  if (jpy >= 100_000_000) return `${(jpy / 100_000_000).toFixed(2)} 億円`;
  return `${Math.round(jpy / 10_000).toLocaleString("ja-JP")} 万円`;
}

/**
 * @param showSyncButton 更新ボタンを出すか。ダッシュボードには既に
 *   「株価更新」があるので、そこでは出さない（同じ操作が 2 つ並ぶと迷う）。
 */
export function DataHealthCard({ showSyncButton = true }: { showSyncButton?: boolean }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.portfolio.dataHealth.useQuery();
  const [busy, setBusy] = useState(false);

  const sync = trpc.portfolio.syncPrices.useMutation({
    onSuccess: res => {
      setBusy(false);
      void utils.portfolio.dataHealth.invalidate();
      void utils.portfolio.overview.invalidate();
      if (res.failed.length > 0) {
        // 失敗した銘柄名を出す。件数だけでは何を直せばよいか分からない
        toast.warning(`${res.updated} 件を更新、${res.failed.length} 件が失敗`, {
          description: res.failed.slice(0, 5).join(" / "),
        });
      } else {
        toast.success(`${res.updated} 件の株価を更新しました`);
      }
    },
    onError: err => {
      setBusy(false);
      toast.error("株価の更新に失敗しました", { description: err.message });
    },
  });

  if (isLoading || !data) return null;

  const { summary, problems, lastSyncAt } = data;
  const ok = summary.problem === 0;

  return (
    <Card
      className={
        ok
          ? "border-border"
          : "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30"
      }
    >
      <CardContent className="space-y-2.5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {ok ? (
            <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          ) : (
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          )}
          <span className="text-sm font-medium">
            {ok ? "株価データは最新です" : `${summary.problem} 銘柄の株価が古くなっています`}
          </span>
          <span className="text-muted-foreground text-xs">
            {summary.total} 銘柄を確認
            {lastSyncAt
              ? ` / 最終更新 ${new Date(lastSyncAt).toLocaleString("ja-JP", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
          {showSyncButton ? (
            <Button
              size="sm"
              variant="outline"
              className="bg-background ml-auto"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                sync.mutate();
              }}
            >
              <RefreshCw className={`mr-1.5 size-3.5 ${busy ? "animate-spin" : ""}`} />
              {busy ? "更新中..." : "今すぐ更新"}
            </Button>
          ) : null}
        </div>

        {!ok && (
          <>
            <p className="text-muted-foreground text-xs leading-relaxed">
              古い株価のままだと、実際には買い増しの価格帯に入っていない銘柄が
              「買い場」と表示されることがあります。
            </p>
            <div className="space-y-1.5">
              {problems.slice(0, 8).map(p => (
                <div
                  key={p.symbol}
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                >
                  <Badge
                    variant="outline"
                    className={
                      p.level === "MISSING"
                        ? "border-rose-300 bg-rose-100/60 text-[10px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                        : "border-amber-300 bg-amber-100/60 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    }
                  >
                    {p.level === "MISSING" ? "取得できず" : "古い"}
                  </Badge>
                  <span className="font-medium">{p.name}</span>
                  <span className="tabular text-muted-foreground">{p.symbol}</span>
                  <span className="text-muted-foreground">{p.label}</span>
                  {p.valueJpy !== null ? (
                    <span className="tabular text-muted-foreground">{manYen(p.valueJpy)}</span>
                  ) : (
                    <span className="text-muted-foreground">未保有</span>
                  )}
                </div>
              ))}
              {problems.length > 8 ? (
                <p className="text-muted-foreground text-xs">ほか {problems.length - 8} 銘柄</p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
