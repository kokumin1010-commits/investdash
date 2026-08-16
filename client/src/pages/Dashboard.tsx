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
  MARGIN_RISK_LABELS,
  MARGIN_RISK_STYLES,
  CARRY_VERDICT_LABELS,
  CARRY_VERDICT_STYLES,
  CARRY_VERDICT_NOTES,
  brokerHex,
  formatMoney,
  marketHex,
  sectorJa,
  type SignalAction,
} from "@shared/investing";
import { pnlLabel } from "@shared/pnlLabel";
import {
  AlertTriangle,
  ArrowUpRight,
  Brain,
  ChevronRight,
  Coins,
  Globe,
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
  Bar,
  BarChart,
  Cell,
  Line,
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
      // 為替レートも同時に更新しているので、更新できたときは併せて知らせる
      const fxParts: string[] = [];
      if (res.fxRates.usdJpy !== null) fxParts.push(`${res.fxRates.usdJpy.toFixed(2)} 円/ドル`);
      if (res.fxRates.sgdJpy !== null) fxParts.push(`${res.fxRates.sgdJpy.toFixed(2)} 円/SGD`);
      const fx = fxParts.length > 0 ? `／為替 ${fxParts.join(" ・ ")}` : "";
      toast.success(
        res.failed.length > 0
          ? `${res.updated} 銘柄を更新しました（${res.failed.length} 銘柄は取得できませんでした）${fx}`
          : `${res.updated} 銘柄の株価を更新しました${fx}`
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

  /*
   * 配当の取得。銘柄数が多いと本番の 180 秒制限を超えるため
   * 株価更新と同じく分割実行する。
   */
  const syncDividendsBatch = trpc.portfolio.syncDividends.useMutation();
  const dividendRun = useBatchRun({
    runBatch: offset => syncDividendsBatch.mutateAsync({ offset, batchSize: 20, force: true }),
    onDone: async results => {
      await utils.portfolio.invalidate();
      const updated = results.reduce((a, r) => a + r.updated, 0);
      const failed = results.flatMap(r => r.failed);
      toast.success(
        failed.length > 0
          ? `配当情報を更新しました（${failed.length} 銘柄は取得できませんでした）`
          : `${updated} 件の配当情報を更新しました`
      );
    },
    onError: e => toast.error(e instanceof Error ? e.message : "配当情報を取得できませんでした"),
  });

  const data = overview.data;
  const summary = data?.summary;
  /**
   * 前回記録からの変化。長期保有では前日比より判断に役立つ。
   * スナップショットが 2 件未満なら null。
   */
  const periodChange = summary?.periodChange ?? null;
  /** 配当の全体集計。長期保有では実質的な収入になるので目立つ位置に出す */
  const dividends = data?.dividends ?? null;
  /**
   * 資産推移の粒度。長期保有では月次のほうが傾向が読みやすいので既定を月次にする。
   */
  const [trendScale, setTrendScale] = useState<"day" | "month">("month");

  // どれか 1 つが動いている間は他の一括処理を止める（AI 利用枠と DB 競合を避ける）
  const anyBusy =
    busy !== null ||
    newsRun.progress.running ||
    signalRun.progress.running ||
    dividendRun.progress.running;

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
    /**
     * 株価更新は 1 日に複数回走るため、日次のままだと同じ日の点が並んで
     * 長期の推移が読みづらい。粒度を選べるようにし、各期間の最終値を代表値にする。
     */
    const bucketOf = (d: Date) =>
      trendScale === "month"
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // 期間ごとに最後の記録を残す（その時点の資産を表すため）
    const byBucket = new Map<string, { at: Date; value: number; cost: number }>();
    for (const r of rows) {
      const at = new Date(r.capturedAt);
      const key = bucketOf(at);
      const cur = byBucket.get(key);
      if (!cur || at.getTime() > cur.at.getTime()) {
        byBucket.set(key, { at, value: Number(r.totalValue), cost: Number(r.totalCost) });
      }
    }

    return Array.from(byBucket.values())
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map(r => ({
        date:
          trendScale === "month"
            ? r.at.toLocaleDateString("ja-JP", { year: "2-digit", month: "numeric" })
            : r.at.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }),
        value: r.value,
        cost: r.cost,
      }));
  }, [snapshots.data, trendScale]);

  const signalCounts = useMemo(() => {
    const counts = new Map<SignalAction, number>();
    // 同一銘柄を複数口座で持つ場合、口座ごとに数えると二重計上になるため銘柄単位で数える
    (data?.groups ?? []).forEach(p => {
      if (p.signal) counts.set(p.signal.action, (counts.get(p.signal.action) ?? 0) + 1);
    });
    return counts;
  }, [data]);

  /**
   * 月別の配当グラフ用データ。
   *
   * 日本株は 3 月・9 月に集中するため、月ごとの受取額を見ると
   * どの月に収入が寄っているかが分かる。月あたりの平均も併せて描き、
   * 平均より多い月・少ない月を判断できるようにする。
   */
  const dividendMonthly = useMemo(() => {
    const monthly = dividends?.monthlyIncomeBase;
    if (!monthly || monthly.length !== 12) return [];
    const average = dividends.annualIncomeBase / 12;
    return monthly.map((amount, i) => ({
      month: `${i + 1}月`,
      /** 0 始まりの月。棒をタップしたときの選択に使う */
      monthIndex: i,
      amount,
      average,
      /** その月が年間の何割か。ツールチップで偏りを示すために持つ */
      pct: dividends.annualIncomeBase > 0 ? (amount / dividends.annualIncomeBase) * 100 : 0,
      isPeak: dividends.peakMonth === i,
    }));
  }, [dividends]);

  /**
   * 配当グラフで選択している月（0 = 1 月）。null なら未選択。
   *
   * 棒をタップするとその月の銘柄内訳を開く。合計金額だけでは
   * どの銘柄が減配したときに影響が大きいかが分からないため。
   */
  const [selectedDivMonth, setSelectedDivMonth] = useState<number | null>(null);

  /** 選択中の月の銘柄内訳 */
  const selectedDivDetail = useMemo(() => {
    if (selectedDivMonth === null) return null;
    return data?.dividendCalendar?.[selectedDivMonth] ?? null;
  }, [data?.dividendCalendar, selectedDivMonth]);

  /**
   * 銘柄内訳を全件表示するか。
   *
   * 3 月は 85 件になりスマホでは延々とスクロールすることになるため、
   * 既定では上位 10 件だけを出す。累計の割合を添えて「上位で何割か」を
   * 分かるようにし、必要なときだけ全件に広げる。
   */
  const [divShowAll, setDivShowAll] = useState(false);

  /** 表示する件数の上限（折りたたみ時） */
  const DIV_PREVIEW_COUNT = 10;

  /**
   * 全口座を合わせた借入コストと、配当から利息を引いた手取り。
   *
   * 借入は今のところ IBKR のみだが、口座が増えても合算できるようにしておく。
   * 「配当がいくら入るか」だけでは借金のコストが見えないため、
   * 差し引き後の実際に残る額を出す。
   */
  const carryTotal = useMemo(() => {
    const brokers = data?.brokers ?? [];
    let annualInterestBase = 0;
    let hasInterest = false;
    for (const b of brokers) {
      const interest = b.leverage?.interest;
      if (!interest) continue;
      hasInterest = true;
      annualInterestBase += interest.annualInterestBase;
    }
    if (!hasInterest || !dividends) return null;
    const annualDividendBase = dividends.annualIncomeBase;
    const netCarryBase = annualDividendBase - annualInterestBase;
    const coverageRatio =
      annualInterestBase > 0 ? annualDividendBase / annualInterestBase : null;
    const verdict: "POSITIVE" | "THIN" | "NEGATIVE" =
      annualInterestBase <= 0 || (coverageRatio !== null && coverageRatio >= 1.2)
        ? "POSITIVE"
        : coverageRatio !== null && coverageRatio >= 1.0
          ? "THIN"
          : "NEGATIVE";
    return {
      annualDividendBase,
      annualInterestBase,
      netCarryBase,
      coverageRatio,
      verdict,
      /** 手取りベースの利回り。株式時価に対する比率 */
      netYieldPct:
        summary && summary.totalValueBase > 0
          ? (netCarryBase / summary.totalValueBase) * 100
          : null,
    };
  }, [data?.brokers, dividends, summary]);

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

  /*
   * 信用取引の借入があるか。借入がある場合は「株式時価 = 自分の資産」ではないため、
   * サマリーの見せ方を変える（純資産を主役にする）。現物のみの口座しかない場合は
   * 従来の表示のままにして、無用な項目を増やさない。
   */
  const hasBorrowing = (summary?.totalBorrowedBase ?? 0) > 0;

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
          <Button
            variant="outline"
            size="sm"
            disabled={anyBusy || isEmpty}
            onClick={() => void dividendRun.start()}
          >
            <Coins
              className={`mr-1.5 h-3.5 w-3.5 ${dividendRun.progress.running ? "animate-spin" : ""}`}
            />
            {dividendRun.progress.running
              ? `配当取得中 ${dividendRun.progress.processed}/${dividendRun.progress.total || "…"}`
              : "配当更新"}
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              /*
               * 借入がある場合、株式時価は「自分のお金」ではない。
               * ラベルを「株式時価」に変えて、その下に借入と純資産を必ず並べる。
               * 借入がない場合は従来どおり「総評価額」として扱う。
               */
              label={hasBorrowing ? "株式時価（借入を含む）" : "総評価額"}
              value={formatMoney(summary?.totalValueBase, summary?.baseCurrency)}
              sub={
                hasBorrowing ? (
                  <span className="block space-y-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">借入（信用取引）</span>
                      <span className="tabular font-medium text-loss">
                        −{formatMoney(summary?.totalBorrowedBase, summary?.baseCurrency)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2 border-t pt-1">
                      <span className="font-medium text-foreground">純資産（実質の資産）</span>
                      <span className="tabular font-semibold text-foreground">
                        {formatMoney(summary?.netAssetsBase, summary?.baseCurrency)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">全体のレバレッジ</span>
                      <span className="tabular font-medium">
                        {summary?.overallLeverage !== null && summary?.overallLeverage !== undefined
                          ? `${summary.overallLeverage.toFixed(2)} 倍`
                          : "—"}
                      </span>
                    </span>
                  </span>
                ) : summary?.cashBalance
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
                  className="whitespace-nowrap text-2xl font-semibold"
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
                          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
                            <PnlText
                              value={b.pnl}
                              currency={summary?.baseCurrency}
                              compact
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
            {/*
              長期保有が前提のため、前日比ではなく「前回記録からの変化」を出す。
              日々の値動きは判断材料にならず、むしろ長期の判断を乱すため。
              銘柄の追加があった期間は株価変動分を分離できないので明示する。
            */}
            <StatCard
              label="前回記録からの変化"
              valueNode={
                periodChange ? (
                  <PnlText
                    value={periodChange.gainDelta ?? periodChange.totalDelta}
                    currency={summary?.baseCurrency}
                    className="text-2xl font-semibold"
                  />
                ) : (
                  <span className="text-2xl font-semibold text-muted-foreground">—</span>
                )
              }
              sub={
                periodChange ? (
                  <span className="block space-y-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      {periodChange.gainDelta !== null ? (
                        <>
                          <PctText value={periodChange.gainPct} />
                          <span className="text-muted-foreground">株価変動による増減</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">評価額の増減（合計）</span>
                      )}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {new Date(periodChange.fromAt).toLocaleDateString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                      })}{" "}
                      →{" "}
                      {new Date(periodChange.toAt).toLocaleDateString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                      })}
                      {periodChange.days > 0 ? `（${periodChange.days}日間）` : "（同日中）"}
                    </span>
                    {/*
                      銘柄を追加した期間は、追加した銘柄が元々持っていた含み損益が
                      混ざるため「株価がいくら動いたか」を分離できない。
                      誤解を防ぐため、その旨をはっきり書く。
                    */}
                    {periodChange.compositionChanged ? (
                      <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                        {periodChange.countDelta !== 0
                          ? `この期間に ${periodChange.countDelta > 0 ? "+" : ""}${periodChange.countDelta} 銘柄の変動があったため、`
                          : "この期間に買い増し・売却があったため、"}
                        株価変動分は分けて出せません
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    記録が 2 回以上たまると変化を表示します
                  </span>
                )
              }
              icon={<ArrowUpRight className="h-4 w-4" />}
            />
          </div>

          {/* 配当と AI シグナル */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/*
              長期保有では配当が実質的な収入になる。
              「年間いくら入るか」を最初に出し、月あたりの平均も添える。
            */}
            <StatCard
              label="年間配当（税引前）"
              valueNode={
                <span className="whitespace-nowrap text-2xl font-semibold text-gain">
                  {dividends && dividends.annualIncomeBase > 0
                    ? formatMoney(dividends.annualIncomeBase, summary?.baseCurrency)
                    : "—"}
                </span>
              }
              sub={
                dividends && dividends.annualIncomeBase > 0 ? (
                  <span className="block space-y-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="tabular font-medium">
                        月あたり {formatMoney(dividends.monthlyAverageBase, summary?.baseCurrency)}
                      </span>
                      <span className="text-muted-foreground">
                        （年間を 12 で割った平均）
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">今の株価に対する利回り</span>
                      <span className="tabular font-medium">
                        {dividends.yieldPct !== null ? `${dividends.yieldPct.toFixed(2)}%` : "—"}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">買った値段に対する利回り</span>
                      <span className="tabular font-medium text-gain">
                        {dividends.yieldOnCostPct !== null
                          ? `${dividends.yieldOnCostPct.toFixed(2)}%`
                          : "—"}
                      </span>
                    </span>
                    <span className="block border-t pt-1 text-[11px] text-muted-foreground">
                      配当あり {dividends.payingCount} 銘柄 / 無配 {dividends.nonPayingCount} 銘柄
                      {dividends.unknownCount > 0 ? ` / 未取得 ${dividends.unknownCount} 銘柄` : ""}
                    </span>
                    {/*
                      借入がある場合、配当をそのまま収入と見ると実態を見誤る。
                      利息を引いた「実際に残る額」を並べて出す。
                    */}
                    {carryTotal ? (
                      <span className="block space-y-1 border-t pt-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">借入の年間利息</span>
                          <span className="tabular font-medium text-loss">
                            −{formatMoney(carryTotal.annualInterestBase, summary?.baseCurrency)}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">
                            差し引き後に残る額
                          </span>
                          <span
                            className={`tabular font-semibold ${
                              carryTotal.netCarryBase >= 0 ? "text-gain" : "text-loss"
                            }`}
                          >
                            {carryTotal.netCarryBase >= 0 ? "+" : "−"}
                            {formatMoney(
                              Math.abs(carryTotal.netCarryBase),
                              summary?.baseCurrency
                            )}
                            {carryTotal.netYieldPct !== null ? (
                              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                                {carryTotal.netYieldPct.toFixed(2)}%
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`h-4 px-1 text-[10px] ${CARRY_VERDICT_STYLES[carryTotal.verdict]}`}
                          >
                            {CARRY_VERDICT_LABELS[carryTotal.verdict]}
                          </Badge>
                          {carryTotal.coverageRatio !== null ? (
                            <span className="tabular text-[11px] text-muted-foreground">
                              配当は利息の {carryTotal.coverageRatio.toFixed(2)} 倍
                            </span>
                          ) : null}
                        </span>
                        <span className="block text-[11px] leading-relaxed text-muted-foreground">
                          {CARRY_VERDICT_NOTES[carryTotal.verdict]}
                        </span>
                      </span>
                    ) : null}
                    {/*
                      特別配当（記念配当）が含まれる銘柄があると、
                      来年も同額もらえると誤解しやすいので除いた額も出す。
                    */}
                    {dividends.specialCount > 0 ? (
                      <span className="block text-[11px] text-amber-600 dark:text-amber-400">
                        {dividends.specialCount} 銘柄に一時的な配当（特別・記念配当）が含まれます。
                        それを除くと年間{" "}
                        {formatMoney(dividends.recurringIncomeBase, summary?.baseCurrency)}
                      </span>
                    ) : null}
                    {dividends.updatedAt ? (
                      <span className="block text-[11px] text-muted-foreground">
                        配当情報の取得: {new Date(dividends.updatedAt).toLocaleDateString("ja-JP")}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    「配当更新」を実行すると年間の受取額を計算します
                  </span>
                )
              }
              icon={<Coins className="h-4 w-4" />}
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
          {/* 国・市場別の内訳。米国株は円換算後の損益に為替変動が混ざるため現地通貨でも併記する */}
          {(data?.markets ?? []).length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <Globe className="h-4 w-4" />
                  国・市場別の資産
                </CardTitle>
                <CardDescription className="text-xs">
                  どの国の株にいくら置いているか
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(data?.markets ?? []).map(m => (
                    <Link
                      key={m.key}
                      href={`/holdings?market=${m.key}`}
                      className="block rounded-lg border p-3 transition-all hover:bg-accent/50 hover:shadow-sm active:scale-[0.99]"
                      style={{ borderLeft: `3px solid ${marketHex(m.key)}` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{m.label}</span>
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          <span className="tabular">{m.count} 銘柄</span>
                          <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <div className="mt-2">
                        <MoneyText
                          value={m.value}
                          currency={summary?.baseCurrency}
                          className="text-xl font-semibold"
                        />
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-2">
                        <span className="flex items-baseline gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {pnlLabel(m.pnl)}
                          </span>
                          <PnlText
                            value={m.pnl}
                            currency={summary?.baseCurrency}
                            compact
                            className="text-xs"
                          />
                          <PctText value={m.pnlPct} className="text-xs" />
                        </span>
                        <span className="tabular text-xs text-muted-foreground">
                          全体の {m.pct.toFixed(1)}%
                        </span>
                      </div>
                      {/*
                        外国株は円換算後の損益に為替変動が混ざる。
                        現地通貨での損益も出して「株価がいくら動いたか」を分かるようにする。
                      */}
                      {m.isForeign ? (
                        <div className="mt-1.5 border-t pt-1.5 text-xs text-muted-foreground">
                          {m.currency} ベース{" "}
                          <span className="tabular font-medium">
                            {m.localPnl >= 0 ? "+" : "−"}
                            {Math.abs(Math.round(m.localPnl)).toLocaleString()} {m.currency}
                          </span>{" "}
                          <span className="tabular">
                            ({m.localPnlPct !== null ? `${m.localPnlPct >= 0 ? "+" : ""}${m.localPnlPct.toFixed(2)}%` : "-"})
                          </span>
                        </div>
                      ) : null}
                      {/* その市場から年間いくら配当が入るか。長期保有では重要な収入源 */}
                      {m.dividendIncomeBase > 0 ? (
                        <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t pt-1.5 text-xs">
                          <span className="text-muted-foreground">年間配当</span>
                          <span className="flex items-baseline gap-1.5">
                            <span className="tabular font-medium text-gain">
                              {formatMoney(m.dividendIncomeBase, summary?.baseCurrency)}
                            </span>
                            <span className="tabular text-muted-foreground">
                              {m.dividendYieldPct !== null ? `${m.dividendYieldPct.toFixed(2)}%` : ""}
                            </span>
                          </span>
                        </div>
                      ) : null}
                      {/*
                        市場ごとに配当の入る月の傾向が違う（日本株は 3 月・9 月に集中、
                        米国株は四半期ごとに分散）。どの市場が偏りの原因かを示す。
                      */}
                      {(() => {
                        const monthly = m.dividendMonthlyBase ?? [];
                        if (monthly.length !== 12 || m.dividendIncomeBase <= 0) return null;
                        const peak = monthly.reduce(
                          (best, v, i) => (v > monthly[best] ? i : best),
                          0
                        );
                        const peakPct = (monthly[peak] / m.dividendIncomeBase) * 100;
                        // 均等なら 1 か月あたり 8.3%。倍以上なら偏りとみなす
                        const concentrated = peakPct >= 16.7;
                        return (
                          <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
                            <span className="text-muted-foreground">配当が多い月</span>
                            <span className="tabular text-muted-foreground">
                              {peak + 1}月に {peakPct.toFixed(0)}%
                              {concentrated ? "（偏りあり）" : "（分散）"}
                            </span>
                          </div>
                        );
                      })()}
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, m.pct)}%`,
                            background: marketHex(m.key),
                          }}
                        />
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

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
                    <Link
                      key={b.key}
                      href={`/holdings?broker=${b.key}`}
                      /**
                       * タップするとその口座の保有銘柄だけを一覧で見られる。
                       * 押せることが分かるよう hover / active の反応を付ける。
                       */
                      className="block rounded-lg border p-3 transition-all hover:bg-accent/50 hover:shadow-sm active:scale-[0.99]"
                      style={{ borderLeft: `3px solid ${brokerHex(b.key)}` }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <BrokerBadge broker={b.key} />
                        <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                          <span className="tabular">{b.count} 銘柄</span>
                          <ChevronRight className="h-3.5 w-3.5" />
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
                      {/* その口座から年間いくら配当が入るか */}
                      {b.dividendIncomeBase > 0 ? (
                        <div className="mt-2 flex items-baseline justify-between gap-2 border-t pt-1.5 text-xs">
                          <span className="text-muted-foreground">年間配当</span>
                          <span className="flex items-baseline gap-1.5">
                            <span className="tabular font-medium text-gain">
                              {formatMoney(b.dividendIncomeBase, summary?.baseCurrency)}
                            </span>
                            <span className="tabular text-muted-foreground">
                              {b.dividendYieldPct !== null ? `${b.dividendYieldPct.toFixed(2)}%` : ""}
                            </span>
                          </span>
                        </div>
                      ) : null}
                      {/*
                        信用取引を使っている口座のみ、借入・純資産・追証余地を出す。
                        現物口座では該当しない項目なので出さない。
                      */}
                      {b.leverage ? (
                        <div className="mt-2.5 space-y-1 border-t pt-2 text-[11px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">借入</span>
                            <span className="tabular text-loss">
                              −{formatMoney(b.leverage.borrowedBase, summary?.baseCurrency)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">
                              純資産（借入を引いた額）
                            </span>
                            <span className="tabular font-semibold text-foreground">
                              {formatMoney(b.leverage.netValueBase, summary?.baseCurrency)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">レバレッジ</span>
                            <span className="tabular">
                              {b.leverage.leverage !== null
                                ? `${b.leverage.leverage.toFixed(2)} 倍`
                                : "算出不可"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">証拠金余力</span>
                            <span className="tabular">
                              {b.leverage.marginCushionBase !== null
                                ? formatMoney(b.leverage.marginCushionBase, summary?.baseCurrency)
                                : "—"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">追証までの下落余地</span>
                            <span className="flex items-center gap-1.5">
                              <span className="tabular">
                                {b.leverage.dropToMarginCallPct !== null
                                  ? `−${b.leverage.dropToMarginCallPct.toFixed(1)}%`
                                  : "—"}
                              </span>
                              <Badge
                                variant="outline"
                                className={`h-4 px-1 text-[10px] ${MARGIN_RISK_STYLES[b.leverage.riskLevel]}`}
                              >
                                {MARGIN_RISK_LABELS[b.leverage.riskLevel]}
                              </Badge>
                            </span>
                          </div>
                          {/*
                            借入の金利と、その口座から入る配当の比較。
                            借金で株を買っている場合、配当で利息を賄えているかが
                            「持ち続けるだけで現金が増えるか」を決める。
                          */}
                          {b.leverage.interest && b.leverage.carry ? (
                            <div className="mt-1.5 space-y-1 border-t pt-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">
                                  年間の利息（{b.leverage.interest.effectiveRatePct.toFixed(2)}%）
                                </span>
                                <span className="tabular text-loss">
                                  −{formatMoney(
                                    b.leverage.interest.annualInterestBase,
                                    summary?.baseCurrency
                                  )}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium text-foreground">
                                  配当 − 利息
                                </span>
                                <span
                                  className={`tabular font-semibold ${
                                    b.leverage.carry.netCarryBase >= 0 ? "text-gain" : "text-loss"
                                  }`}
                                >
                                  {b.leverage.carry.netCarryBase >= 0 ? "+" : "−"}
                                  {formatMoney(
                                    Math.abs(b.leverage.carry.netCarryBase),
                                    summary?.baseCurrency
                                  )}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-muted-foreground">配当は利息の</span>
                                <span className="flex items-center gap-1.5">
                                  <span className="tabular">
                                    {b.leverage.carry.coverageRatio !== null
                                      ? `${b.leverage.carry.coverageRatio.toFixed(2)} 倍`
                                      : "—"}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={`h-4 px-1 text-[10px] ${CARRY_VERDICT_STYLES[b.leverage.carry.verdict]}`}
                                  >
                                    {CARRY_VERDICT_LABELS[b.leverage.carry.verdict]}
                                  </Badge>
                                </span>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </Link>
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
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">資産推移</CardTitle>
                    <CardDescription className="text-xs">
                      株価更新のたびにスナップショットを記録します
                    </CardDescription>
                  </div>
                  {/* 長期の傾向を見たいときは月次、直近の動きを見たいときは日次 */}
                  <div className="flex overflow-hidden rounded-md border">
                    {(
                      [
                        { key: "month" as const, label: "月次" },
                        { key: "day" as const, label: "日次" },
                      ]
                    ).map(opt => (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => setTrendScale(opt.key)}
                        className={`px-2.5 py-1 text-xs transition-colors ${
                          trendScale === opt.key
                            ? "bg-accent font-medium text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
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

          {/* 配当の受取月 */}
          {dividendMonthly.length === 12 && dividends && dividends.annualIncomeBase > 0 ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">配当が入る月</CardTitle>
                    <CardDescription className="text-xs">
                      直近 1 年の実績を権利確定月に振り分けたもの（税引前）。
                      実際の入金は権利確定から 2〜3 か月後になります。
                      月をタップするとその月に配当が入る銘柄が見られます。
                    </CardDescription>
                  </div>
                  {/*
                    偏りを一目で伝える。日本株は 3 月・9 月に集中するため、
                    「月あたり平均」だけを見ていると実際の入金月を読み違える。
                  */}
                  <div className="text-right text-xs">
                    <div className="text-muted-foreground">最も多い月</div>
                    <div className="tabular text-sm font-semibold">
                      {dividends.peakMonth !== null
                        ? `${dividends.peakMonth + 1}月 ${formatMoney(
                            dividendMonthly[dividends.peakMonth].amount,
                            summary?.baseCurrency
                          )}`
                        : "—"}
                    </div>
                    {/* 詳しい確認は配当ページで行う（口座別・市場別の絞り込みがある） */}
                    <Link
                      href="/dividends"
                      className="mt-1 inline-block text-[11px] text-primary hover:underline"
                    >
                      配当ページで詳しく見る
                    </Link>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/*
                  月を選ぶボタン列。棒グラフの棒はスマホだと細くて押しにくいため、
                  タップ用の導線を別に用意する（棒のクリックでも同じ月を選べる）。
                */}
                <div className="mb-3 -mx-1 flex flex-wrap gap-1 px-1">
                  {dividendMonthly.map(m => {
                    const active = selectedDivMonth === m.monthIndex;
                    const empty = m.amount <= 0;
                    return (
                      <button
                        key={m.monthIndex}
                        type="button"
                        disabled={empty}
                        onClick={() =>
                          {
                            setSelectedDivMonth(active ? null : m.monthIndex);
                            // 月を切り替えたら折りたたみ状態を戻す
                            setDivShowAll(false);
                          }
                        }
                        className={`min-h-8 rounded-md border px-2 py-1 text-xs transition-all duration-150 active:scale-[0.97] ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : empty
                              ? "cursor-not-allowed border-border/50 text-muted-foreground/50"
                              : "border-border bg-background hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        {m.month}
                      </button>
                    );
                  })}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={dividendMonthly}
                    margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
                    onClick={state => {
                      /*
                        棒のクリックで月を選ぶ。recharts は activeTooltipIndex を
                        グラフ全体のクリックで渡してくるので、そこから月を決める。
                      */
                      const idx = state?.activeTooltipIndex;
                      if (typeof idx !== "number") return;
                      const target = dividendMonthly[idx];
                      if (!target || target.amount <= 0) return;
                      setSelectedDivMonth(prev =>
                        prev === target.monthIndex ? null : target.monthIndex
                      );
                      setDivShowAll(false);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <XAxis
                      dataKey="month"
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
                      width={56}
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
                      formatter={(v: number, name, item) => {
                        if (name === "average") {
                          return [formatMoney(v, summary?.baseCurrency), "月あたり平均"];
                        }
                        const pct = (item?.payload as { pct: number })?.pct ?? 0;
                        return [
                          `${formatMoney(v, summary?.baseCurrency)}（年間の ${pct.toFixed(1)}%）`,
                          "受取額",
                        ];
                      }}
                    />
                    {/* 平均線。棒がこれを超える月が「配当が多い月」 */}
                    <Line
                      type="monotone"
                      dataKey="average"
                      stroke="var(--muted-foreground)"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      dot={false}
                    />
                    <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                      {dividendMonthly.map(m => (
                        <Cell
                          key={m.month}
                          /*
                            選択中の月を最も強調する。未選択のときは最多月を
                            濃くして視線を誘導する。
                          */
                          fill={
                            selectedDivMonth === m.monthIndex
                              ? "var(--chart-1)"
                              : m.isPeak
                                ? "var(--chart-1)"
                                : "var(--chart-2)"
                          }
                          fillOpacity={
                            selectedDivMonth === null
                              ? m.isPeak
                                ? 1
                                : 0.65
                              : selectedDivMonth === m.monthIndex
                                ? 1
                                : 0.3
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                {/*
                  選択した月の銘柄内訳。どの銘柄がその月の金額を作っているかを
                  金額の大きい順に出す。減配時の影響を見積もるのに使う。
                */}
                {selectedDivDetail ? (
                  <div className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-semibold">
                        {selectedDivDetail.month + 1}月に配当が入る銘柄
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {selectedDivDetail.entries.length} 件
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular text-sm font-semibold text-gain">
                          {formatMoney(selectedDivDetail.totalBase, summary?.baseCurrency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedDivMonth(null)}
                          className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-accent-foreground active:scale-[0.97]"
                        >
                          閉じる
                        </button>
                      </div>
                    </div>
                    {selectedDivDetail.entries.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">
                        この月に配当が入る銘柄はありません
                      </p>
                    ) : (
                      <>
                      <ul className="space-y-1">
                        {(divShowAll
                          ? selectedDivDetail.entries
                          : selectedDivDetail.entries.slice(0, DIV_PREVIEW_COUNT)
                        ).map(e => (
                          <li
                            key={`${e.holdingId}-${e.symbol}`}
                            className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-2 py-1.5"
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <BrokerBadge broker={e.broker} short className="text-[10px]" />
                              <Link
                                href={`/holdings/${e.holdingId}`}
                                className="truncate text-xs hover:underline"
                              >
                                {e.name}
                              </Link>
                              <span className="tabular shrink-0 text-[10px] text-muted-foreground">
                                {e.tickerCode}
                              </span>
                              {e.hasSpecial ? (
                                <span
                                  className="shrink-0 text-[10px] text-warning"
                                  title="特別配当が含まれるため、来期も同額とは限りません"
                                >
                                  特別配当
                                </span>
                              ) : null}
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="tabular text-xs font-medium">
                                {formatMoney(e.amountBase, summary?.baseCurrency)}
                              </div>
                              {/* 外貨建ては現地通貨も出す。為替の影響を切り分けられるようにする */}
                              {e.currency !== summary?.baseCurrency ? (
                                <div className="tabular text-[10px] text-muted-foreground">
                                  {e.currency}{" "}
                                  {e.amount.toLocaleString(undefined, {
                                    maximumFractionDigits: 2,
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                      {/*
                        件数が多い月（3 月は 85 件）はスマホで延々とスクロールする
                        ことになるため、既定では上位のみ出す。上位が占める割合を
                        添えて「主要な銘柄がどれか」が分かるようにする。
                      */}
                      {selectedDivDetail.entries.length > DIV_PREVIEW_COUNT ? (
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          {!divShowAll ? (
                            <span className="text-[11px] text-muted-foreground">
                              上位 {DIV_PREVIEW_COUNT} 件でこの月の{" "}
                              {(
                                (selectedDivDetail.entries
                                  .slice(0, DIV_PREVIEW_COUNT)
                                  .reduce((acc, e) => acc + e.amountBase, 0) /
                                  selectedDivDetail.totalBase) *
                                100
                              ).toFixed(0)}
                              % を占めます
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              全 {selectedDivDetail.entries.length} 件を表示中
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setDivShowAll(v => !v)}
                            className="min-h-8 rounded-md border px-2.5 py-1 text-xs transition-all duration-150 hover:bg-accent hover:text-accent-foreground active:scale-[0.97]"
                          >
                            {divShowAll
                              ? "上位のみ表示"
                              : `残り ${selectedDivDetail.entries.length - DIV_PREVIEW_COUNT} 件を表示`}
                          </button>
                        </div>
                      ) : null}
                      </>
                    )}
                  </div>
                ) : null}
                {/*
                  集中度は「上位 3 か月が年間の何割か」。毎月均等なら 25%。
                  数字だけでは意味が伝わらないので、目安と解釈を添える。
                */}
                {dividends.concentration !== null ? (
                  <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-muted-foreground">
                        上位 3 か月に集まる割合
                      </span>
                      <span className="tabular font-semibold">
                        {(dividends.concentration * 100).toFixed(0)}%
                        <span className="ml-1 font-normal text-muted-foreground">
                          （毎月均等なら 25%）
                        </span>
                      </span>
                    </div>
                    <p className="mt-1.5 leading-relaxed text-muted-foreground">
                      {dividends.concentration >= 0.6
                        ? "特定の月に大きく偏っています。日本株は 3 月・9 月の権利確定が多いためで、生活費に充てる場合は受取が集中する月を前提に考える必要があります。"
                        : dividends.concentration >= 0.4
                          ? "やや偏りがあります。受取が少ない月があるため、月あたり平均だけで資金計画を立てると不足する月が出ます。"
                          : "比較的分散しています。月ごとの受取額の差が小さく、月あたり平均に近い形で入ります。"}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

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
