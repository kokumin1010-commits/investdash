import { BrokerBadge } from "@/components/investing/BrokerBadge";
import { CurrencyToggle } from "@/components/investing/CurrencyToggle";
import { MoneyText } from "@/components/investing/Figures";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useDisplayCurrency } from "@/contexts/DisplayCurrencyContext";
import { parseBrokerFilter } from "@shared/brokerFilter";
import {
  BROKERS,
  BROKER_LABELS,
  MARKETS,
  brokerHex,
  brokerLabel,
  formatNumber,
  marketLabel,
  parseMarketFilter,
  sectorJa,
  type Broker,
  type Market,
} from "@shared/investing";
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  Coins,
  RefreshCw,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Link, useSearch } from "wouter";

/**
 * 配当専用ページ。
 *
 * ダッシュボードには「年間いくら入るか」「金利を賄えているか」という結論だけを置き、
 * 細かい確認はこのページで行う。具体的には次の使い方を想定している。
 *
 * - 特定の月にどの銘柄から配当が入るかを調べる（減配時の影響を見積もる）
 * - 口座別・市場別に絞って「IBKR の日本株だけ」を確認する
 * - 配当額・利回りの高い順に並べて、収入の柱になっている銘柄を把握する
 *
 * 月別の金額は権利落ち月を基準にしている。実際の入金は権利確定から
 * 2〜3 か月後になるため、画面上でも注記する。
 */

/** 並び替えの軸 */
type SortKey = "amount" | "yield" | "yieldOnCost" | "name";

/** 表示の切り替え。月から見るか、銘柄から見るか */
type ViewMode = "month" | "stock";

const MONTH_LABELS = [
  "1月",
  "2月",
  "3月",
  "4月",
  "5月",
  "6月",
  "7月",
  "8月",
  "9月",
  "10月",
  "11月",
  "12月",
];

/**
 * このページ内で使う金額整形。
 * 円未満の端数を出しても意味がないので小数は落とす。
 */
function formatMoneyLocal(value: number | null | undefined, currency = "JPY"): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Dividends() {
  const utils = trpc.useUtils();
  const overview = trpc.portfolio.overview.useQuery();

  /**
   * 口座・市場フィルタは URL クエリでも指定できる（?broker=ibkr&market=JP）。
   * ダッシュボードや保有一覧から絞った状態で飛べるようにするため。
   */
  const search = useSearch();
  const brokerFromUrl = useMemo(() => parseBrokerFilter(search), [search]);
  const marketFromUrl = useMemo(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return parseMarketFilter(params.get("market"));
  }, [search]);
  const [brokerFilterState, setBrokerFilter] = useState<"ALL" | Broker>("ALL");
  const [marketFilterState, setMarketFilter] = useState<"ALL" | Market>("ALL");
  const brokerFilter: "ALL" | Broker = brokerFromUrl ?? brokerFilterState;
  const marketFilter: "ALL" | Market = marketFromUrl ?? marketFilterState;

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("amount");
  const [view, setView] = useState<ViewMode>("month");
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [showAllInMonth, setShowAllInMonth] = useState(false);

  const syncDividends = trpc.portfolio.syncDividends.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      toast.success(`${res.updated} 銘柄の配当を更新しました`, {
        description:
          res.failed.length > 0
            ? `${res.failed.length} 銘柄は取得できませんでした`
            : undefined,
      });
    },
    onError: e => toast.error(e.message),
  });

  const data = overview.data;
  const summary = data?.summary;
  const baseCurrency = summary?.baseCurrency ?? "JPY";
  /**
   * 表示通貨。保有一覧・ダッシュボードと同じ選択を共有する。
   * 配当は「年間いくら入るか」を他の資産と比べる数字なので、
   * 画面ごとに通貨が違うと突き合わせられない。
   */
  const display = useDisplayCurrency();
  /** 円建ての集計値を表示通貨で描く */
  const money = (baseJpy: number | null | undefined) => {
    const converted = display.convert(baseJpy);
    if (converted === null) return formatMoneyLocal(baseJpy, baseCurrency);
    return formatMoneyLocal(converted, display.codeFor(baseCurrency));
  };
  const calendar = data?.dividendCalendar ?? [];
  const positions = data?.positions ?? [];

  /** 実際に保有がある口座・市場だけを選択肢にする */
  const usedBrokers = useMemo(() => {
    const set = new Set(positions.map(p => p.broker));
    return BROKERS.filter(b => set.has(b));
  }, [positions]);
  const usedMarkets = useMemo(() => {
    const set = new Set(positions.map(p => p.market));
    return MARKETS.filter(m => set.has(m));
  }, [positions]);

  /** 絞り込みが効いているか */
  const isFiltered = brokerFilter !== "ALL" || marketFilter !== "ALL" || query.trim() !== "";

  /**
   * カレンダーの各月から、絞り込み条件に合う銘柄だけを残す。
   *
   * 合計も絞り込み後の値で再計算する。全体の合計をそのまま出すと
   * 「IBKR の日本株だけ」に絞ったのに全体の金額が出て混乱するため。
   */
  const filteredCalendar = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calendar.map(m => {
      const entries = m.entries.filter(e => {
        if (brokerFilter !== "ALL" && e.broker !== brokerFilter) return false;
        if (marketFilter !== "ALL" && e.market !== marketFilter) return false;
        if (q) {
          const hit =
            e.name.toLowerCase().includes(q) ||
            e.tickerCode.toLowerCase().includes(q) ||
            e.symbol.toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      });
      const totalBase = entries.reduce((acc, e) => acc + e.amountBase, 0);
      return { month: m.month, entries, totalBase };
    });
  }, [calendar, brokerFilter, marketFilter, query]);

  /** 絞り込み後の年間合計（12 か月の合計） */
  const annualBase = useMemo(
    () => filteredCalendar.reduce((acc, m) => acc + m.totalBase, 0),
    [filteredCalendar]
  );

  /** グラフ用データ */
  const chartData = useMemo(() => {
    const average = annualBase / 12;
    const peak = filteredCalendar.reduce(
      (best, m) => (m.totalBase > (filteredCalendar[best]?.totalBase ?? 0) ? m.month : best),
      0
    );
    return filteredCalendar.map(m => ({
      month: MONTH_LABELS[m.month],
      monthIndex: m.month,
      amount: m.totalBase,
      average,
      pct: annualBase > 0 ? (m.totalBase / annualBase) * 100 : 0,
      isPeak: annualBase > 0 && m.month === peak && m.totalBase > 0,
      count: m.entries.length,
    }));
  }, [filteredCalendar, annualBase]);

  /** 上位 3 か月に集まる割合。毎月均等なら 25% */
  const concentration = useMemo(() => {
    if (annualBase <= 0) return null;
    const sorted = [...filteredCalendar].map(m => m.totalBase).sort((a, b) => b - a);
    const top3 = sorted.slice(0, 3).reduce((acc, v) => acc + v, 0);
    return top3 / annualBase;
  }, [filteredCalendar, annualBase]);

  /** 選択中の月の内訳 */
  const selected = useMemo(() => {
    if (selectedMonth === null) return null;
    return filteredCalendar[selectedMonth] ?? null;
  }, [filteredCalendar, selectedMonth]);

  /**
   * 銘柄ごとの配当一覧。
   *
   * カレンダーは口座レコード単位なので、同一銘柄を複数口座で持つ場合は
   * 銘柄でまとめて合算する（合計と口座別の両方を見たいという方針に合わせる）。
   * ただし口座で絞っているときはその口座分だけを集める。
   */
  const stockRows = useMemo(() => {
    type Row = {
      symbol: string;
      tickerCode: string;
      name: string;
      market: Market;
      sector: string | null;
      currency: string;
      brokers: Broker[];
      holdingId: number;
      annualBase: number;
      annualLocal: number;
      /** 配当が入る月（0 始まり） */
      months: number[];
      yieldPct: number | null;
      yieldOnCostPct: number | null;
      hasSpecial: boolean;
      yieldNeedsCheck: boolean;
    };
    const q = query.trim().toLowerCase();
    const map = new Map<string, Row>();
    for (const p of positions) {
      if (brokerFilter !== "ALL" && p.broker !== brokerFilter) continue;
      if (marketFilter !== "ALL" && p.market !== marketFilter) continue;
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          p.tickerCode.toLowerCase().includes(q) ||
          p.symbol.toLowerCase().includes(q);
        if (!hit) continue;
      }
      const d = p.dividend;
      if (!d || !d.annualIncomeBase || d.annualIncomeBase <= 0) continue;
      const existing = map.get(p.symbol);
      const months: number[] = [];
      if (d.monthlyIncomeBase && d.monthlyIncomeBase.length === 12) {
        d.monthlyIncomeBase.forEach((v, i) => {
          if (v > 0) months.push(i);
        });
      }
      if (existing) {
        existing.annualBase += d.annualIncomeBase;
        existing.annualLocal += d.annualIncome ?? 0;
        if (!existing.brokers.includes(p.broker)) existing.brokers.push(p.broker);
        for (const m of months) if (!existing.months.includes(m)) existing.months.push(m);
        existing.hasSpecial = existing.hasSpecial || d.hasSpecial;
        existing.yieldNeedsCheck = existing.yieldNeedsCheck || d.yieldNeedsCheck;
      } else {
        map.set(p.symbol, {
          symbol: p.symbol,
          tickerCode: p.tickerCode,
          name: p.name,
          market: p.market,
          sector: p.sector ?? null,
          currency: p.currency,
          brokers: [p.broker],
          holdingId: p.id,
          annualBase: d.annualIncomeBase,
          annualLocal: d.annualIncome ?? 0,
          months: [...months],
          /*
           * 利回りは口座をまたいでも同じ（同じ銘柄の株価と 1 株配当で決まる）ので
           * 先に見つかった値をそのまま使う。合算すると二重計上になる。
           */
          yieldPct: d.yieldPct ?? null,
          yieldOnCostPct: d.yieldOnCostPct ?? null,
          hasSpecial: d.hasSpecial,
          yieldNeedsCheck: d.yieldNeedsCheck,
        });
      }
    }
    const rows = Array.from(map.values());
    for (const r of rows) r.months.sort((a, b) => a - b);
    rows.sort((a, b) => {
      switch (sortKey) {
        case "yield":
          return (b.yieldPct ?? -Infinity) - (a.yieldPct ?? -Infinity);
        case "yieldOnCost":
          return (b.yieldOnCostPct ?? -Infinity) - (a.yieldOnCostPct ?? -Infinity);
        case "name":
          return a.name.localeCompare(b.name, "ja");
        default:
          return b.annualBase - a.annualBase;
      }
    });
    return rows;
  }, [positions, brokerFilter, marketFilter, query, sortKey]);

  if (overview.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const dividends = data?.dividends;
  const hasAny = (dividends?.annualIncomeBase ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* ヘッダ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">配当</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {dividends?.updatedAt
              ? `配当情報の取得: ${new Date(dividends.updatedAt).toLocaleDateString("ja-JP")}`
              : "配当情報は未取得です"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 他の画面と同じ選択を共有するので、通貨を揃えて突き合わせられる */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">金額表示</span>
            <CurrencyToggle />
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={syncDividends.isPending}
            onClick={() => syncDividends.mutate({})}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${syncDividends.isPending ? "animate-spin" : ""}`}
            />
            配当更新
          </Button>
        </div>
      </div>

      {!hasAny ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Coins className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              配当情報がまだ取得されていません
            </p>
            <Button
              className="mt-4"
              size="sm"
              disabled={syncDividends.isPending}
              onClick={() => syncDividends.mutate({})}
            >
              配当を取得する
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 絞り込み */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="銘柄名・コードで検索"
                className="h-9 pl-8"
              />
            </div>
            {usedBrokers.length > 1 ? (
              <Select
                value={brokerFilter}
                onValueChange={v => setBrokerFilter(v as "ALL" | Broker)}
              >
                <SelectTrigger className="h-9 w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">すべての口座</SelectItem>
                  {usedBrokers.map(b => (
                    <SelectItem key={b} value={b}>
                      {BROKER_LABELS[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {usedMarkets.length > 1 ? (
              <Select
                value={marketFilter}
                onValueChange={v => setMarketFilter(v as "ALL" | Market)}
              >
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">すべての市場</SelectItem>
                  {usedMarkets.map(m => (
                    <SelectItem key={m} value={m}>
                      {marketLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select value={view} onValueChange={v => setView(v as ViewMode)}>
              <SelectTrigger className="h-9 w-[150px]">
                <CalendarDays className="mr-1 h-3.5 w-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">月から見る</SelectItem>
                <SelectItem value="stock">銘柄から見る</SelectItem>
              </SelectContent>
            </Select>
            {view === "stock" ? (
              <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
                <SelectTrigger className="h-9 w-[170px]">
                  <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">配当額順</SelectItem>
                  <SelectItem value="yield">利回り順</SelectItem>
                  <SelectItem value="yieldOnCost">買値に対する利回り順</SelectItem>
                  <SelectItem value="name">銘柄名順</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
          </div>

          {/* 絞り込み後の合計 */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {isFiltered ? "絞り込み後の年間配当（税引前）" : "年間配当（税引前）"}
                  </p>
                  <p className="tabular mt-0.5 text-2xl font-semibold text-gain">
                    {money(annualBase)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    月あたり {money(annualBase / 12)}
                    {isFiltered && dividends
                      ? ` ・全体の ${
                          dividends.annualIncomeBase > 0
                            ? ((annualBase / dividends.annualIncomeBase) * 100).toFixed(1)
                            : "0"
                        }%`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {brokerFilter !== "ALL" ? (
                    <BrokerBadge broker={brokerFilter} />
                  ) : null}
                  {marketFilter !== "ALL" ? (
                    <Badge variant="outline">{marketLabel(marketFilter)}</Badge>
                  ) : null}
                  <span className="tabular text-xs text-muted-foreground">
                    {stockRows.length} 銘柄
                  </span>
                </div>
              </div>
              {!isFiltered && dividends ? (
                <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-muted-foreground">今の株価に対する利回り</p>
                    <p className="tabular mt-0.5 font-semibold">
                      {dividends.yieldPct !== null ? `${dividends.yieldPct.toFixed(2)}%` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">買った値段に対する利回り</p>
                    <p className="tabular mt-0.5 font-semibold text-gain">
                      {dividends.yieldOnCostPct !== null
                        ? `${dividends.yieldOnCostPct.toFixed(2)}%`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">配当あり / 無配</p>
                    <p className="tabular mt-0.5 font-semibold">
                      {dividends.payingCount} / {dividends.nonPayingCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">最も多い月</p>
                    <p className="tabular mt-0.5 font-semibold">
                      {dividends.peakMonth !== null ? MONTH_LABELS[dividends.peakMonth] : "—"}
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {view === "month" ? (
            <>
              {/* 月別グラフ */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">配当が入る月</CardTitle>
                  <CardDescription className="text-xs">
                    直近 1 年の実績を権利確定月に振り分けたもの。
                    実際の入金は権利確定から 2〜3 か月後になります。
                    月をタップするとその月に配当が入る銘柄が見られます。
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* 月を選ぶボタン列。棒はスマホでは押しにくいため導線を別に置く */}
                  <div className="mb-3 -mx-1 flex flex-wrap gap-1 px-1">
                    {chartData.map(m => {
                      const active = selectedMonth === m.monthIndex;
                      const empty = m.amount <= 0;
                      return (
                        <button
                          key={m.monthIndex}
                          type="button"
                          disabled={empty}
                          onClick={() => {
                            setSelectedMonth(active ? null : m.monthIndex);
                            setShowAllInMonth(false);
                          }}
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
                      data={chartData}
                      margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
                      onClick={state => {
                        const idx = state?.activeTooltipIndex;
                        if (typeof idx !== "number") return;
                        const target = chartData[idx];
                        if (!target || target.amount <= 0) return;
                        setSelectedMonth(prev =>
                          prev === target.monthIndex ? null : target.monthIndex
                        );
                        setShowAllInMonth(false);
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
                            return [money(v), "月あたり平均"];
                          }
                          const payload = item?.payload as { pct: number; count: number };
                          return [
                            `${money(v)}（年間の ${
                              payload?.pct?.toFixed(1) ?? "0"
                            }% ・${payload?.count ?? 0} 件）`,
                            "受取額",
                          ];
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="average"
                        stroke="var(--muted-foreground)"
                        strokeDasharray="4 4"
                        strokeWidth={1.5}
                        dot={false}
                      />
                      <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                        {chartData.map(m => (
                          <Cell
                            key={m.month}
                            fill={
                              selectedMonth === m.monthIndex || m.isPeak
                                ? "var(--chart-1)"
                                : "var(--chart-2)"
                            }
                            fillOpacity={
                              selectedMonth === null
                                ? m.isPeak
                                  ? 1
                                  : 0.65
                                : selectedMonth === m.monthIndex
                                  ? 1
                                  : 0.3
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {concentration !== null ? (
                    <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-muted-foreground">上位 3 か月に集まる割合</span>
                        <span className="tabular font-semibold">
                          {(concentration * 100).toFixed(0)}%
                          <span className="ml-1 font-normal text-muted-foreground">
                            （毎月均等なら 25%）
                          </span>
                        </span>
                      </div>
                      <p className="mt-1.5 leading-relaxed text-muted-foreground">
                        {concentration >= 0.6
                          ? "特定の月に大きく偏っています。日本株は 3 月・9 月の権利確定が多いためで、生活費に充てる場合は受取が集中する月を前提に考える必要があります。"
                          : concentration >= 0.4
                            ? "やや偏りがあります。受取が少ない月があるため、月あたり平均だけで資金計画を立てると不足する月が出ます。"
                            : "比較的分散しています。月ごとの受取額の差が小さく、月あたり平均に近い形で入ります。"}
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* 選択した月の銘柄内訳 */}
              {selected ? (
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">
                          {MONTH_LABELS[selected.month]}に配当が入る銘柄
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {selected.entries.length} 件 ・金額の大きい順
                        </CardDescription>
                      </div>
                      <span className="tabular text-sm font-semibold text-gain">
                        {money(selected.totalBase)}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {selected.entries.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        条件に一致する銘柄がありません
                      </p>
                    ) : (
                      <>
                        <div className="space-y-1">
                          {(showAllInMonth
                            ? selected.entries
                            : selected.entries.slice(0, 15)
                          ).map(e => (
                            <Link
                              key={`${e.holdingId}`}
                              href={`/holdings/${e.holdingId}`}
                              className="relative flex items-center justify-between gap-2 rounded-md border border-transparent py-1.5 pl-3 pr-2 transition-colors hover:border-border hover:bg-accent/40"
                            >
                              {/* 口座の色を帯で出し、どの口座の配当かを一目で分かるようにする */}
                              <span
                                aria-hidden
                                className="absolute inset-y-1 left-0 w-1 rounded-full"
                                style={{ backgroundColor: brokerHex(e.broker) }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-sm font-medium">{e.name}</span>
                                  {e.hasSpecial || e.yieldNeedsCheck ? (
                                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <span className="tabular">{e.tickerCode}</span>
                                  <span>·</span>
                                  <BrokerBadge broker={e.broker} short />
                                  <span>·</span>
                                  <span>{marketLabel(e.market)}</span>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="tabular text-sm font-semibold text-gain">
                                  {money(e.amountBase)}
                                </p>
                                {/*
                                  表示通貨と違う通貨の銘柄だけ現地通貨を添える。
                                  同じ通貨なら同じ数字が二度並ぶだけになるため。
                                */}
                                {display.showLocalHint(e.currency) ? (
                                  <MoneyText
                                    value={e.amount}
                                    currency={e.currency}
                                    className="block text-[11px] text-muted-foreground"
                                  />
                                ) : null}
                              </div>
                            </Link>
                          ))}
                        </div>
                        {selected.entries.length > 15 ? (
                          <div className="mt-2 text-center">
                            <button
                              type="button"
                              onClick={() => setShowAllInMonth(v => !v)}
                              className="min-h-8 rounded-md border px-2.5 py-1 text-xs transition-all duration-150 hover:bg-accent hover:text-accent-foreground active:scale-[0.97]"
                            >
                              {showAllInMonth
                                ? "上位のみ表示"
                                : `残り ${selected.entries.length - 15} 件を表示`}
                            </button>
                          </div>
                        ) : null}
                      </>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    月をタップすると、その月に配当が入る銘柄が表示されます
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            /* 銘柄から見る */
            <Card>
              <CardHeader>
                <CardTitle className="text-base">銘柄別の配当</CardTitle>
                <CardDescription className="text-xs">
                  同じ銘柄を複数の口座で持っている場合は合算しています。
                  「入る月」はその銘柄の権利確定月です。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {stockRows.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    条件に一致する銘柄がありません
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {stockRows.map(r => (
                      <Link
                        key={r.symbol}
                        href={`/holdings/${r.holdingId}`}
                        className="block rounded-lg border border-border/70 p-2.5 transition-colors hover:border-border hover:bg-accent/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{r.name}</span>
                              {r.hasSpecial || r.yieldNeedsCheck ? (
                                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                              ) : null}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="tabular">{r.tickerCode}</span>
                              <span>·</span>
                              <span>{marketLabel(r.market)}</span>
                              {r.sector ? (
                                <>
                                  <span>·</span>
                                  <span className="truncate">{sectorJa(r.sector)}</span>
                                </>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {r.brokers.map(b => (
                                <BrokerBadge key={b} broker={b} short />
                              ))}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="tabular text-sm font-semibold text-gain">
                              {money(r.annualBase)}
                            </p>
                            <p className="tabular text-[11px] text-muted-foreground">
                              利回り{" "}
                              {r.yieldPct !== null ? `${r.yieldPct.toFixed(2)}%` : "—"}
                            </p>
                            <p className="tabular text-[11px] text-muted-foreground">
                              買値に対して{" "}
                              {r.yieldOnCostPct !== null
                                ? `${r.yieldOnCostPct.toFixed(2)}%`
                                : "—"}
                            </p>
                          </div>
                        </div>
                        {r.months.length > 0 ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1 border-t pt-2">
                            <span className="text-[10px] text-muted-foreground">入る月</span>
                            {r.months.map(m => (
                              <span
                                key={m}
                                className="tabular rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                              >
                                {MONTH_LABELS[m]}
                              </span>
                            ))}
                            <span className="ml-auto text-[10px] text-muted-foreground">
                              年 {formatNumber(r.months.length, 0)} 回
                            </span>
                          </div>
                        ) : null}
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
