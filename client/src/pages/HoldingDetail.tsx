import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import { BrokerBadge } from "@/components/investing/BrokerBadge";
import { MoneyText, PctText, PnlText } from "@/components/investing/Figures";
import { CurrencyToggle } from "@/components/investing/CurrencyToggle";
import { SignalBadge, SignalPlaceholder } from "@/components/investing/SignalBadge";
import { PriceBandPlanCard } from "@/components/investing/PriceBandPlanCard";
import { SymbolConsultList } from "@/components/investing/SymbolConsultList";
import { AdviceRecordCard } from "@/components/investing/AdviceRecordCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  SENTIMENT_STYLES,
  formatMoney,
  formatNumber,
  marketLabel,
  sectorJa,
  sentimentLabel,
} from "@shared/investing";
import {
  ArrowLeft,
  Brain,
  ExternalLink,
  Globe,
  Loader2,
  Newspaper,
  RefreshCw,
  Save,
  Sparkles,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";

export default function HoldingDetail({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const detail = trpc.portfolio.detail.useQuery({ id }, { enabled: Number.isFinite(id) && id > 0 });

  /*
   * 買い増しプランは銘柄（symbol）単位。detail が読めてからでないと symbol が
   * 分からないため、取得できるまでクエリを止めておく。
   */
  const symbol = detail.data?.holding.symbol;
  const bandPlan = trpc.portfolio.priceBandPlan.useQuery(
    { symbol: symbol ?? "" },
    { enabled: !!symbol }
  );

  /*
   * この銘柄について過去に相談した記録。
   * 相談画面を開かないと分からない状態だと「前に検討した」ことに気付けない。
   */
  const consults = trpc.consult.bySymbol.useQuery(
    { symbol: symbol ?? "" },
    { enabled: !!symbol }
  );

  const generateBandPlan = trpc.portfolio.generatePriceBandPlan.useMutation({
    onSuccess: async () => {
      await utils.portfolio.priceBandPlan.invalidate();
      toast.success("買い増しプランを作成しました");
    },
    onError: e => toast.error(e.message),
  });

  /*
   * 確認項目の照合。今いる価格帯の項目だけを対象にする。
   * サーバー側でも帯の外なら弾くので、押せてしまっても誤った照合は行われない。
   */
  const runBandChecks = trpc.portfolio.runBandChecks.useMutation({
    onSuccess: async res => {
      await utils.portfolio.priceBandPlan.invalidate();
      const checked = res.bands.flatMap(b => b.checks ?? []);
      const concern = checked.filter(c => c.status === "CONCERN").length;
      toast.success(
        concern > 0
          ? `確認しました。懸念材料が ${concern} 件見つかりました`
          : "確認しました。懸念材料は見つかりませんでした"
      );
    },
    onError: e => toast.error(e.message),
  });

  /*
   * 段を手で直す。AI の提案が自分の考えと合わない場合に使う。
   * 保存すると、その段に紐づく過去の照合結果はサーバー側で消える
   * （古い価格帯に対する判断が別の価格帯の材料として読まれるのを防ぐため）。
   */
  const updateBand = trpc.portfolio.updatePriceBand.useMutation({
    onSuccess: async () => {
      await utils.portfolio.priceBandPlan.invalidate();
      await utils.portfolio.priceBandOverview.invalidate();
      toast.success("価格帯を保存しました");
    },
    onError: e => toast.error(e.message),
  });

  const regenSignal = trpc.portfolio.regenerateSignal.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      toast.success(`シグナルを生成しました: ${res.action}`);
    },
    onError: e => toast.error(e.message),
  });

  const syncNews = trpc.news.syncOne.useMutation({
    onSuccess: async res => {
      await utils.invalidate();
      toast.success(
        res.fetched > 0 ? `${res.fetched} 件のニュースを取得しました` : "新しいニュースはありませんでした"
      );
    },
    onError: e => toast.error(e.message),
  });

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          {detail.error?.message ?? "銘柄が見つかりませんでした"}
        </p>
        <Button variant="outline" onClick={() => setLocation("/holdings")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          保有銘柄一覧へ戻る
        </Button>
      </div>
    );
  }

  const { holding, view, card, news, signalHistory, chart } = detail.data;
  const currency = holding.currency;

  const chartData = chart.map(p => ({
    date: new Date(p.t).toLocaleDateString("ja-JP", { year: "2-digit", month: "numeric", day: "numeric" }),
    close: p.c,
  }));

  const avgCostNum = Number(holding.avgCost);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 pb-10">
      {/* ヘッダー */}
      <div className="space-y-3">
        <Link
          href="/holdings"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          保有銘柄一覧
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{holding.name}</h1>
              <Badge variant="secondary" className="tabular">
                {holding.tickerCode}
              </Badge>
              <Badge variant="outline">{marketLabel(holding.market)}</Badge>
              <BrokerBadge broker={holding.broker} />
              {view?.signal ? <SignalBadge action={view.signal.action} showLabel /> : <SignalPlaceholder />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {holding.sector ? <span>{sectorJa(holding.sector)}</span> : null}
              {holding.industry ? <span>· {holding.industry}</span> : null}
              {holding.website ? (
                <a
                  href={holding.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                >
                  <Globe className="h-3 w-3" />
                  公式サイト
                </a>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* 他の画面と同じ表示通貨で評価額を見られるようにする */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">金額表示</span>
              <CurrencyToggle />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={syncNews.isPending}
              onClick={() => syncNews.mutate({ symbol: holding.symbol })}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncNews.isPending ? "animate-spin" : ""}`} />
              ニュース取得
            </Button>
            {/*
              この銘柄を対象にした相談を始める。銘柄を選び直す手間をなくすため
              symbol を渡して開く。相談側では保有状況とこの銘柄のニュースが
              自動で前提に入る。
            */}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/consult?symbol=${encodeURIComponent(holding.symbol)}`}>
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                AI に相談
              </Link>
            </Button>
            <Button
              size="sm"
              disabled={regenSignal.isPending}
              onClick={() => regenSignal.mutate({ id })}
            >
              <Brain className={`mr-1.5 h-3.5 w-3.5 ${regenSignal.isPending ? "animate-pulse" : ""}`} />
              AI 分析を実行
            </Button>
          </div>
        </div>
      </div>

      {/* ポジションサマリー */}
      <Card>
        <CardContent className="grid gap-x-6 gap-y-4 py-5 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="保有株数" value={`${formatNumber(Number(holding.quantity), 0)} 株`} />
          {/*
            単価は換算しない。板に出る値段と一致していないと
            「いくらで買えるか」の判断に使えないため。
          */}
          <Metric label="取得単価" value={formatMoney(avgCostNum, currency)} />
          <Metric label="現在値" value={formatMoney(view?.currentPrice, currency)} />
          <Metric
            label="評価額"
            node={
              <MoneyText
                value={view?.marketValue ?? null}
                currency={currency}
                baseValue={view?.marketValueBase ?? null}
                className="text-base font-semibold"
              />
            }
            sub={
              view?.weightPct !== null && view?.weightPct !== undefined
                ? `構成比 ${view.weightPct.toFixed(1)}%`
                : undefined
            }
          />
          <Metric
            label="評価損益"
            node={
              <PnlText
                value={view?.pnl ?? null}
                currency={currency}
                /*
                  損益の円換算値は API に無いので、円換算の評価額と取得原価から出す。
                  どちらも同じレートで換算されているため、差もそのまま円建てになる。
                */
                baseValue={
                  view?.marketValueBase !== null && view?.marketValueBase !== undefined
                    ? view.marketValueBase - view.costValueBase
                    : null
                }
                hideLocalHint
                className="text-base"
              />
            }
            sub={undefined}
            subNode={
              <PctText
                value={view?.pnlPct ?? null}
                costValue={view?.costValue ?? null}
                className="text-xs"
              />
            }
          />
          <Metric
            label="52週レンジ"
            value={
              view?.fiftyTwoWeekLow && view?.fiftyTwoWeekHigh
                ? `${formatNumber(view.fiftyTwoWeekLow, 0)} 〜 ${formatNumber(view.fiftyTwoWeekHigh, 0)}`
                : "—"
            }
            sub={
              view?.currentPrice && view?.fiftyTwoWeekHigh && view?.fiftyTwoWeekLow
                ? `レンジ内 ${(
                    ((view.currentPrice - view.fiftyTwoWeekLow) /
                      (view.fiftyTwoWeekHigh - view.fiftyTwoWeekLow)) *
                    100
                  ).toFixed(0)}%`
                : undefined
            }
          />
        </CardContent>
      </Card>

      {/* AI シグナル詳細 */}
      {view?.signal ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Brain className="h-4 w-4" />
                AI 意思決定シグナル
              </CardTitle>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>確信度 {view.signal.confidence ?? "—"}</span>
                <span>·</span>
                <span>{new Date(view.signal.createdAt).toLocaleString("ja-JP")}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <SignalBadge action={view.signal.action} showLabel className="mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">{view.signal.rationale}</p>
            </div>

            {signalHistory[0]?.factors ? (
              <>
                <Separator />
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(FACTOR_LABELS).map(([key, label]) => {
                    const factors = signalHistory[0].factors as Record<string, string> | null;
                    const text = factors?.[key];
                    if (!text) return null;
                    return (
                      <div key={key} className="space-y-1">
                        <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
                        <dd className="text-xs leading-relaxed">{text}</dd>
                      </div>
                    );
                  })}
                </dl>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              この銘柄の AI シグナルはまだ生成されていません。
              <br />
              投資カードを記入してから実行すると、判断材料が増えて分析の精度が上がります。
            </p>
            <Button size="sm" disabled={regenSignal.isPending} onClick={() => regenSignal.mutate({ id })}>
              <Brain className="mr-1.5 h-3.5 w-3.5" />
              AI 分析を実行
            </Button>
          </CardContent>
        </Card>
      )}

      {/*
        買い増しプラン（価格帯ごとの行動）。
        「この値段になったらこうする」を段組みで持ち、今の株価がどの段にいるかを示す。
        シグナル（今の総合判断）とは役割が違うので独立したカードにする。
      */}
      <PriceBandPlanCard
        plan={bandPlan.data}
        isGenerating={generateBandPlan.isPending}
        isLoading={bandPlan.isLoading}
        errorMessage={bandPlan.error?.message ?? null}
        onGenerate={() => {
          if (symbol) generateBandPlan.mutate({ symbol });
        }}
        onRunChecks={bandId => runBandChecks.mutate({ bandId })}
        isCheckingBandId={runBandChecks.isPending ? runBandChecks.variables?.bandId : null}
        onSaveBand={params => updateBand.mutate(params)}
        savingBandId={updateBand.isPending ? (updateBand.variables?.bandId ?? null) : null}
      />

      <Tabs defaultValue="card">
        <TabsList>
          <TabsTrigger value="card">投資カード</TabsTrigger>
          <TabsTrigger value="chart">価格チャート</TabsTrigger>
          <TabsTrigger value="news">ニュース ({news.length})</TabsTrigger>
          <TabsTrigger value="history">シグナル履歴 ({signalHistory.length})</TabsTrigger>
          <TabsTrigger value="consult">相談 ({consults.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="card" className="mt-4">
          <InvestmentCardForm
            symbol={holding.symbol}
            holdingId={holding.id}
            currency={currency}
            currentPrice={view?.currentPrice ?? null}
            card={card}
          />
        </TabsContent>

        <TabsContent value="consult" className="mt-4">
          <div className="space-y-4">
            <SymbolConsultList
              symbol={holding.symbol}
              rows={consults.data ?? []}
              isPending={consults.isPending}
            />
            {/*
              この銘柄への提案が実行されたか・当たったかを併せて出す。
              相談の中身だけ見ても「勧められて実際どうしたか」が分からない。
            */}
            <AdviceRecordCard symbol={holding.symbol} />
          </div>
        </TabsContent>

        <TabsContent value="chart" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" />
                過去1年の株価推移
              </CardTitle>
              <CardDescription className="text-xs">
                破線は取得単価（{formatMoney(avgCostNum, currency)}）
              </CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length < 2 ? (
                <p className="py-20 text-center text-sm text-muted-foreground">
                  チャートデータを取得できませんでした
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={40}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--muted-foreground)"
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      domain={["auto", "auto"]}
                      tickFormatter={v => formatNumber(v as number, 0)}
                    />
                    <ReTooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                      formatter={(v: number) => [formatMoney(v, currency), "終値"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      fill="url(#priceFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="news" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Newspaper className="h-4 w-4" />
                関連ニュース
              </CardTitle>
              <CardDescription className="text-xs">
                AI がポジティブ／ネガティブと影響度を判定しています
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {news.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <p className="text-sm text-muted-foreground">ニュースがまだ取得されていません</p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={syncNews.isPending}
                    onClick={() => syncNews.mutate({ symbol: holding.symbol })}
                  >
                    ニュースを取得
                  </Button>
                </div>
              ) : (
                news.map(item => <NewsRow key={item.id} item={item} />)
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">シグナル履歴</CardTitle>
              <CardDescription className="text-xs">
                判断の変遷を記録しています。過去の自分の判断を振り返れます。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {signalHistory.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">履歴はまだありません</p>
              ) : (
                signalHistory.map(s => (
                  <div key={s.id} className="rounded-lg border border-border/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <SignalBadge action={s.action} />
                        <span className="text-xs text-muted-foreground">
                          確信度 {s.confidence ?? "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {s.priceAtSignal ? (
                          <span className="tabular">
                            当時株価 {formatMoney(Number(s.priceAtSignal), currency)}
                          </span>
                        ) : null}
                        <span>{new Date(s.createdAt).toLocaleString("ja-JP")}</span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{s.rationale}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {holding.businessSummary ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">事業概要</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs leading-relaxed text-muted-foreground">{holding.businessSummary}</p>
          </CardContent>
        </Card>
      ) : null}

      <DisclaimerNote />
    </div>
  );
}

const FACTOR_LABELS: Record<string, string> = {
  newsSentiment: "ニュース評価",
  priceAction: "価格動向",
  valuation: "バリュエーション",
  positionSizing: "ポジションサイズ",
  thesisIntegrity: "投資ロジックの健全性",
};

function Metric({
  label,
  value,
  node,
  sub,
  subNode,
}: {
  label: string;
  value?: string;
  node?: React.ReactNode;
  sub?: string;
  subNode?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {node ?? <p className="tabular text-base font-semibold">{value}</p>}
      {subNode ?? (sub ? <p className="tabular text-xs text-muted-foreground">{sub}</p> : null)}
    </div>
  );
}

function NewsRow({
  item,
}: {
  item: {
    id: number;
    title: string;
    url: string;
    source: string | null;
    publishedAt: Date | null;
    sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | null;
    impactScore: number | null;
    summary: string | null;
    reasoning: string | null;
  };
}) {
  return (
    <div className="rounded-lg border border-border/70 p-3 transition-colors hover:bg-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-1.5 text-sm font-medium leading-snug"
          >
            <span className="group-hover:underline">{item.title}</span>
            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
          </a>
          {item.summary ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{item.summary}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {item.source ? <span>{item.source}</span> : null}
            {item.publishedAt ? (
              <span>{new Date(item.publishedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.sentiment ? (
            <Badge variant="outline" className={`text-[11px] ${SENTIMENT_STYLES[item.sentiment]}`}>
              {sentimentLabel(item.sentiment)}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-dashed text-[11px] text-muted-foreground">
              未分析
            </Badge>
          )}
          {item.impactScore !== null ? (
            <span className="tabular text-[11px] text-muted-foreground">影響度 {item.impactScore}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- 投資カードフォーム --------------------------- */

type CardData = {
  buyReason: string | null;
  coreThesis: string | null;
  valuationAssumption: string | null;
  fairValue: string | null;
  keyFinancials: string | null;
  exitConditions: string | null;
  risks: string | null;
  horizon: string | null;
  conviction: number | null;
} | null;

const FIELDS = [
  {
    key: "buyReason" as const,
    label: "買付理由",
    placeholder: "なぜこの銘柄を買ったのか。当時の判断材料を、未来の自分が読んで理解できる言葉で書き残します。",
    rows: 4,
  },
  {
    key: "coreThesis" as const,
    label: "コア投資ロジック",
    placeholder: "この投資が成立するために必要な条件は何か。この前提が崩れたら投資理由が消える、という核心を 1〜3 点に絞って書きます。",
    rows: 4,
  },
  {
    key: "valuationAssumption" as const,
    label: "バリュエーション前提",
    placeholder: "どの指標で、どの水準を妥当と考えたか。想定 PER・PBR・売上成長率・利益率などの前提を記録します。",
    rows: 3,
  },
  {
    key: "keyFinancials" as const,
    label: "主要決算数値",
    placeholder: "直近決算の売上・営業利益・EPS・進捗率など。決算発表のたびに追記していくと、変化が追えます。",
    rows: 4,
  },
  {
    key: "exitConditions" as const,
    label: "エグジット条件",
    placeholder: "どうなったら売るのか。目標株価到達、投資ロジックの崩壊、代替投資先の出現など、事前に決めておく条件を書きます。AI シグナルはこの条件を最優先で確認します。",
    rows: 4,
  },
  {
    key: "risks" as const,
    label: "想定リスク",
    placeholder: "この投資が失敗するとしたら、どのシナリオか。競合、規制、為替、経営陣など。",
    rows: 3,
  },
];

function InvestmentCardForm({
  symbol,
  holdingId,
  currency,
  currentPrice,
  card,
}: {
  symbol: string;
  holdingId: number;
  currency: string;
  currentPrice: number | null;
  card: CardData;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({
    buyReason: card?.buyReason ?? "",
    coreThesis: card?.coreThesis ?? "",
    valuationAssumption: card?.valuationAssumption ?? "",
    keyFinancials: card?.keyFinancials ?? "",
    exitConditions: card?.exitConditions ?? "",
    risks: card?.risks ?? "",
    fairValue: card?.fairValue ?? "",
    horizon: card?.horizon ?? "",
    conviction: card?.conviction ? String(card.conviction) : "",
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setForm({
      buyReason: card?.buyReason ?? "",
      coreThesis: card?.coreThesis ?? "",
      valuationAssumption: card?.valuationAssumption ?? "",
      keyFinancials: card?.keyFinancials ?? "",
      exitConditions: card?.exitConditions ?? "",
      risks: card?.risks ?? "",
      fairValue: card?.fairValue ?? "",
      horizon: card?.horizon ?? "",
      conviction: card?.conviction ? String(card.conviction) : "",
    });
    setDirty(false);
  }, [card]);

  const save = trpc.portfolio.saveCard.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      toast.success("投資カードを保存しました");
      setDirty(false);
    },
    onError: e => toast.error(e.message),
  });

  /*
   * AI に下書きさせる。
   *
   * 手で書く前提だと 112 銘柄は書き切れず、実際に 1 件も作られていなかった。
   * 購入判断はもともと AI に相談して決めているので、下書きを AI が作り
   * 必要なら直すだけの形にする。
   */
  const draft = trpc.portfolio.draftCard.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      if (res.created) {
        toast.success("AI が下書きを作りました。内容を確認してください");
      } else {
        toast.info(res.reason ?? "すでに内容があるため上書きしていません");
      }
    },
    onError: e => toast.error(e.message),
  });

  const set = (key: keyof typeof form) => (v: string) => {
    setForm(f => ({ ...f, [key]: v }));
    setDirty(true);
  };

  const fairValueGap = useMemo(() => {
    const fv = Number(form.fairValue);
    if (!form.fairValue || !Number.isFinite(fv) || fv <= 0 || currentPrice === null) return null;
    return ((currentPrice - fv) / fv) * 100;
  }, [form.fairValue, currentPrice]);

  const filledCount = FIELDS.filter(f => form[f.key].trim()).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">企業投資カード</CardTitle>
              <CardDescription className="text-xs">
                「なぜこの銘柄を買ったのか」を忘れないための記録。AI シグナルはこの内容を判断材料に使います。
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={filledCount === FIELDS.length ? "default" : "secondary"}>
                {filledCount} / {FIELDS.length} 項目 記入済み
              </Badge>
              <Button
                size="sm"
                variant={filledCount === 0 ? "default" : "outline"}
                className={filledCount === 0 ? "" : "bg-background"}
                disabled={draft.isPending}
                onClick={() => {
                  /*
                   * すでに書いてある場合は上書きの確認を取る。
                   * 手で直した内容が消えると直す気力がなくなる。
                   */
                  const force =
                    filledCount === 0 ||
                    window.confirm(
                      "すでに記入がある項目も AI の下書きで置き換えますか。元の内容は残りません。"
                    );
                  if (!force && filledCount > 0) return;
                  draft.mutate({ symbol, force: filledCount > 0 });
                }}
              >
                {draft.isPending ? (
                  <>
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    AI が下書き中
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1 h-3.5 w-3.5" />
                    {filledCount === 0 ? "AI に下書きさせる" : "AI で作り直す"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="fair-value">想定フェアバリュー（{currency}）</Label>
              <Input
                id="fair-value"
                type="number"
                inputMode="decimal"
                value={form.fairValue}
                onChange={e => set("fairValue")(e.target.value)}
                placeholder="4000"
              />
              {fairValueGap !== null ? (
                <p className="text-xs text-muted-foreground">
                  現在値は想定価値より{" "}
                  <span className={fairValueGap > 0 ? "text-loss font-medium" : "text-gain font-medium"}>
                    {fairValueGap > 0 ? "割高" : "割安"} {Math.abs(fairValueGap).toFixed(1)}%
                  </span>
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="horizon">投資期間</Label>
              <Input
                id="horizon"
                value={form.horizon}
                onChange={e => set("horizon")(e.target.value)}
                placeholder="3〜5年"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conviction">確信度</Label>
              <Select
                value={form.conviction || "none"}
                onValueChange={v => set("conviction")(v === "none" ? "" : v)}
              >
                <SelectTrigger id="conviction">
                  <SelectValue placeholder="選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未設定</SelectItem>
                  <SelectItem value="5">5 — 非常に高い</SelectItem>
                  <SelectItem value="4">4 — 高い</SelectItem>
                  <SelectItem value="3">3 — 中程度</SelectItem>
                  <SelectItem value="2">2 — 低い</SelectItem>
                  <SelectItem value="1">1 — 試し買い</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          <div className="grid gap-5 lg:grid-cols-2">
            {FIELDS.map(f => (
              <div key={f.key} className="space-y-2">
                <Label htmlFor={`card-${f.key}`}>{f.label}</Label>
                <Textarea
                  id={`card-${f.key}`}
                  value={form[f.key]}
                  onChange={e => set(f.key)(e.target.value)}
                  placeholder={f.placeholder}
                  rows={f.rows}
                  className="resize-y text-sm leading-relaxed"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {card ? "保存済みの内容を編集しています" : "まだ保存されていません"}
          {dirty ? " ・ 未保存の変更があります" : ""}
        </p>
        <Button
          disabled={save.isPending || !dirty}
          onClick={() =>
            save.mutate({
              symbol,
              holdingId,
              buyReason: form.buyReason,
              coreThesis: form.coreThesis,
              valuationAssumption: form.valuationAssumption,
              keyFinancials: form.keyFinancials,
              exitConditions: form.exitConditions,
              risks: form.risks,
              horizon: form.horizon || undefined,
              fairValue: form.fairValue ? Number(form.fairValue) : null,
              conviction: form.conviction ? Number(form.conviction) : null,
            })
          }
        >
          <Save className="mr-1.5 h-4 w-4" />
          {save.isPending ? "保存中..." : "投資カードを保存"}
        </Button>
      </div>
    </div>
  );
}
