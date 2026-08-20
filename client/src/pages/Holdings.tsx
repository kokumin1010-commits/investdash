import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import { BrokerBadge } from "@/components/investing/BrokerBadge";
import { BrokerBreakdown } from "@/components/investing/BrokerBreakdown";
import { CurrencyToggle } from "@/components/investing/CurrencyToggle";
import { MoneyText, PctText, PnlText } from "@/components/investing/Figures";
import { AddAmountLine } from "@/components/investing/AddAmountLine";
import { SignalBadge, SignalPlaceholder } from "@/components/investing/SignalBadge";
import { SignalBody } from "@/components/investing/SignalBody";
import {
  BuffettLensBlock,
  WouldBuyNowBadge,
  WouldBuyNowMark,
} from "@/components/investing/WouldBuyNowBadge";
import { SignalGuide } from "@/components/investing/SignalGuide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { parseBrokerFilter } from "@shared/brokerFilter";
import {
  BUFFETT_FILTERS,
  BUFFETT_FILTER_LABELS,
  matchesBuffettFilter,
  parseBuffettFilter,
  type BuffettFilter,
} from "@shared/buffettFilter";
import {
  BROKERS,
  BROKER_LABELS,
  MARKETS,
  SIGNAL_ACTIONS,
  formatNumber,
  brokerHex,
  marketHex,
  marketLabel,
  parseMarketFilter,
  sectorJa,
  type Broker,
  type Market,
  type SignalAction,
} from "@shared/investing";
import {
  AlertTriangle,
  ArrowUpDown,
  Brain,
  Coins,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useSearch } from "wouter";

/**
 * 並び替えの軸。長期保有が前提のため「前日比順」は置かない
 * （日々の変動は判断材料にならず、長期の損益や配当のほうが役に立つ）。
 */
type SortKey = "value" | "pnlPct" | "weight" | "name" | "dividend" | "dividendYield";

export default function Holdings() {
  const utils = trpc.useUtils();
  const overview = trpc.portfolio.overview.useQuery();
  /*
   * 相談の状況は overview に混ぜず別のクエリで引く。
   * overview は 112 銘柄の集計で重く、相談の印は無くても一覧は成立するため
   * 相談側の取得が遅れても一覧の表示を止めない。
   */
  const consultStats = trpc.consult.symbolStats.useQuery();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [signalFilter, setSignalFilter] = useState<"ALL" | SignalAction | "NONE">("ALL");
  /**
   * 口座フィルタは URL クエリ（?broker=moomoo_jp）でも指定できる。
   * ダッシュボードの「証券口座別の資産」カードから遷移してくるため。
   */
  const search = useSearch();
  const [, navigate] = useLocation();
  /*
   * バフェット式の判定での絞り込み。
   * ダッシュボードの内訳から /holdings?lens=PRICE_AHEAD で来られるようにする。
   * 112 行を上から見て「株価が中身より速い」銘柄を探すのは現実的でない。
   */
  const lensFromUrl = useMemo(() => parseBuffettFilter(search), [search]);
  const [lensFilterState, setLensFilter] = useState<BuffettFilter>("ALL");
  const lensFilter: BuffettFilter = lensFromUrl ?? lensFilterState;
  const brokerFromUrl = useMemo(() => parseBrokerFilter(search), [search]);
  const [brokerFilterState, setBrokerFilter] = useState<"ALL" | Broker>("ALL");
  // URL 指定があればそれを優先する（リンクで直接開いた場合に効かせるため）
  const brokerFilter: "ALL" | Broker = brokerFromUrl ?? brokerFilterState;
  /**
   * 市場フィルタ。口座フィルタと同じ仕組みで、URL 指定を優先する。
   * 両方を同時に指定できる（例: 楽天の米国株だけを見る）。
   */
  const marketFromUrl = useMemo(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return parseMarketFilter(params.get("market"));
  }, [search]);
  const [marketFilterState, setMarketFilter] = useState<"ALL" | Market>("ALL");
  const marketFilter: "ALL" | Market = marketFromUrl ?? marketFilterState;
  /*
   * 買い増しプラン一覧から ?symbol=NKE で開いた場合に、その銘柄だけを表示する。
   * 一覧から銘柄詳細へ直接飛ぶには保有 ID が必要だが、プランは銘柄単位で持つため
   * ID を持っていない。検索語として渡して絞り込む。
   */
  const symbolFromUrl = useMemo(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return params.get("symbol")?.trim() ?? null;
  }, [search]);
  const effectiveQuery = symbolFromUrl ?? query;
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [signalBusyId, setSignalBusyId] = useState<number | null>(null);

  const syncPrices = trpc.portfolio.syncPrices.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      toast.success(`${res.updated} 銘柄の株価を更新しました`);
    },
    onError: e => toast.error(e.message),
  });
  /*
   * 投資カードをまとめて下書きする。
   *
   * 残り件数を出すのは、一度で終わらないことを隠すと
   * 「押したのに増えない」と誤解されるため。
   */
  const draftCards = trpc.portfolio.draftMissingCards.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      if (res.created === 0 && res.processed === 0) {
        toast.info("下書きが必要な銘柄はありません");
      } else {
        toast.success(`${res.created} 銘柄の投資カードを下書きしました`, {
          description:
            res.remaining > 0
              ? `残り ${res.remaining} 銘柄。もう一度押すと続けて下書きします`
              : res.failed.length > 0
                ? `失敗: ${res.failed.join(", ")}`
                : "すべての銘柄に下書きが入りました",
        });
      }
    },
    onError: e => toast.error(e.message),
  });

  const regenSignal = trpc.portfolio.regenerateSignal.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      toast.success(`シグナル: ${res.action}`, {
        description: res.rationale ? res.rationale.slice(0, 120) : undefined,
        duration: 6000,
      });
    },
    onError: e =>
      toast.error("AI分析を実行できませんでした", { description: e.message, duration: 8000 }),
    onSettled: () => setSignalBusyId(null),
  });

  const removeHolding = trpc.portfolio.deleteHolding.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      toast.success("銘柄を削除しました");
      setDeleteTarget(null);
    },
    onError: e => toast.error(e.message),
  });

  const positions = overview.data?.positions ?? [];
  /**
   * 同一銘柄を複数口座で保有している場合は 1 行にまとめて合計を表示する。
   * 口座ごとの明細は entries に入っており、カード内の内訳として展開する。
   */
  const groups = overview.data?.groups ?? [];
  const summary = overview.data?.summary;

  /*
   * 銘柄ごとの相談状況を引きやすくする。配列のまま毎行探すと
   * 112 行 × 相談件数の走査になるため Map にしておく。
   */
  const consultBySymbol = useMemo(() => {
    const list = consultStats.data ?? [];
    const map = new Map<string, (typeof list)[number]>();
    for (const s of list) map.set(s.symbol, s);
    return map;
  }, [consultStats.data]);

  const rows = useMemo(() => {
    let list = groups;
    if (effectiveQuery.trim()) {
      const q = effectiveQuery.trim().toLowerCase();
      list = list.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          p.tickerCode.toLowerCase().includes(q) ||
          p.symbol.toLowerCase().includes(q)
      );
    }
    if (signalFilter !== "ALL") {
      list = list.filter(p =>
        signalFilter === "NONE" ? !p.signal : p.signal?.action === signalFilter
      );
    }
    if (brokerFilter !== "ALL") {
      // どの口座で保有していても、その口座を含む銘柄を残す
      list = list.filter(p => p.brokers.includes(brokerFilter));
    }
    if (marketFilter !== "ALL") {
      list = list.filter(p => p.market === marketFilter);
    }
    if (lensFilter !== "ALL") {
      list = list.filter(p =>
        matchesBuffettFilter(
          {
            wouldBuyNow: p.signal?.wouldBuyNow ?? null,
            priceVsValue: p.signal?.priceVsValue ?? null,
          },
          lensFilter
        )
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "pnlPct":
          return (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity);
        case "weight":
          return (b.weightPct ?? 0) - (a.weightPct ?? 0);
        case "name":
          return a.name.localeCompare(b.name, "ja");
        /*
         * 配当額は円換算で比べる（銘柄ごとに通貨が違うため、
         * 現地通貨のままだと SGD 5,586 と JPY 1,425,000 を正しく比較できない）。
         */
        case "dividend":
          return (b.dividend?.annualIncomeBase ?? 0) - (a.dividend?.annualIncomeBase ?? 0);
        case "dividendYield":
          return (b.dividend?.yieldPct ?? -Infinity) - (a.dividend?.yieldPct ?? -Infinity);
        default:
          return (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0);
      }
    });
    return sorted;
  }, [groups, effectiveQuery, signalFilter, brokerFilter, marketFilter, lensFilter, sortKey]);

  /** 実際に保有がある口座だけを絞り込みの選択肢にする */
  const usedBrokers = useMemo(() => {
    const set = new Set(positions.map(p => p.broker));
    return BROKERS.filter(b => set.has(b));
  }, [positions]);

  /** 実際に保有がある市場だけを絞り込みの選択肢にする */
  const usedMarkets = useMemo(() => {
    const set = new Set(positions.map(p => p.market));
    return MARKETS.filter(m => set.has(m));
  }, [positions]);

  /**
   * 口座で絞り込んでいるときは、その口座分だけの合計を出す。
   * 複数口座で持つ銘柄は合計値のままだと「絞り込んだのに数字が減らない」ことになり
   * 混乱するため、該当口座のレコードだけを足し合わせる。
   */
  /**
   * 絞り込み中は、その条件に該当する分だけの合計を出す。
   * 複数口座で持つ銘柄は合計値のままだと「絞り込んだのに数字が減らない」ことになり
   * 混乱するため、該当レコードだけを足し合わせる。
   */
  const filterSummary = useMemo(() => {
    if (brokerFilter === "ALL" && marketFilter === "ALL" && lensFilter === "ALL") return null;
    let mine = positions;
    if (brokerFilter !== "ALL") mine = mine.filter(p => p.broker === brokerFilter);
    if (marketFilter !== "ALL") mine = mine.filter(p => p.market === marketFilter);
    /*
     * 判定での絞り込みは銘柄単位で入っているため、
     * 残った銘柄に属するレコードだけを残す。
     * レコード単位で判定を見ると、同じ銘柄でも口座によって
     * signal が入っていない側が落ちてしまう。
     */
    if (lensFilter !== "ALL") {
      const symbols = new Set(rows.map(r => r.symbol));
      mine = mine.filter(p => symbols.has(p.symbol));
    }
    const value = mine.reduce((s, p) => s + (p.marketValueBase ?? 0), 0);
    const cost = mine.reduce((s, p) => s + p.costValueBase, 0);
    const pnl = value - cost;
    // 同一銘柄を複数口座で持つ場合を 1 銘柄として数える
    const symbols = new Set(mine.map(p => p.symbol));
    return {
      count: symbols.size,
      recordCount: mine.length,
      value,
      cost,
      pnl,
      pnlPct: cost > 0 ? (pnl / cost) * 100 : null,
    };
  }, [positions, brokerFilter, marketFilter, lensFilter, rows]);

  const editing = positions.find(p => p.id === editTarget) ?? null;

  if (overview.isLoading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">保有銘柄</h1>
          <p className="text-sm text-muted-foreground">
            {/**
             * 口座で絞り込んでいるときに全体の銘柄数を出すと
             * 「絞り込んだのに数字が変わらない」と誤解されるため、
             * 絞り込み中は表示中の件数に切り替える。
             */}
            {brokerFilter === "ALL" && marketFilter === "ALL" ? (
              <>
                {groups.length} 銘柄
                {/* 同一銘柄を複数口座で持つ場合、行数と銘柄数がずれるので明示する */}
                {positions.length !== groups.length ? `（${positions.length} 口座分）` : ""}
              </>
            ) : (
              `${rows.length} 銘柄を表示中（全 ${groups.length} 銘柄）`
            )}
            {summary?.lastPriceSyncAt
              ? ` ・ 株価最終更新 ${new Date(summary.lastPriceSyncAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={syncPrices.isPending || positions.length === 0}
            onClick={() => syncPrices.mutate()}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${syncPrices.isPending ? "animate-spin" : ""}`}
            />
            株価更新
          </Button>
          {/*
            投資カードをまとめて下書きする。
            1 銘柄ずつ開いて押すのは 112 銘柄では続かないため入口を用意する。
            一度に全件回すと 40 分以上かかるので評価額の大きい順に区切って進める。
          */}
          <Button
            variant="outline"
            size="sm"
            disabled={draftCards.isPending || positions.length === 0}
            onClick={() => draftCards.mutate({ limit: 10 })}
          >
            {draftCards.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            投資カードを下書き
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            銘柄を追加
          </Button>
        </div>
      </header>

      {/* シグナルの読み方。用語の説明がないと機能が伝わらないため一覧の手前に置く */}
      <SignalGuide />

      {/* 絞り込み中は、その条件に該当する分の合計をここに出す */}
      {filterSummary ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2.5">
              {brokerFilter !== "ALL" ? <BrokerBadge broker={brokerFilter} /> : null}
              {marketFilter !== "ALL" ? (
                <span
                  className="rounded-md border px-2 py-0.5 text-xs font-medium"
                  style={{
                    borderColor: `${marketHex(marketFilter)}55`,
                    color: marketHex(marketFilter),
                    background: `${marketHex(marketFilter)}14`,
                  }}
                >
                  {marketLabel(marketFilter)}
                </span>
              ) : null}
              {/* どの判定で絞り込んでいるかを明示する */}
              {lensFilter !== "ALL" ? (
                <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                  {BUFFETT_FILTER_LABELS[lensFilter]}
                </span>
              ) : null}
              <span className="text-sm text-muted-foreground">
                {filterSummary.count} 銘柄
                {filterSummary.recordCount !== filterSummary.count
                  ? `（${filterSummary.recordCount} 口座分）`
                  : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-muted-foreground">評価額</span>
                <MoneyText
                  value={filterSummary.value}
                  currency={summary?.baseCurrency}
                  className="text-base font-semibold"
                />
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-muted-foreground">評価損益</span>
                <PnlText
                  value={filterSummary.pnl}
                  currency={summary?.baseCurrency}
                  className="text-base font-semibold"
                />
                <PctText
                  value={filterSummary.pnlPct}
                  costValue={filterSummary.cost}
                  className="text-xs"
                />
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  // URL 指定で来た場合はクエリを外す必要がある
                  setBrokerFilter("ALL");
                  setMarketFilter("ALL");
                  setLensFilter("ALL");
                  if (brokerFromUrl || marketFromUrl || lensFromUrl) navigate("/holdings");
                }}
              >
                絞り込みを解除
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="銘柄名・コードで検索"
            className="h-9 pl-8"
          />
        </div>
        <Select value={signalFilter} onValueChange={v => setSignalFilter(v as typeof signalFilter)}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">すべてのシグナル</SelectItem>
            {SIGNAL_ACTIONS.map(a => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
            <SelectItem value="NONE">未生成</SelectItem>
          </SelectContent>
        </Select>
        {/*
          判定での絞り込み。シグナル（ADD/HOLD）とは別の軸なので独立させる。
          ADD は「今の保有をどうするか」、判定は「今から買うか」を見ている。
        */}
        <Select
          value={lensFilter}
          onValueChange={v => {
            const next = v as BuffettFilter;
            setLensFilter(next);
            // URL クエリで来ている場合は URL 側も合わせて書き換える
            if (lensFromUrl) navigate(next === "ALL" ? "/holdings" : `/holdings?lens=${next}`);
          }}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BUFFETT_FILTERS.map(f => (
              <SelectItem key={f} value={f}>
                {BUFFETT_FILTER_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {usedBrokers.length > 1 ? (
          <Select
            value={brokerFilter}
            onValueChange={v => {
              const next = v as "ALL" | Broker;
              setBrokerFilter(next);
              /**
               * URL クエリで来ている場合、state だけ変えても URL 優先のままになるので
               * URL 側も合わせて書き換える。
               */
              if (brokerFromUrl) navigate(next === "ALL" ? "/holdings" : `/holdings?broker=${next}`);
            }}
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
            onValueChange={v => {
              const next = v as "ALL" | Market;
              setMarketFilter(next);
              // URL クエリで来ている場合は URL 側も合わせて書き換える
              if (marketFromUrl) navigate(next === "ALL" ? "/holdings" : `/holdings?market=${next}`);
            }}
          >
            <SelectTrigger className="h-9 w-[140px]">
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
        <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-9 w-[160px]">
            <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="value">評価額順</SelectItem>
            <SelectItem value="pnlPct">損益率順</SelectItem>
            <SelectItem value="weight">構成比順</SelectItem>
            <SelectItem value="dividend">配当額順</SelectItem>
            <SelectItem value="dividendYield">配当利回り順</SelectItem>
            <SelectItem value="name">銘柄名順</SelectItem>
          </SelectContent>
        </Select>
        {/*
          表示通貨の切り替え。
          現地通貨のままだと ¥4530万 と $14.5万 が縦に並び大小を比較できないため、
          金額の通貨を揃えて見られるようにする。
        */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">金額表示</span>
          <CurrencyToggle />
        </div>
      </div>

      {positions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <p className="text-sm text-muted-foreground">
              保有銘柄がまだ登録されていません。スクリーンショットからの取込、または手入力で追加できます。
            </p>
            <div className="flex gap-2">
              <Link href="/import">
                <Button variant="outline">スクショから取込</Button>
              </Link>
              <Button onClick={() => setAddOpen(true)}>手入力で追加</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* スマホ: 1 銘柄 1 カード。横スクロールせずすべての数字が読める */}
          <div className="space-y-2.5 lg:hidden">
            {rows.map(p => (
              <Card key={`m-${p.symbol}`} className="overflow-hidden">
                <CardContent className="p-3.5">
                  {/* 上段: 銘柄名とシグナル */}
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/holdings/${p.entries[0].id}`}
                      className="min-w-0 flex-1 space-y-0.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{p.name}</span>
                        {p.hasCard ? <FileText className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                        {consultBySymbol.get(p.symbol) ? (
                          <span className="flex shrink-0 items-center gap-0.5 text-primary">
                            <MessageSquare className="h-3.5 w-3.5" />
                            <span className="tabular text-[10px] font-semibold">
                              {consultBySymbol.get(p.symbol)!.consultCount}
                            </span>
                          </span>
                        ) : null}
                        {p.negativeNewsCount > 0 ? (
                          <span className="flex shrink-0 items-center gap-0.5 text-loss">
                            <Newspaper className="h-3.5 w-3.5" />
                            <span className="tabular text-[10px] font-semibold">
                              {p.negativeNewsCount}
                            </span>
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="tabular">{p.tickerCode}</span>
                        <span>·</span>
                        <span>{marketLabel(p.market)}</span>
                        {p.sector ? (
                          <>
                            <span>·</span>
                            <span className="truncate">{sectorJa(p.sector)}</span>
                          </>
                        ) : null}
                      </div>
                    </Link>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {p.signal ? <SignalBadge action={p.signal.action} /> : <SignalPlaceholder />}
                      {/*
                        「今から買うか」はシグナルとは別の問い。
                        大きく育った株は「今からは買わないが売る理由もない」ことがあり、
                        ADD/HOLD だけでは区別できないため併記する。
                      */}
                      <WouldBuyNowBadge value={p.signal?.wouldBuyNow ?? null} />
                      {/* 複数口座にまたがる場合はすべてのバッジを並べる */}
                      <div className="flex flex-wrap justify-end gap-1">
                        {p.brokers.map(b => (
                          <BrokerBadge key={b} broker={b} short />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 中段: 評価額と損益を大きく */}
                  <div className="mt-3 flex items-end justify-between gap-3 border-t pt-2.5">
                    <div className="space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">評価額</p>
                      <MoneyText
                        value={p.marketValue}
                        currency={p.currency}
                        baseValue={p.marketValueBase}
                        className="text-base font-semibold"
                      />
                    </div>
                    <div className="space-y-0.5 text-right">
                      <p className="text-[11px] text-muted-foreground">評価損益</p>
                      <PnlText
                        value={p.pnl}
                        currency={p.currency}
                        baseValue={p.pnlBase}
                        /*
                          スマホは幅が狭く、金額・現地通貨の併記・率の 3 つを並べると折り返す。
                          現地通貨は左隣の評価額に出ているので、ここでは省く。
                        */
                        hideLocalHint
                        className="text-base font-semibold"
                      />
                      <div className="text-xs">
                        <PctText value={p.pnlPct} costValue={p.costValue} />
                      </div>
                    </div>
                  </div>

                  {/* 下段: 明細 */}
                  <div className="mt-2.5 grid grid-cols-4 gap-2 border-t pt-2.5 text-center">
                    <div>
                      <p className="text-[10px] text-muted-foreground">株数</p>
                      <p className="tabular text-xs font-medium">{formatNumber(p.quantity, 0)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        {p.isSplit ? "平均取得" : "取得単価"}
                      </p>
                      <MoneyText
                        value={p.avgCost}
                        currency={p.currency}
                        className="block text-xs font-medium"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">現在値</p>
                      <MoneyText
                        value={p.currentPrice}
                        currency={p.currency}
                        className="block text-xs font-medium"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">構成比</p>
                      <p className="tabular text-xs font-medium">
                        {p.weightPct !== null ? `${p.weightPct.toFixed(1)}%` : "—"}
                      </p>
                    </div>
                  </div>

                  {/*
                    配当。長期保有では実質的な収入なので、年間受取額と
                    「買った値段に対する利回り」を出す。後者は保有が長いほど
                    高くなるため、長期保有の実感に近い。
                  */}
                  {p.dividend && p.dividend.annualIncome > 0 ? (
                    <div className="mt-2.5 border-t pt-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Coins className="h-3 w-3" />
                          年間配当
                        </span>
                        <span className="flex items-baseline gap-2">
                          <MoneyText
                            value={p.dividend.annualIncome}
                            currency={p.currency}
                            baseValue={p.dividend.annualIncomeBase}
                            className="text-xs font-semibold text-gain"
                            hideLocalHint
                          />
                          <span className="tabular text-[11px] text-muted-foreground">
                            {p.dividend.yieldPct !== null
                              ? `利回り ${p.dividend.yieldPct.toFixed(2)}%`
                              : ""}
                          </span>
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="text-muted-foreground">買った値段に対する利回り</span>
                        <span className="tabular font-medium text-gain">
                          {p.dividend.yieldOnCostPct !== null
                            ? `${p.dividend.yieldOnCostPct.toFixed(2)}%`
                            : "—"}
                        </span>
                      </div>
                      {/*
                        一時的な配当や異常な利回りは「来年も同じ」と誤解しやすいので
                        その場で理由を書く。
                      */}
                      {p.dividend.yieldNeedsCheck ? (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                          利回りが高すぎます。特別配当（記念配当）が含まれている可能性があるため、
                          来期も同額とは限りません
                        </p>
                      ) : p.dividend.hasSpecial ? (
                        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                          一時的な配当を含みます。それを除くと利回り{" "}
                          {p.dividend.recurringYieldPct !== null
                            ? `${p.dividend.recurringYieldPct.toFixed(2)}%`
                            : "—"}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* 複数口座で保有している場合の内訳 */}
                  {/*
                    ADD と判定された銘柄には「いくら買い増すか」を出す。
                    ADD だけでは何をすればよいか決まらないため、金額と株数を
                    そのまま発注に使える形で添える。
                  */}
                  {p.addPlan ? (
                    <AddAmountLine
                      plan={p.addPlan}
                      currency={p.currency}
                      market={p.market}
                      currentSharePct={p.weightPct}
                    />
                  ) : null}

                  {/*
                    判定の本文をカードに常設する。

                    これまで本文はトースト（120 字で切られ数秒で消える）と
                    表のツールチップ（スマホでは長押しが要る）にしか出ておらず、
                    後から読み返せなかった。ADD というバッジだけでは
                    「なぜ今買うのか」が分からず判断材料にならない。

                    いつの判定かを併記するのは、月 1 回しか開かない使い方では
                    古い判定を今の判断に使ってしまう恐れがあるため。
                  */}
                  {p.signal ? <SignalBody signal={p.signal} /> : null}

                  <BrokerBreakdown
                    /*
                      内訳も表示通貨に追随させる。円換算の損益は
                      「円換算の評価額 − 円換算の取得原価」で求める（取得時と現在で
                      レートが違うため、現地通貨の損益に今のレートを掛けると誤る）。
                    */
                    entries={p.entries.map(e => ({
                      ...e,
                      pnlBase:
                        e.marketValueBase === null ? null : e.marketValueBase - e.costValueBase,
                    }))}
                    onEdit={id => setEditTarget(id)}
                    onDelete={id => {
                      const target = p.entries.find(e => e.id === id);
                      if (target) setDeleteTarget({ id, name: p.name });
                    }}
                  />

                  {/* 操作 */}
                  <div className="mt-2 flex items-center justify-end gap-1 border-t pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      disabled={signalBusyId !== null}
                      onClick={() => {
                        // シグナルは銘柄単位。どの口座の行で呼んでも同じ結果になる
                        setSignalBusyId(p.entries[0].id);
                        regenSignal.mutate({ id: p.entries[0].id });
                      }}
                    >
                      <Brain
                        className={`mr-1 h-3.5 w-3.5 ${
                          signalBusyId === p.entries[0].id ? "animate-spin" : ""
                        }`}
                      />
                      {signalBusyId === p.entries[0].id ? "分析中…" : "AI分析"}
                    </Button>
                    {/* 複数口座の場合は内訳側に編集・削除を出すため、ここでは 1 口座のときだけ表示 */}
                    {!p.isSplit ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => setEditTarget(p.entries[0].id)}
                        >
                          <FileText className="mr-1 h-3.5 w-3.5" />
                          編集
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget({ id: p.entries[0].id, name: p.name })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
            {rows.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  条件に一致する銘柄がありません
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* デスクトップ: 一覧性の高い表 */}
          <Card className="hidden overflow-hidden lg:block">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-[220px]">銘柄</TableHead>
                    <TableHead className="min-w-[110px]">口座</TableHead>
                    <TableHead className="text-right">株数</TableHead>
                  <TableHead className="text-right">取得単価</TableHead>
                    <TableHead className="text-right">現在値</TableHead>
                  <TableHead className="text-right">評価額</TableHead>
                  <TableHead className="min-w-[130px] text-right">評価損益</TableHead>
                  <TableHead className="min-w-[120px] text-right">年間配当</TableHead>
                  <TableHead className="text-right">構成比</TableHead>
                  <TableHead className="min-w-[110px]">AIシグナル</TableHead>
                  <TableHead className="w-[120px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(p => (
                  <Fragment key={p.symbol}>
                  {/*
                    複数口座の銘柄は「合計行 + 内訳行」のまとまりになる。
                    まとまりの境目が分かるよう、合計行の上に太めの区切り線を置き、
                    合計行自体は白背景のまま（内訳だけ色を敷く）にして主従を示す。
                  */}
                  <TableRow
                    className={`group ${
                      p.isSplit ? "border-b-0 border-t-2 border-t-border/70" : ""
                    }`}
                  >
                    <TableCell className={p.isSplit ? "font-medium" : undefined}>
                      <Link href={`/holdings/${p.entries[0].id}`} className="block space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium hover:underline">{p.name}</span>
                          {p.hasCard ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <FileText className="h-3.5 w-3.5 text-primary" />
                              </TooltipTrigger>
                              <TooltipContent>投資カード記入済み</TooltipContent>
                            </Tooltip>
                          ) : null}
                          {/*
                            過去に相談した銘柄が分かるようにする。相談画面を開かないと
                            分からない状態だと「前に検討した」ことに気付けない。
                          */}
                          {consultBySymbol.get(p.symbol) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-0.5 text-primary">
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  <span className="tabular text-[10px] font-semibold">
                                    {consultBySymbol.get(p.symbol)!.consultCount}
                                  </span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                AI に相談済み {consultBySymbol.get(p.symbol)!.consultCount} 件（最終{" "}
                                {new Date(
                                  consultBySymbol.get(p.symbol)!.lastConsultedAt
                                ).toLocaleDateString()}
                                ）
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                          {p.negativeNewsCount > 0 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-0.5 text-loss">
                                  <Newspaper className="h-3.5 w-3.5" />
                                  <span className="tabular text-[10px] font-semibold">
                                    {p.negativeNewsCount}
                                  </span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                影響度の高いネガティブニュース {p.negativeNewsCount} 件
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="tabular">{p.tickerCode}</span>
                          <span>·</span>
                          <span>{marketLabel(p.market)}</span>
                          {p.sector ? (
                            <>
                              <span>·</span>
                              <span className="truncate">{sectorJa(p.sector)}</span>
                            </>
                          ) : null}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>
                      {/* 複数口座にまたがる場合はすべての口座を表示し、株数の内訳も添える */}
                      <div className="space-y-1">
                        <div className="flex flex-wrap gap-1">
                          {p.brokers.map(b => (
                            <BrokerBadge key={b} broker={b} />
                          ))}
                        </div>
                        {p.isSplit ? (
                          <p className="text-[10px] text-muted-foreground">
                            {p.entries.length} 口座の合計
                          </p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatNumber(p.quantity, 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-0.5">
                        <MoneyText value={p.avgCost} currency={p.currency} />
                        {p.isSplit ? (
                          <p className="text-[10px] text-muted-foreground">加重平均</p>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText value={p.currentPrice} currency={p.currency} />
                    </TableCell>
                    <TableCell className="text-right">
                      {/* 評価額は表示通貨に合わせる。並び順の基準（円換算）と表示を一致させるため */}
                      <MoneyText
                        value={p.marketValue}
                        currency={p.currency}
                        baseValue={p.marketValueBase}
                        compact
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-0.5">
                        <PnlText
                          value={p.pnl}
                          currency={p.currency}
                          baseValue={p.pnlBase}
                          compact
                          /*
                            損益は「金額 + 率」で既に 2 段になっている。
                            ここに現地通貨を併記すると 3 つの数字が並んで読みにくいため省く。
                            現地通貨は隣の評価額列に出ているので情報は失われない。
                          */
                          hideLocalHint
                          className="text-sm"
                        />
                        <div className="text-xs">
                          <PctText value={p.pnlPct} costValue={p.costValue} />
                        </div>
                      </div>
                    </TableCell>
                    {/*
                      配当。年間受取額と現在値ベースの利回りを並べる。
                      無配や未取得は「—」で区別せず空欄にせず、意味が伝わる表記にする。
                    */}
                    <TableCell className="text-right">
                      {p.dividend && p.dividend.annualIncome > 0 ? (
                        <div className="space-y-0.5">
                          <MoneyText
                            value={p.dividend.annualIncome}
                            currency={p.currency}
                            baseValue={p.dividend.annualIncomeBase}
                            compact
                            className="text-sm font-medium text-gain"
                            hideLocalHint
                          />
                          <div className="flex items-center justify-end gap-1">
                            <span className="tabular text-xs text-muted-foreground">
                              {p.dividend.yieldPct !== null
                                ? `${p.dividend.yieldPct.toFixed(2)}%`
                                : "—"}
                            </span>
                            {p.dividend.yieldNeedsCheck || p.dividend.hasSpecial ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className="h-3 w-3 cursor-help text-amber-500" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  <p className="text-xs leading-relaxed">
                                    {p.dividend.yieldNeedsCheck
                                      ? "利回りが高すぎます。特別配当（記念配当）が含まれている可能性があり、来期も同額とは限りません。"
                                      : `一時的な配当を含みます。それを除くと利回り ${
                                          p.dividend.recurringYieldPct !== null
                                            ? `${p.dividend.recurringYieldPct.toFixed(2)}%`
                                            : "—"
                                        } です。`}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {p.dividend ? "無配" : "未取得"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right text-sm text-muted-foreground">
                      {p.weightPct !== null ? `${p.weightPct.toFixed(1)}%` : "—"}
                    </TableCell>
                    <TableCell>
                      {p.signal ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="cursor-help">
                              <SignalBadge action={p.signal.action} />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <p className="text-xs leading-relaxed">{p.signal.rationale}</p>
                            <BuffettLensBlock
                              wouldBuyNow={p.signal.wouldBuyNow}
                              wouldBuyNowReason={p.signal.wouldBuyNowReason}
                              priceVsValue={p.signal.priceVsValue}
                              priceVsValueReason={p.signal.priceVsValueReason}
                            />
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              確信度 {p.signal.confidence ?? "—"} ・{" "}
                              {new Date(p.signal.createdAt).toLocaleString("ja-JP")}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SignalPlaceholder />
                      )}
                      {/*
                        「今からは買わない」は 8 文字あり、そのまま並べると
                        列が広がって横スクロールが出る（横スクロールは使えない）。
                        表では 2 文字の短い印にし、理由はツールチップと
                        カード表示・銘柄詳細で読む形にする。
                      */}
                      <WouldBuyNowMark value={p.signal?.wouldBuyNow ?? null} />
                      {/*
                        表では縦幅を増やせないので金額と株数だけを 1 行で添える。
                        構成比の変化はカード表示側で出す。
                      */}
                      {p.addPlan && !p.addPlan.atCap && p.addPlan.shares ? (
                        <p className="tabular mt-0.5 text-[10px] leading-tight text-emerald-700 dark:text-emerald-400">
                          {p.addPlan.shares.toLocaleString("ja-JP")} 株
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={signalBusyId !== null}
                              onClick={() => {
                                // シグナルは銘柄単位なので先頭の口座の ID で呼ぶ
                                setSignalBusyId(p.entries[0].id);
                                regenSignal.mutate({ id: p.entries[0].id });
                              }}
                            >
                              <Brain
                                className={`h-3.5 w-3.5 ${
                                  signalBusyId === p.entries[0].id ? "animate-spin" : ""
                                }`}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {signalBusyId === p.entries[0].id ? "分析中…" : "AI分析でシグナルを生成"}
                          </TooltipContent>
                        </Tooltip>
                        {/* 複数口座の銘柄はどの口座を編集するか選ぶ必要があるため個別に並べる */}
                        {/* 複数口座の場合は内訳行に編集・削除を出すので、ここでは 1 口座のときだけ */}
                        {(p.isSplit ? [] : p.entries).map(e => (
                          <Tooltip key={`edit-${e.id}`}>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setEditTarget(e.id)}
                              >
                                <FileText className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {p.isSplit
                                ? `${BROKER_LABELS[e.broker]}の株数・取得単価を編集`
                                : "株数・取得単価を編集"}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                        {(p.isSplit ? [] : p.entries).map(e => (
                          <Tooltip key={`del-${e.id}`}>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTarget({ id: e.id, name: p.name })}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {p.isSplit ? `${BROKER_LABELS[e.broker]}の保有を削除` : "削除"}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                  {/**
                   * 複数口座で保有している銘柄は、口座ごとの明細を合計行の直下に
                   * そのまま並べる。以前はツールチップだったが、マウスを乗せないと
                   * 見えずスマホでは開けないため常時表示にした。
                   */}
                  {p.isSplit
                    ? p.entries.map((e, i) => (
                        <TableRow
                          key={`sub-${e.id}`}
                          className={`bg-muted/40 hover:bg-muted/60 ${
                            i === p.entries.length - 1 ? "" : "border-b-0"
                          }`}
                          data-testid="desktop-breakdown-row"
                        >
                          {/*
                            内訳行の左端に口座の色を縦線で出す。バッジだけだと
                            行が続いたときに「どの口座の行か」を追いにくいため、
                            行そのものに色の帯を持たせて視線で追えるようにする。
                          */}
                          <TableCell className="relative py-1.5">
                            <span
                              aria-hidden
                              className="absolute inset-y-0 left-0 w-1"
                              style={{ backgroundColor: brokerHex(e.broker) }}
                            />
                            <span className="pl-5 text-xs text-muted-foreground">
                              {i === p.entries.length - 1 ? "└" : "├"} 内訳
                            </span>
                          </TableCell>
                          <TableCell className="py-1.5">
                            <BrokerBadge broker={e.broker} />
                          </TableCell>
                          <TableCell className="tabular py-1.5 text-right text-xs">
                            {formatNumber(e.quantity, 0)}
                          </TableCell>
                          <TableCell className="py-1.5 text-right text-xs">
                            <MoneyText value={e.avgCost} currency={e.currency} />
                          </TableCell>
                          {/* 現在値は口座によらず同じなので繰り返さない */}
                          <TableCell className="py-1.5" />
                          <TableCell className="py-1.5 text-right text-xs">
                            <MoneyText
                              value={e.marketValue}
                              currency={e.currency}
                              baseValue={e.marketValueBase}
                              compact
                              hideLocalHint
                            />
                          </TableCell>
                          <TableCell className="py-1.5 text-right">
                            <div className="space-y-0.5">
                              <PnlText
                                value={e.pnl}
                                currency={e.currency}
                                baseValue={
                                  e.marketValueBase === null
                                    ? null
                                    : e.marketValueBase - e.costValueBase
                                }
                                compact
                                hideLocalHint
                                className="text-xs"
                              />
                              <div className="text-[10px]">
                                <PctText value={e.pnlPct} costValue={e.costValue} />
                              </div>
                            </div>
                          </TableCell>
                          {/* 口座ごとの年間配当。株数が違えば受取額も変わる */}
                          <TableCell className="py-1.5 text-right">
                            {e.dividend && e.dividend.annualIncome > 0 ? (
                              <MoneyText
                                value={e.dividend.annualIncome}
                                currency={e.currency}
                                baseValue={e.dividend.annualIncomeBase}
                                compact
                                className="text-xs text-gain"
                                hideLocalHint
                              />
                            ) : null}
                          </TableCell>
                          <TableCell className="py-1.5" />
                          <TableCell className="py-1.5" />
                          <TableCell className="py-1.5">
                            <div className="flex items-center justify-end gap-0.5">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditTarget(e.id)}
                              >
                                編集
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTarget({ id: e.id, name: p.name })}
                              >
                                削除
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    : null}
                  </Fragment>
                ))}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                      条件に一致する銘柄がありません
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>
        </>
      )}

      <DisclaimerNote />

      <AddHoldingDialog open={addOpen} onOpenChange={setAddOpen} />

      {/* 編集ダイアログ */}
      <Dialog open={editTarget !== null} onOpenChange={o => !o && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          {editing ? (
            <EditHoldingForm
              holding={editing}
              onDone={() => {
                setEditTarget(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 削除確認 */}
      <Dialog open={deleteTarget !== null} onOpenChange={o => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>この銘柄を削除しますか</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name} を保有一覧から削除します。この操作は取り消せません。投資カードとニュース履歴は残ります。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={removeHolding.isPending}
              onClick={() => deleteTarget && removeHolding.mutate({ id: deleteTarget.id })}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------ 追加ダイアログ ----------------------------- */

function AddHoldingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [code, setCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [broker, setBroker] = useState<Broker>("moomoo_jp");
  const [notes, setNotes] = useState("");

  const lookup = trpc.portfolio.lookup.useMutation({
    onError: e => toast.error(e.message),
  });

  const add = trpc.portfolio.addHolding.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      toast.success("銘柄を追加しました");
      reset();
      onOpenChange(false);
    },
    onError: e => toast.error(e.message),
  });

  const reset = () => {
    setCode("");
    setQuantity("");
    setAvgCost("");
    setNotes("");
    lookup.reset();
  };

  const preview = lookup.data;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>銘柄を追加</DialogTitle>
          <DialogDescription>
            日本株は 4 桁の証券コード（例: 7270）、米国株はティッカー（例: AAPL）を入力してください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-code">銘柄コード</Label>
            <div className="flex gap-2">
              <Input
                id="add-code"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="7270 / AAPL"
                onKeyDown={e => {
                  if (e.key === "Enter" && code.trim()) {
                    e.preventDefault();
                    lookup.mutate({ code: code.trim() });
                  }
                }}
              />
              <Button
                variant="outline"
                disabled={!code.trim() || lookup.isPending}
                onClick={() => lookup.mutate({ code: code.trim() })}
              >
                {lookup.isPending ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {preview ? (
            <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{preview.name}</span>
                <Badge variant="secondary" className="tabular">
                  {preview.symbol}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  現在値{" "}
                  <MoneyText value={preview.price} currency={preview.currency} className="text-foreground" />
                </span>
                {preview.sector ? <span>{sectorJa(preview.sector)}</span> : null}
                {preview.exchangeName ? <span>{preview.exchangeName}</span> : null}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="add-qty">保有株数</Label>
              <Input
                id="add-qty"
                type="number"
                inputMode="decimal"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-cost">取得単価</Label>
              <Input
                id="add-cost"
                type="number"
                inputMode="decimal"
                value={avgCost}
                onChange={e => setAvgCost(e.target.value)}
                placeholder="3390"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-notes">メモ（任意）</Label>
            <Textarea
              id="add-notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="買付時の状況など"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-broker">保有している証券口座</Label>
            <Select value={broker} onValueChange={v => setBroker(v as Broker)}>
              <SelectTrigger id="add-broker">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BROKERS.map(b => (
                  <SelectItem key={b} value={b}>
                    {BROKER_LABELS[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            disabled={
              add.isPending ||
              !code.trim() ||
              !quantity ||
              Number(quantity) <= 0 ||
              avgCost === "" ||
              Number(avgCost) < 0
            }
            onClick={() =>
              add.mutate({
                code: code.trim(),
                name: preview?.name,
                quantity: Number(quantity),
                avgCost: Number(avgCost),
                broker,
                notes: notes || undefined,
              })
            }
          >
            {add.isPending ? "追加中..." : "追加する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ 編集フォーム ------------------------------ */

function EditHoldingForm({
  holding,
  onDone,
}: {
  holding: {
    id: number;
    name: string;
    quantity: number;
    avgCost: number;
    currency: string;
    symbol: string;
    broker: Broker;
  };
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(holding.name);
  const [quantity, setQuantity] = useState(String(holding.quantity));
  const [avgCost, setAvgCost] = useState(String(holding.avgCost));
  const [broker, setBroker] = useState<Broker>(holding.broker);

  const update = trpc.portfolio.updateHolding.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      toast.success("保有情報を更新しました");
      onDone();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>保有情報の編集</DialogTitle>
        <DialogDescription className="tabular">{holding.symbol}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="edit-name">表示名</Label>
          <Input id="edit-name" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="edit-qty">保有株数</Label>
            <Input
              id="edit-qty"
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-cost">取得単価（{holding.currency}）</Label>
            <Input
              id="edit-cost"
              type="number"
              inputMode="decimal"
              value={avgCost}
              onChange={e => setAvgCost(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-broker">保有している証券口座</Label>
          <Select value={broker} onValueChange={v => setBroker(v as Broker)}>
            <SelectTrigger id="edit-broker">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BROKERS.map(b => (
                <SelectItem key={b} value={b}>
                  {BROKER_LABELS[b]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          キャンセル
        </Button>
        <Button
          disabled={update.isPending || !name.trim() || Number(quantity) <= 0}
          onClick={() =>
            update.mutate({
              id: holding.id,
              name: name.trim(),
              quantity: Number(quantity),
              avgCost: Number(avgCost),
              broker,
            })
          }
        >
          保存
        </Button>
      </DialogFooter>
    </>
  );
}
