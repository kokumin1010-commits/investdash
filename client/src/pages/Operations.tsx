import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const KIND_LABELS: Record<string, string> = {
  price_sync_jp: "日本株価更新",
  price_sync_us: "米国株価更新",
  news_sync: "ニュース同期",
  profile_backfill: "企業情報補完",
  signal_backfill: "保有判断補完",
  price_band_plan_backfill: "価格帯プラン補完",
  investment_card_backfill: "投資カード補完",
  band_check_backfill: "価格帯確認",
  monthly_snapshot: "月次記録",
};

const STATUS_LABELS = {
  RUNNING: "実行中",
  SUCCESS: "成功",
  PARTIAL: "一部失敗",
  FAILED: "失敗",
  SKIPPED: "見送り",
} as const;

const TRIGGER_LABELS = {
  SCHEDULED: "自動",
  MANUAL: "手動",
  STARTUP: "起動時",
} as const;

const DETAIL_LABELS: Record<string, string> = {
  batch: "バッチ",
  offset: "開始位置",
  fetched: "取得",
  analyzed: "分析済み",
  analysisUnavailable: "分析未完了",
  failedSymbols: "失敗銘柄",
  deferredSymbols: "一時保留銘柄",
  quotaExhausted: "AI 利用枠上限",
  nextOffset: "次の開始位置",
  transitions: "価格帯移動",
  notes: "メモ追加",
  monthlyPeriod: "月次記録",
  itemsChecked: "照合項目",
};

type Status = keyof typeof STATUS_LABELS;
type Trigger = keyof typeof TRIGGER_LABELS;

function statusClass(status: Status): string {
  if (status === "SUCCESS") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "PARTIAL") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "FAILED") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "RUNNING") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatDate(value: Date | string): string {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(startedAt: Date | string, finishedAt: Date | string | null): string {
  if (!finishedAt) return "実行中";
  const ms = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}秒`;
}

function detailText(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const entries = Object.entries(detail as Record<string, unknown>).filter(([, value]) => {
    if (value === null || value === undefined || value === false) return false;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) =>
      `${DETAIL_LABELS[key] ?? key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`
    )
    .join(" / ");
}

export default function Operations() {
  const [kind, setKind] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [trigger, setTrigger] = useState("ALL");
  const [windowDays, setWindowDays] = useState("7");
  const [anchor, setAnchor] = useState(() => Date.now());

  const input = useMemo(
    () => ({
      kind: kind === "ALL" ? undefined : kind,
      status: status === "ALL" ? undefined : (status as Status),
      trigger: trigger === "ALL" ? undefined : (trigger as Trigger),
      from: new Date(anchor - Number(windowDays) * 86_400_000),
      limit: 200,
    }),
    [anchor, kind, status, trigger, windowDays]
  );
  const query = trpc.portfolio.schedulerRuns.useQuery(input, {
    refetchInterval: data => (data.state.data?.stats.running ? 5000 : false),
  });
  const rows = query.data?.rows ?? [];
  const stats = query.data?.stats;

  const refresh = () => {
    setAnchor(Date.now());
    void query.refetch();
  };

  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            <Activity className="h-4 w-4" /> System Operations
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">運用履歴</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            株価・ニュース・企業情報・AI 補完の実行結果を、再起動後も残る履歴で確認できます。
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={query.isFetching} className="self-start sm:self-auto">
          <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "表示件数", value: stats?.total ?? 0, icon: Clock3, tone: "text-slate-700" },
          { label: "成功", value: stats?.success ?? 0, icon: CheckCircle2, tone: "text-emerald-600" },
          { label: "一部失敗", value: stats?.partial ?? 0, icon: AlertTriangle, tone: "text-amber-600" },
          { label: "失敗", value: stats?.failed ?? 0, icon: XCircle, tone: "text-rose-600" },
          { label: "実行中", value: stats?.running ?? 0, icon: Activity, tone: "text-sky-600" },
        ].map(item => (
          <Card key={item.label} className="border-border/70 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <item.icon className={`h-4 w-4 ${item.tone}`} /> {item.label}
              </div>
              <div className="mt-2 font-mono text-2xl font-semibold tracking-tight">{item.value}</div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="mb-6 border-border/70 shadow-sm">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger aria-label="タスクで絞り込む"><SelectValue placeholder="すべてのタスク" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">すべてのタスク</SelectItem>
              {(query.data?.kinds ?? []).map(value => (
                <SelectItem key={value} value={value}>{KIND_LABELS[value] ?? value}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="状態で絞り込む"><SelectValue placeholder="すべての状態" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">すべての状態</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={trigger} onValueChange={setTrigger}>
            <SelectTrigger aria-label="実行元で絞り込む"><SelectValue placeholder="すべての実行元" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">すべての実行元</SelectItem>
              {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={windowDays} onValueChange={value => { setWindowDays(value); setAnchor(Date.now()); }}>
            <SelectTrigger aria-label="期間で絞り込む"><SelectValue placeholder="直近7日" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">直近24時間</SelectItem>
              <SelectItem value="7">直近7日</SelectItem>
              <SelectItem value="30">直近30日</SelectItem>
              <SelectItem value="90">直近90日</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
      ) : query.error ? (
        <Card className="border-rose-200 bg-rose-50"><CardContent className="p-6 text-sm text-rose-700">履歴を取得できませんでした: {query.error.message}</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card className="border-dashed"><CardContent className="py-14 text-center"><Clock3 className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><p className="font-medium">この条件の実行履歴はまだありません</p><p className="mt-1 text-sm text-muted-foreground">自動タスクが動くと、ここに処理件数と結果が保存されます。</p></CardContent></Card>
      ) : (
        <>
          <Card className="hidden border-border/70 shadow-sm md:block">
            <Table>
              <TableHeader><TableRow><TableHead>開始時刻（JST）</TableHead><TableHead>タスク</TableHead><TableHead>状態</TableHead><TableHead>実行元</TableHead><TableHead className="text-right">成功 / 処理</TableHead><TableHead className="text-right">残り</TableHead><TableHead className="text-right">所要時間</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{formatDate(row.startedAt)}</TableCell>
                    <TableCell><div className="font-medium">{KIND_LABELS[row.kind] ?? row.kind}</div>{row.errorMessage ? <div className="mt-1 max-w-[360px] truncate text-xs text-rose-600">{row.errorMessage}</div> : detailText(row.detailJson) ? <div className="mt-1 max-w-[360px] truncate text-xs text-muted-foreground">{detailText(row.detailJson)}</div> : null}</TableCell>
                    <TableCell><Badge variant="outline" className={statusClass(row.status)}>{STATUS_LABELS[row.status]}</Badge></TableCell>
                    <TableCell>{TRIGGER_LABELS[row.trigger]}</TableCell>
                    <TableCell className="text-right font-mono">{row.succeeded} / {row.processed}</TableCell>
                    <TableCell className="text-right font-mono">{row.remaining ?? "―"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatDuration(row.startedAt, row.finishedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <div className="space-y-3 md:hidden">
            {rows.map(row => (
              <Card key={row.id} className="border-border/70 shadow-sm">
                <CardHeader className="p-4 pb-2"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{KIND_LABELS[row.kind] ?? row.kind}</CardTitle><p className="mt-1 font-mono text-xs text-muted-foreground">{formatDate(row.startedAt)} · {TRIGGER_LABELS[row.trigger]}</p></div><Badge variant="outline" className={statusClass(row.status)}>{STATUS_LABELS[row.status]}</Badge></div></CardHeader>
                <CardContent className="p-4 pt-2">
                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/55 p-3 text-center"><div><div className="font-mono text-lg font-semibold">{row.processed}</div><div className="text-[11px] text-muted-foreground">処理</div></div><div><div className="font-mono text-lg font-semibold text-emerald-700">{row.succeeded}</div><div className="text-[11px] text-muted-foreground">成功</div></div><div><div className="font-mono text-lg font-semibold">{row.remaining ?? "―"}</div><div className="text-[11px] text-muted-foreground">残り</div></div></div>
                  {(row.errorMessage || detailText(row.detailJson)) ? <details className="mt-3 text-xs"><summary className="cursor-pointer font-medium text-muted-foreground">詳細を表示</summary><p className={`mt-2 break-words leading-5 ${row.errorMessage ? "text-rose-700" : "text-muted-foreground"}`}>{row.errorMessage ?? detailText(row.detailJson)}</p></details> : null}
                  <div className="mt-3 text-right font-mono text-xs text-muted-foreground">{formatDuration(row.startedAt, row.finishedAt)}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <p className="mt-5 text-xs leading-5 text-muted-foreground">投資カードと価格帯確認は不足分だけを小分けで処理します。AI 利用枠に達した場合は既存データを残して中断し、冷却後に自動で再開します。</p>
    </main>
  );
}
