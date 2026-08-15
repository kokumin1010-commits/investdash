import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import { BrokerBadge } from "@/components/investing/BrokerBadge";
import { BrokerBreakdown } from "@/components/investing/BrokerBreakdown";
import { MoneyText, PctText, PnlText } from "@/components/investing/Figures";
import { SignalBadge, SignalPlaceholder } from "@/components/investing/SignalBadge";
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
import {
  BROKERS,
  BROKER_LABELS,
  SIGNAL_ACTIONS,
  formatNumber,
  marketLabel,
  sectorJa,
  type Broker,
  type SignalAction,
} from "@shared/investing";
import {
  ArrowUpDown,
  Brain,
  ExternalLink,
  FileText,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type SortKey = "value" | "pnlPct" | "weight" | "name" | "day";

export default function Holdings() {
  const utils = trpc.useUtils();
  const overview = trpc.portfolio.overview.useQuery();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [signalFilter, setSignalFilter] = useState<"ALL" | SignalAction | "NONE">("ALL");
  const [brokerFilter, setBrokerFilter] = useState<"ALL" | Broker>("ALL");
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

  const rows = useMemo(() => {
    let list = groups;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
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
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "pnlPct":
          return (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity);
        case "weight":
          return (b.weightPct ?? 0) - (a.weightPct ?? 0);
        case "day":
          return (b.dayChangePct ?? -Infinity) - (a.dayChangePct ?? -Infinity);
        case "name":
          return a.name.localeCompare(b.name, "ja");
        default:
          return (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0);
      }
    });
    return sorted;
  }, [groups, query, signalFilter, brokerFilter, sortKey]);

  /** 実際に保有がある口座だけを絞り込みの選択肢にする */
  const usedBrokers = useMemo(() => {
    const set = new Set(positions.map(p => p.broker));
    return BROKERS.filter(b => set.has(b));
  }, [positions]);

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
            {groups.length} 銘柄
            {/* 同一銘柄を複数口座で持つ場合、行数と銘柄数がずれるので明示する */}
            {positions.length !== groups.length ? `（${positions.length} 口座分）` : ""}
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
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            銘柄を追加
          </Button>
        </div>
      </header>

      {/* シグナルの読み方。用語の説明がないと機能が伝わらないため一覧の手前に置く */}
      <SignalGuide />

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
        {usedBrokers.length > 1 ? (
          <Select value={brokerFilter} onValueChange={v => setBrokerFilter(v as typeof brokerFilter)}>
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
        <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
          <SelectTrigger className="h-9 w-[160px]">
            <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="value">評価額順</SelectItem>
            <SelectItem value="pnlPct">損益率順</SelectItem>
            <SelectItem value="weight">構成比順</SelectItem>
            <SelectItem value="day">前日比順</SelectItem>
            <SelectItem value="name">銘柄名順</SelectItem>
          </SelectContent>
        </Select>
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
                        className="text-base font-semibold"
                      />
                    </div>
                    <div className="space-y-0.5 text-right">
                      <p className="text-[11px] text-muted-foreground">評価損益</p>
                      <PnlText
                        value={p.pnl}
                        currency={p.currency}
                        className="text-base font-semibold"
                      />
                      <div className="text-xs">
                        <PctText value={p.pnlPct} />
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

                  {/* 複数口座で保有している場合の内訳 */}
                  <BrokerBreakdown
                    entries={p.entries}
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
                  <TableHead className="text-right">前日比</TableHead>
                  <TableHead className="text-right">評価額</TableHead>
                  <TableHead className="text-right">評価損益</TableHead>
                  <TableHead className="text-right">構成比</TableHead>
                  <TableHead className="min-w-[110px]">AIシグナル</TableHead>
                  <TableHead className="w-[120px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(p => (
                  <TableRow key={p.symbol} className="group">
                    <TableCell>
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="cursor-help text-[10px] text-muted-foreground">
                                {p.entries.length} 口座の合計
                              </p>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="space-y-1 text-xs">
                                {p.entries.map(e => (
                                  <div key={e.id} className="flex items-center gap-2">
                                    <span>{BROKER_LABELS[e.broker]}</span>
                                    <span className="tabular">
                                      {formatNumber(e.quantity, 0)}株 @{" "}
                                      {formatNumber(e.avgCost, 2)}
                                    </span>
                                    <PctText value={e.pnlPct} />
                                  </div>
                                ))}
                              </div>
                            </TooltipContent>
                          </Tooltip>
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
                      <PctText value={p.dayChangePct} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MoneyText value={p.marketValue} currency={p.currency} compact />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="space-y-0.5">
                        <PnlText value={p.pnl} currency={p.currency} compact className="text-sm" />
                        <div className="text-xs">
                          <PctText value={p.pnlPct} />
                        </div>
                      </div>
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
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              確信度 {p.signal.confidence ?? "—"} ・{" "}
                              {new Date(p.signal.createdAt).toLocaleString("ja-JP")}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <SignalPlaceholder />
                      )}
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
                        {p.entries.map(e => (
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
                        {p.entries.map(e => (
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
