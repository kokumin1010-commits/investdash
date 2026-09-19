import { BrokerBadge } from "@/components/investing/BrokerBadge";
import { PctText, PnlText } from "@/components/investing/Figures";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  classifyMarketTemperature,
  MARKET_TEMPERATURE_THRESHOLDS,
  type MarketTemperatureLevel,
} from "@shared/marketTemperature";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";

const LEVEL_STYLE: Record<
  MarketTemperatureLevel,
  { badge: string; panel: string; icon: typeof ShieldCheck }
> = {
  NORMAL: {
    badge: "border-emerald-300 bg-emerald-50 text-emerald-800",
    panel: "border-emerald-200 bg-emerald-50/60",
    icon: ShieldCheck,
  },
  WATCH: {
    badge: "border-amber-300 bg-amber-50 text-amber-800",
    panel: "border-amber-200 bg-amber-50/70",
    icon: Activity,
  },
  CORRECTION: {
    badge: "border-orange-300 bg-orange-50 text-orange-800",
    panel: "border-orange-200 bg-orange-50/70",
    icon: ArrowDownRight,
  },
  SHARP_DROP: {
    badge: "border-red-300 bg-red-50 text-red-800",
    panel: "border-red-200 bg-red-50/70",
    icon: AlertTriangle,
  },
  UNAVAILABLE: {
    badge: "border-slate-300 bg-slate-50 text-slate-700",
    panel: "border-slate-200 bg-slate-50/70",
    icon: Activity,
  },
};

type MarketChange = {
  fromAt: Date;
  toAt: Date;
  days: number;
  gainDelta: number | null;
  gainPct: number | null;
  countDelta: number;
  compositionChanged: boolean;
  fellShort: boolean;
};

type Summary = {
  totalValueBase: number;
  totalCostBase: number;
  totalPnl: number;
  totalPnlPct: number | null;
  dayChangeBase: number | null;
  dayChangePct: number | null;
  cashBalance: number;
  totalBorrowedBase: number;
  netAssetsBase: number;
  overallLeverage: number | null;
  interestAssetsBase: number;
  marketChanges?: {
    day: MarketChange | null;
    sevenDay: MarketChange | null;
    thirtyDay: MarketChange | null;
  };
};

type BrokerRow = {
  key: string;
  label: string;
  value: number;
  pnl: number;
  pnlPct: number | null;
  leverage: {
    leverage: number | null;
    dropToMarginCallPct: number | null;
    interest: { annualInterestBase: number } | null;
  } | null;
};

type NetAssetsTrend = {
  currentJpy: number;
  previousJpy: number | null;
  dayChangeJpy: number | null;
  dayChangePct: number | null;
  previousAsOfDate: string | null;
  sevenDayChangeJpy: number | null;
  sevenDayChangePct: number | null;
  sevenDayAsOfDate: string | null;
  thirtyDayChangeJpy: number | null;
  thirtyDayChangePct: number | null;
  thirtyDayAsOfDate: string | null;
};

type Props = {
  summary: Summary;
  brokers: BrokerRow[];
  netAssetsTrend: NetAssetsTrend | null;
  confirmedPositiveCashJpy: number | null;
  provisionalNegativeCashJpy: number | null;
  money: (value: number | null | undefined, opts?: { compact?: boolean }) => string;
  moneyWithJpy: (value: number | null | undefined) => string;
};

function signedMoney(value: number | null, money: Props["money"]): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${money(Math.abs(value))}`;
}

function signedPct(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(value).toFixed(2)}%`;
}

function basisLabel(date: string | null, fallback: string): string {
  return date ? `${date}基準` : fallback;
}

function PeriodCard({
  label,
  marketAmount,
  marketPct,
  netAmount,
  netPct,
  basis,
  unavailable,
  money,
}: {
  label: string;
  marketAmount: number | null;
  marketPct: number | null;
  netAmount: number | null;
  netPct: number | null;
  basis: string;
  unavailable: string;
  money: Props["money"];
}) {
  const primary = marketPct ?? netPct;
  const primaryLabel =
    marketPct !== null
      ? "保有株値動き"
      : netPct !== null
        ? "純資産評価変動"
        : "実測未取得";
  const isNegative = primary !== null && primary < 0;
  const isPositive = primary !== null && primary > 0;

  return (
    <div className="rounded-xl border bg-background/80 p-3" data-testid={`temperature-${label}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <span className="text-[10px] text-muted-foreground">{basis}</span>
      </div>
      <p className="mt-2 text-[10px] font-medium text-muted-foreground">
        {primaryLabel}
      </p>
      <p
        className={`mt-0.5 font-mono text-xl font-semibold tabular-nums ${
          isNegative ? "text-loss" : isPositive ? "text-gain" : "text-foreground"
        }`}
      >
        {marketPct !== null ? signedPct(marketPct) : netPct !== null ? signedPct(netPct) : "—"}
      </p>
      <div className="mt-2 space-y-1 text-[11px] leading-relaxed">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">株式値動き</span>
          <span className="tabular font-medium">
            {marketAmount !== null ? signedMoney(marketAmount, money) : unavailable}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">純資産の評価変動</span>
          <span className="tabular font-medium">
            {netAmount !== null ? signedMoney(netAmount, money) : "未取得"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function MarketTemperaturePanel({
  summary,
  brokers,
  netAssetsTrend,
  confirmedPositiveCashJpy,
  provisionalNegativeCashJpy,
  money,
  moneyWithJpy,
}: Props) {
  const [trendScale, setTrendScale] = useState<"day" | "month">("day");
  const assetTrend = trpc.portfolio.assetTrend.useQuery({ scale: trendScale });
  const trend = assetTrend.data?.points ?? [];
  const hasNetAssetsLine = trend.some(point => point.netAssets !== null);

  const leveragedBrokers = [...brokers]
    .filter(broker => (broker.leverage?.leverage ?? 0) > 0)
    .sort(
      (a, b) =>
        (b.leverage?.leverage ?? 0) - (a.leverage?.leverage ?? 0)
    );
  const primaryLeveragedBroker = leveragedBrokers[0];
  const borrowingLabel =
    leveragedBrokers.length === 1
      ? `借入（${primaryLeveragedBroker.label}のみ）`
      : "借入";

  const dayMarketAmount = summary.dayChangeBase;
  const dayMarketPct = summary.dayChangePct;
  const weekMarketRaw = summary.marketChanges?.sevenDay ?? null;
  const monthMarketRaw = summary.marketChanges?.thirtyDay ?? null;
  const weekMarket =
    weekMarketRaw &&
    !weekMarketRaw.fellShort &&
    !weekMarketRaw.compositionChanged
      ? weekMarketRaw
      : null;
  const monthMarket =
    monthMarketRaw &&
    !monthMarketRaw.fellShort &&
    !monthMarketRaw.compositionChanged
      ? monthMarketRaw
      : null;
  const temperature = classifyMarketTemperature({
    dayPct: dayMarketPct,
    weekPct: weekMarket?.gainPct ?? null,
    monthPct: monthMarket?.gainPct ?? null,
  });
  const levelStyle = LEVEL_STYLE[temperature.level];
  const LevelIcon = levelStyle.icon;

  const chartDomain = useMemo<[number, number] | ["auto", "auto"]>(() => {
    const values = trend.flatMap(point =>
      [point.value, point.cost, point.netAssets].filter(
        (value): value is number => value !== null && Number.isFinite(value)
      )
    );
    if (values.length < 2) return ["auto", "auto"];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.14, max * 0.01);
    return [Math.max(0, min - padding), max + padding];
  }, [trend]);

  const windowLabel =
    temperature.trigger?.window === "DAY"
      ? "前日"
      : temperature.trigger?.window === "WEEK"
        ? "7日"
        : temperature.trigger?.window === "MONTH"
          ? "30日"
          : null;

  return (
    <section className="space-y-4" data-testid="market-temperature-panel">
      <Card className="overflow-hidden border-emerald-200/80 shadow-sm">
        <div className={`border-b px-4 py-3 sm:px-5 ${levelStyle.panel}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-base font-semibold">
                <Activity className="h-4 w-4" />
                資産温度計
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                保有株の実測値動きで下落の強さを判定。純資産差は入出金・為替・借入も含むため別表示です。
              </p>
            </div>
            <Badge variant="outline" className={levelStyle.badge}>
              <LevelIcon className="mr-1 h-3.5 w-3.5" />
              {temperature.label}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-foreground">{temperature.guidance}</span>
            <span className="text-muted-foreground">
              実測 {temperature.availableWindowCount}/3期間
              {windowLabel && temperature.trigger
                ? `・${windowLabel} ${signedPct(temperature.trigger.changePct)} が基準 ${temperature.trigger.thresholdPct.toFixed(1)}% 以下`
                : ""}
            </span>
          </div>
        </div>

        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border bg-card p-4 sm:p-5" data-testid="top-stock-value-card">
              <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Wallet className="h-4 w-4" />
                株式時価（借入を含む）
              </p>
              <p className="mt-4 font-mono text-3xl font-bold tracking-tight tabular-nums sm:text-4xl">
                {money(summary.totalValueBase)}
              </p>
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">現金性資産（利息で増える）</span>
                  <span className="font-mono font-semibold tabular-nums text-gain">
                    +{money(summary.interestAssetsBase)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{borrowingLabel}</span>
                  <span className="font-mono font-semibold tabular-nums text-loss">
                    −{moneyWithJpy(summary.totalBorrowedBase)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t pt-2">
                  <span className="font-semibold">純資産（実質の資産）</span>
                  <span className="font-mono font-bold tabular-nums">
                    {money(summary.netAssetsBase)}
                  </span>
                </div>
              </div>
              {primaryLeveragedBroker?.leverage ? (
                <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs dark:bg-amber-950/25">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">
                      {primaryLeveragedBroker.label} レバレッジ
                    </span>
                    <span className="font-mono text-lg font-bold tabular-nums text-amber-700 dark:text-amber-300">
                      {primaryLeveragedBroker.leverage.leverage?.toFixed(2) ?? "—"} 倍
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-muted-foreground">
                    <span>追証までの下落余地</span>
                    <span className="font-mono tabular-nums">
                      {primaryLeveragedBroker.leverage.dropToMarginCallPct !== null
                        ? `−${primaryLeveragedBroker.leverage.dropToMarginCallPct.toFixed(1)}%`
                        : "—"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-muted-foreground">
                    <span>年間の借入利息</span>
                    <span className="font-mono tabular-nums text-loss">
                      {primaryLeveragedBroker.leverage.interest
                        ? `−${moneyWithJpy(primaryLeveragedBroker.leverage.interest.annualInterestBase)}`
                        : "未取得"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-muted-foreground">
                    <span>全体レバレッジ（参考）</span>
                    <span className="font-mono tabular-nums">
                      {summary.overallLeverage !== null
                        ? `${summary.overallLeverage.toFixed(2)} 倍`
                        : "—"}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border bg-card p-4 sm:p-5" data-testid="top-unrealized-pnl-card">
              <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                評価損益
              </p>
              <div className="mt-4">
                <PnlText
                  value={summary.totalPnl}
                  currency="JPY"
                  baseValue={summary.totalPnl}
                  hideLocalHint
                  className="whitespace-nowrap font-mono text-3xl font-bold sm:text-4xl"
                />
                <div className="mt-1 flex flex-wrap items-baseline gap-2 text-sm">
                  <PctText
                    value={summary.totalPnlPct}
                    costValue={summary.totalCostBase}
                    className="font-semibold"
                  />
                  <span className="text-muted-foreground">
                    / 取得原価 {money(summary.totalCostBase)}
                  </span>
                </div>
              </div>
              {brokers.length > 1 ? (
                <div className="mt-4 space-y-1.5 border-t pt-3">
                  {brokers.map(broker => (
                    <div key={broker.key} className="flex items-center justify-between gap-3 text-xs">
                      <BrokerBadge broker={broker.key} short />
                      <span className="flex items-baseline gap-2 whitespace-nowrap">
                        <PnlText
                          value={broker.pnl}
                          currency="JPY"
                          baseValue={broker.pnl}
                          hideLocalHint
                          compact
                          className="font-mono text-sm font-semibold"
                        />
                        <PctText
                          value={broker.pnlPct}
                          costValue={broker.value - broker.pnl}
                          className="text-[11px]"
                        />
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3" data-testid="market-period-comparisons">
            <PeriodCard
              label="前日"
              marketAmount={dayMarketAmount}
              marketPct={dayMarketPct}
              netAmount={netAssetsTrend?.dayChangeJpy ?? null}
              netPct={netAssetsTrend?.dayChangePct ?? null}
              basis={basisLabel(netAssetsTrend?.previousAsOfDate ?? null, "前回比")}
              unavailable="未取得"
              money={money}
            />
            <PeriodCard
              label="7日"
              marketAmount={weekMarket?.gainDelta ?? null}
              marketPct={weekMarket?.gainPct ?? null}
              netAmount={netAssetsTrend?.sevenDayChangeJpy ?? null}
              netPct={netAssetsTrend?.sevenDayChangePct ?? null}
              basis={basisLabel(netAssetsTrend?.sevenDayAsOfDate ?? null, "7日前未取得")}
              unavailable={
                weekMarketRaw?.compositionChanged
                  ? `構成変更（${weekMarketRaw.countDelta > 0 ? "+" : ""}${weekMarketRaw.countDelta}銘柄）`
                  : weekMarketRaw?.fellShort
                    ? `${weekMarketRaw.days}日分のみ`
                    : "未取得"
              }
              money={money}
            />
            <PeriodCard
              label="30日"
              marketAmount={monthMarket?.gainDelta ?? null}
              marketPct={monthMarket?.gainPct ?? null}
              netAmount={netAssetsTrend?.thirtyDayChangeJpy ?? null}
              netPct={netAssetsTrend?.thirtyDayChangePct ?? null}
              basis={basisLabel(netAssetsTrend?.thirtyDayAsOfDate ?? null, "30日前未取得")}
              unavailable={
                monthMarketRaw?.compositionChanged
                  ? `構成変更（${monthMarketRaw.countDelta > 0 ? "+" : ""}${monthMarketRaw.countDelta}銘柄）`
                  : monthMarketRaw?.fellShort
                    ? `${monthMarketRaw.days}日分のみ`
                    : "未取得"
              }
              money={money}
            />
          </div>

          <div className="rounded-xl border border-dashed px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">買い場の準備:</span>{" "}
            確認済みプラス現金 {money(confirmedPositiveCashJpy)} / 借入・負現金{" "}
            {provisionalNegativeCashJpy !== null
              ? `−${money(Math.abs(provisionalNegativeCashJpy))}`
              : "未取得"}
            。下落判定は自動売買ではなく、現金余力・追証余地・買い候補の価格帯を確認する合図です。
          </div>
        </CardContent>
      </Card>

      <Card data-testid="top-asset-trend-card">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">資産推移</CardTitle>
              <CardDescription className="text-xs">
                {assetTrend.data && assetTrend.data.snapshotCount > 0 ? (
                  <>
                    記録 {assetTrend.data.snapshotCount}件
                    {assetTrend.data.firstAt && assetTrend.data.lastAt
                      ? `（${new Date(assetTrend.data.firstAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}〜${new Date(assetTrend.data.lastAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })}）`
                      : ""}
                    {assetTrend.data.fellBack ? "・月次不足のため日次表示" : ""}
                    ・JSTの各日／月の最新1点
                  </>
                ) : (
                  "株価更新のたびに実スナップショットを記録します"
                )}
              </CardDescription>
            </div>
            <div className="flex overflow-hidden rounded-md border">
              {[
                { key: "day" as const, label: "30日" },
                { key: "month" as const, label: "月次" },
              ].map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTrendScale(option.key)}
                  className={`px-3 py-1.5 text-xs transition-colors ${
                    trendScale === option.key
                      ? "bg-accent font-semibold text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {trend.length < 2 ? (
            <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-sm text-muted-foreground">異なる日の記録が2件以上たまると表示します</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={trend} margin={{ left: 2, right: 8, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="topValueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  domain={chartDomain}
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  tickLine={false}
                  axisLine={false}
                  width={58}
                  tickFormatter={value =>
                    new Intl.NumberFormat("ja-JP", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(value as number)
                  }
                />
                <ReTooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    fontSize: 12,
                    color: "var(--popover-foreground)",
                  }}
                  formatter={(value: number, name): [string, string] => [
                    money(value),
                    name === "netAssets"
                      ? "純資産"
                      : name === "value"
                        ? "株式時価"
                        : "取得原価",
                  ]}
                  labelFormatter={(label, payload) => {
                    const point = payload?.[0]?.payload as (typeof trend)[number] | undefined;
                    if (!point) return label;
                    if (point.positionChanged) {
                      const sign = point.positionDelta > 0 ? "+" : "";
                      return `${label}（${sign}${point.positionDelta}銘柄の登録あり）`;
                    }
                    return point.priceChange !== null
                      ? `${label}（株式値動き ${signedMoney(point.priceChange, money)}）`
                      : label;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  strokeWidth={1.25}
                  fill="none"
                />
                {hasNetAssetsLine ? (
                  <Area
                    type="monotone"
                    dataKey="netAssets"
                    stroke="var(--chart-2)"
                    strokeWidth={2.25}
                    fill="none"
                    connectNulls
                  />
                ) : null}
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--chart-1)"
                  strokeWidth={2.25}
                  fill="url(#topValueFill)"
                />
                {trend.map((point, index) =>
                  point.positionChanged ? (
                    <ReferenceLine
                      key={`top-mark-${index}`}
                      x={point.date}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="2 3"
                      strokeOpacity={0.5}
                    />
                  ) : null
                )}
              </AreaChart>
            </ResponsiveContainer>
          )}
          {trend.length >= 2 ? (
            <div className="mt-3 space-y-1.5 border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>━ 株式時価</span>
                {hasNetAssetsLine ? <span className="text-emerald-700">━ 純資産</span> : null}
                <span>┄ 取得原価</span>
                {(assetTrend.data?.changedPointCount ?? 0) > 0 ? <span>┆ 銘柄登録</span> : null}
              </div>
              <p>
                縦軸は変化を見やすく拡大表示しています。登録があった区間は増減を市場要因へ自動分類しません。
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="rounded-xl border border-dashed px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        判定基準（保有株の実測下落率）: 弱含みは前日−1.5%／7日−3%／30日−5%、調整は−3%／−7%／−10%、大幅下落は−5%／−10%／−15%。いずれか最も厳しい実測値を採用し、欠損値を0%で補いません。
      </div>
    </section>
  );
}
