import { MoneyText, PctText, PnlText } from "@/components/investing/Figures";
import { BrokerBadge } from "@/components/investing/BrokerBadge";
import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import { SignalBadge } from "@/components/investing/SignalBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useBatchRun } from "@/hooks/useBatchRun";
import {
  SECTOR_COLORS,
  SIGNAL_ACTIONS,
  brokerHex,
  formatMoney,
  sectorJa,
  type SignalAction,
} from "@shared/investing";
import { pnlLabel } from "@shared/pnlLabel";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  Landmark,
  RefreshCw,
  ScanLine,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Link } from "wouter";

export default function Dashboard() {
  const utils = trpc.useUtils();
  const overview = trpc.portfolio.overview.useQuery();
  const snapshots = trpc.portfolio.snapshots.useQuery();
  const [busy, setBusy] = useState<null | "price">(null);

  const syncPrices = trpc.portfolio.syncPrices.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      toast.success(
        res.failed.length > 0
          ? `${res.updated} 銘柄を更新しました（${res.failed.length} 銘柄は取得できませんでした）`
          : `${res.updated} 銘柄の株価を更新しました`
      );
    },
    onError: e => toast.error(e.message),
    onSettled: () => setBusy(null),
  });

  // 一括処理は本番の 180 秒制限を超えるため、サーバーが返す nextOffset を辿って
  // 小分けに呼び出す。詳細は useBatchRun のコメント参照。
  const syncNewsBatch = trpc.news.syncAll.useMutation();
  const regenBatch = trpc.portfolio.regenerateAllSignals.useMutation();

  const newsRun = useBatchRun({
    runBatch: offset => syncNewsBatch.mutateAsync({ offset, batchSize: 4 }),
    onDone: async results => {
      await utils.invalidate();
      const fetched = results.reduce((a, r) => a + r.fetched, 0);
      const analyzed = results.reduce((a, r) => a + r.analyzed, 0);
      toast.success(
        fetched > 0
          ? `${fetched} 件のニュースを取得し、${analyzed} 件を分析しました`
          : "新しいニュースはありませんでした"
      );
    },
    onError: e => toast.error(e instanceof Error ? e.message : "ニュースを取得できませんでした"),
  });

  const signalRun = useBatchRun({
    runBatch: offset => regenBatch.mutateAsync({ offset, batchSize: 6 }),
    // 利用枠切れは後続バッチも必ず失敗するので、その時点で打ち切る
    shouldStop: res => res.quotaExhausted,
    onDone: async results => {
      await utils.portfolio.invalidate();
      const ok = results.reduce((a, r) => a + r.ok, 0);
      const failed = results.flatMap(r => r.failed);
      if (results.some(r => r.quotaExhausted)) {
        toast.warning(`${ok} 銘柄まで生成しました`, {
          description:
            "AI の利用枠を使い切ったため中断しました。時間をおいて再実行すると残りの銘柄も生成されます。",
          duration: 8000,
        });
        return;
      }
      toast.success(
        failed.length > 0
          ? `${ok} 銘柄のシグナルを生成しました（${failed.length} 銘柄は失敗）`
          : `${ok} 銘柄のシグナルを生成しました`
      );
    },
    onError: e =>
      toast.error("AI分析を実行できませんでした", {
        description: e instanceof Error ? e.message : undefined,
        duration: 8000,
      }),
  });

  const data = overview.data;
  const summary = data?.summary;

  // どれか 1 つが動いている間は他の一括処理を止める（AI 利用枠と DB 競合を避ける）
  const anyBusy = busy !== null || newsRun.progress.running || signalRun.progress.running;

  const sectorChart = useMemo(() => {
    if (!data) return [];
    return data.sectors
      .filter(s => s.value > 0)
      .map((s, i) => ({
        name: sectorJa(s.key),
        value: Math.round(s.value),
        pct: s.pct,
        count: s.count,
        fill: SECTOR_COLORS[i % SECTOR_COLORS.length],
      }));
  }, [data]);

  const trend = useMemo(() => {
    const rows = snapshots.data ?? [];
    return rows.map(r => ({
      date: new Date(r.capturedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }),
      value: Number(r.totalValue),
      cost: Number(r.totalCost),
    }));
  }, [snapshots.data]);

  const signalCounts = useMemo(() => {
    const counts = new Map<SignalAction, number>();
    // 同一銘柄を複数口座で持つ場合、口座ごとに数えると二重計上になるため銘柄単位で数える
    (data?.groups ?? []).forEach(p => {
      if (p.signal) counts.set(p.signal.action, (counts.get(p.signal.action) ?? 0) + 1);
    });
    return counts;
  }, [data]);

  const attention = useMemo(
    () =>
      (data?.groups ?? [])
        .filter(p => p.signal && ["EXIT", "REDUCE", "WATCH"].includes(p.signal.action))
        .sort((a, b) => {
          const order: Record<string, number> = { EXIT: 0, REDUCE: 1, WATCH: 2 };
          return order[a.signal!.action] - order[b.signal!.action];
        })
        .slice(0, 5),
    [data]
  );

  if (overview.isLoading) return <DashboardSkeleton />;

  if (overview.error) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>データの読み込みに失敗しました</AlertTitle>
          <AlertDescription>{overview.error.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isEmpty = (data?.groups.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">総資産ダッシュボード</h1>
          <p className="text-sm text-muted-foreground">
            {summary?.lastPriceSyncAt
              ? `株価最終更新: ${new Date(summary.lastPriceSyncAt).toLocaleString("ja-JP")}`
              : "株価はまだ更新されていません"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={anyBusy || isEmpty}
            onClick={() => {
              setBusy("price");
              syncPrices.mutate();
            }}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy === "price" ? "animate-spin" : ""}`} />
            株価更新
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={anyBusy || isEmpty}
            onClick={() => void newsRun.start()}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${newsRun.progress.running ? "animate-spin" : ""}`}
            />
            {newsRun.progress.running
              ? `ニュース取得中 ${newsRun.progress.processed}/${newsRun.progress.total || "…"}`
              : "ニュース取得"}
          </Button>
          <Button size="sm" disabled={anyBusy || isEmpty} onClick={() => void signalRun.start()}>
            <Brain
              className={`mr-1.5 h-3.5 w-3.5 ${signalRun.progress.running ? "animate-pulse" : ""}`}
            />
            {signalRun.progress.running
              ? `AI分析中 ${signalRun.progress.processed}/${signalRun.progress.total || "…"}`
              : "全銘柄をAI分析"}
          </Button>
        </div>
      </header>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {/* サマリーカード */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="総評価額"
              value={formatMoney(summary?.totalValueBase, summary?.baseCurrency)}
              sub={
                summary?.cashBalance
                  ? `現金 ${formatMoney(summary.cashBalance, summary.baseCurrency)} を含めた総資産 ${formatMoney(summary.totalAssets, summary.baseCurrency)}`
                  : `${summary?.positionCount ?? 0} 銘柄${
                      // 同一銘柄を複数口座で持つ場合は口座レコード数も添える
                      (data?.positions.length ?? 0) > (summary?.positionCount ?? 0)
                        ? `（${data?.positions.length} 口座分）`
                        : ""
                    }`
              }
              icon={<Wallet className="h-4 w-4" />}
            />
            <StatCard
              label="評価損益"
              valueNode={
                <PnlText
                  value={summary?.totalPnl ?? null}
                  currency={summary?.baseCurrency}
                  className="text-2xl font-semibold"
                />
              }
              sub={
                <span className="block space-y-1.5">
                  <span className="flex items-center gap-1.5">
                    <PctText value={summary?.totalPnlPct ?? null} />
                    <span className="text-muted-foreground">
                      / 取得原価 {formatMoney(summary?.totalCostBase, summary?.baseCurrency)}
                    </span>
                  </span>
                  {/**
                   * 口座が 2 つ以上ある場合は「どの口座でいくら儲かっているか」を
                   * ここに明示する。口座別カードは略記なので、こちらは正確な金額を出す。
                   */}
                  {(data?.brokers ?? []).length > 1 ? (
                    <span className="block space-y-1 border-t pt-1.5">
                      {(data?.brokers ?? []).map(b => (
                        <span key={b.key} className="flex items-center justify-between gap-2">
                          <BrokerBadge broker={b.key} short />
                          <span className="flex items-baseline gap-1.5">
                            <PnlText
                              value={b.pnl}
                              currency={summary?.baseCurrency}
                              className="text-xs font-medium"
                            />
                            <PctText value={b.pnlPct} className="text-[10px]" />
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              }
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <StatCard
              label="前日比"
              valueNode={
                <PnlText
                  value={summary?.dayChangeBase ?? null}
                  currency={summary?.baseCurrency}
                  className="text-2xl font-semibold"
                />
              }
              sub={<PctText value={summary?.dayChangePct ?? null} />}
              icon={<ArrowUpRight className="h-4 w-4" />}
            />
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5 text-xs font-medium">
                  <Brain className="h-4 w-4" />
                  AI シグナル内訳
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1.5">
                  {SIGNAL_ACTIONS.filter(a => (signalCounts.get(a) ?? 0) > 0).map(a => (
                    <div key={a} className="flex items-center gap-1">
                      <SignalBadge action={a} />
                      <span className="tabular text-sm font-medium">{signalCounts.get(a)}</span>
                    </div>
                  ))}
                  {signalCounts.size === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      まだシグナルがありません。「全銘柄をAI分析」を実行してください。
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 証券口座別の内訳。開いた瞬間に「どこにいくら置いているか」が分かるよう上部に配置する */}
          {(data?.brokers ?? []).length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <Landmark className="h-4 w-4" />
                  証券口座別の資産
                </CardTitle>
                <CardDescription className="text-xs">
                  どのプラットフォームにいくら置いているか
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(data?.brokers ?? []).map(b => (
                    <div
                      key={b.key}
                      className="rounded-lg border p-3"
                      style={{ borderLeft: `3px solid ${brokerHex(b.key)}` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <BrokerBadge broker={b.key} />
                        <span className="tabular text-xs text-muted-foreground">
                          {b.count} 銘柄
                        </span>
                      </div>
                      <div className="mt-2">
                        <MoneyText
                          value={b.value}
                          currency={summary?.baseCurrency}
                          className="text-xl font-semibold"
                        />
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span className="flex items-baseline gap-1.5">
                          <PnlText
                            value={b.pnl}
                            currency={summary?.baseCurrency}
                            compact
                            className="text-xs"
                          />
                          <PctText value={b.pnlPct} className="text-xs" />
                        </span>
                        <span className="tabular text-xs text-muted-foreground">
                          全体の {b.pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, b.pct)}%`,
                            background: brokerHex(b.key),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* アラート */}
          {(data?.alerts.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {data!.alerts.slice(0, 4).map((a, i) => (
                <Alert
                  key={`${a.kind}-${a.label}-${i}`}
                  className={
                    a.level === "HIGH"
                      ? "border-loss/40 bg-loss-soft"
                      : "border-amber-500/30 bg-amber-500/10"
                  }
                >
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle className="text-sm">
                    {a.kind === "POSITION" ? "銘柄集中" : a.kind === "SECTOR" ? "業種集中" : "通貨集中"}
                    アラート
                  </AlertTitle>
                  <AlertDescription className="text-xs">{a.message}</AlertDescription>
                </Alert>
              ))}
            </div>
          ) : null}

          {summary && summary.missingPriceCount > 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm">株価が未取得の銘柄があります</AlertTitle>
              <AlertDescription className="text-xs">
                {summary.missingPriceCount} 銘柄の現在値が取得できていません。「株価更新」を実行しても解消しない場合、銘柄コードをご確認ください。
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            {/* 資産推移 */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">資産推移</CardTitle>
                <CardDescription className="text-xs">
                  株価更新のたびにスナップショットを記録します
                </CardDescription>
              </CardHeader>
              <CardContent>
                {trend.length < 2 ? (
                  <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm text-muted-foreground">
                      推移グラフはスナップショットが 2 件以上たまると表示されます
                    </p>
                    <p className="text-xs text-muted-foreground">
                      現在 {trend.length} 件。株価更新を実行すると記録されます。
                    </p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={trend} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                          <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        stroke="var(--muted-foreground)"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="var(--muted-foreground)"
                        tickLine={false}
                        axisLine={false}
                        width={64}
                        tickFormatter={v =>
                          new Intl.NumberFormat("ja-JP", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(v as number)
                        }
                      />
                      <ReTooltip
                        contentStyle={{
                          background: "var(--popover)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 12,
                          color: "var(--popover-foreground)",
                        }}
                        formatter={(v: number, name) => [
                          formatMoney(v, summary?.baseCurrency),
                          name === "value" ? "評価額" : "取得原価",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="cost"
                        stroke="var(--muted-foreground)"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        fill="none"
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="var(--chart-1)"
                        strokeWidth={2}
                        fill="url(#valueFill)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* 業種別分布 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">業種別分布</CardTitle>
                <CardDescription className="text-xs">評価額ベースの構成比</CardDescription>
              </CardHeader>
              <CardContent>
                {sectorChart.length === 0 ? (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    業種情報がまだ取得されていません
                  </p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={190}>
                      <PieChart>
                        <Pie
                          data={sectorChart}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={82}
                          paddingAngle={2}
                          stroke="var(--card)"
                          strokeWidth={2}
                        >
                          {sectorChart.map(s => (
                            <Cell key={s.name} fill={s.fill} />
                          ))}
                        </Pie>
                        <ReTooltip
                          contentStyle={{
                            background: "var(--popover)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            fontSize: 12,
                            color: "var(--popover-foreground)",
                          }}
                          formatter={(v: number, _n, item) => [
                            `${formatMoney(v, summary?.baseCurrency)}（${(item?.payload as { pct: number })?.pct.toFixed(1)}%）`,
                            (item?.payload as { name: string })?.name,
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <ul className="mt-3 space-y-1.5">
                      {sectorChart.slice(0, 6).map(s => (
                        <li key={s.name} className="flex items-center gap-2 text-xs">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ background: s.fill }}
                          />
                          <span className="min-w-0 flex-1 truncate">{s.name}</span>
                          <span className="tabular text-muted-foreground">{s.count}銘柄</span>
                          <span className="tabular w-12 text-right font-medium">
                            {s.pct.toFixed(1)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* 注意が必要な銘柄 */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">注意が必要な銘柄</CardTitle>
                <CardDescription className="text-xs">
                  EXIT / REDUCE / WATCH シグナルが出ている銘柄。
                  含み益が大きくても、決算悪化などで見直しが必要な場合はここに入ります。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {attention.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    対応が必要なシグナルはありません
                  </p>
                ) : (
                  attention.map(p => (
                    <Link
                      key={p.symbol}
                      href={`/holdings/${p.entries[0].id}`}
                      className="block rounded-lg border border-border/70 p-3 transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <SignalBadge action={p.signal!.action} />
                            <span className="truncate font-medium">{p.name}</span>
                            <span className="tabular shrink-0 text-xs text-muted-foreground">
                              {p.tickerCode}
                            </span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {p.signal!.rationale}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {/**
                           * 数字だけ並べると何の % か分からないためラベルを添える。
                           * 含み益が大きい銘柄が WATCH 枠に入ることもあるので、
                           * 「含み益」と明示して矛盾に見えないようにする。
                           */}
                          <p className="text-[10px] text-muted-foreground">
                            {pnlLabel(p.pnlPct)}
                          </p>
                          <PctText value={p.pnlPct} className="text-sm" />
                          <p className="mt-1 text-[10px] text-muted-foreground">構成比</p>
                          <p className="tabular text-xs text-muted-foreground">
                            {p.weightPct !== null ? `${p.weightPct.toFixed(1)}%` : "—"}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </CardContent>
            </Card>

            {/* 通貨別分布 + 構成比上位 */}
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">通貨別分布</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {(data?.currencies ?? []).map((c, i) => (
                    <div key={c.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{c.key}</span>
                        <span className="tabular text-muted-foreground">
                          {c.pct.toFixed(1)}% / {c.count}銘柄
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, c.pct)}%`,
                            background: SECTOR_COLORS[i % SECTOR_COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">構成比上位</CardTitle>
                  <CardDescription className="text-xs">
                    総資産に占める割合が大きい銘柄
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {/* 構成比は口座をまたいだ合計で見る */}
                  {(data?.groups ?? []).slice(0, 5).map(p => (
                    <div key={p.symbol} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <MoneyText
                        value={p.marketValueBase}
                        currency={summary?.baseCurrency}
                        compact
                        className="text-muted-foreground"
                      />
                      <Badge variant="secondary" className="tabular w-14 justify-center">
                        {p.weightPct !== null ? `${p.weightPct.toFixed(1)}%` : "—"}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <DisclaimerNote />
    </div>
  );
}

function StatCard({
  label,
  value,
  valueNode,
  sub,
  icon,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5 text-xs font-medium">
          {icon}
          {label}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {valueNode ?? <p className="tabular text-2xl font-semibold tracking-tight">{value}</p>}
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-5 py-16 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
          <ScanLine className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">まずは保有銘柄を登録しましょう</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            証券会社アプリの保有一覧のスクリーンショットをアップロードすると、銘柄コード・株数・取得単価を自動で読み取ります。手入力での追加も可能です。
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/import">
            <Button>
              <ScanLine className="mr-1.5 h-4 w-4" />
              スクリーンショットから取込
            </Button>
          </Link>
          <Link href="/holdings">
            <Button variant="outline">手入力で追加</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-72" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}
