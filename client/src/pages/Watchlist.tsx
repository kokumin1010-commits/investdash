import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import { MoneyText, PctText } from "@/components/investing/Figures";
import { SignalBadge, SignalPlaceholder } from "@/components/investing/SignalBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import {
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  WATCH_PRIORITIES,
  formatMoney,
  marketLabel,
  sectorJa,
  type WatchPriority,
  type Market,
} from "@shared/investing";
import {
  Brain,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Target,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type WatchRow = {
  id: number;
  symbol: string;
  tickerCode: string;
  name: string;
  market: Market;
  currency: string;
  priority: WatchPriority;
  sector: string | null;
  buyConditions: string | null;
  watchReason: string | null;
  plannedAmount: string | null;
  targetPrice: string | null;
  priceNum: number | null;
  targetNum: number | null;
  gapPct: number | null;
  reachedTarget: boolean;
  dayChangePct: number | null;
  newsCount: number;
  signal: { action: "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT"; confidence: number | null; rationale: string; createdAt: Date } | null;
};

export default function Watchlist() {
  const utils = trpc.useUtils();
  const list = trpc.watchlist.list.useQuery();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WatchRow | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<WatchRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WatchRow | null>(null);
  const [signalBusyId, setSignalBusyId] = useState<number | null>(null);

  const syncPrices = trpc.portfolio.syncPrices.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      toast.success("株価を更新しました");
    },
    onError: e => toast.error(e.message),
  });

  const regenSignal = trpc.watchlist.regenerateSignal.useMutation({
    onSuccess: async res => {
      await utils.watchlist.invalidate();
      toast.success(`シグナルを生成しました: ${res.action}`);
    },
    onError: e => toast.error(e.message),
    onSettled: () => setSignalBusyId(null),
  });

  const remove = trpc.watchlist.remove.useMutation({
    onSuccess: async () => {
      await utils.watchlist.invalidate();
      toast.success("ウォッチリストから削除しました");
      setDeleteTarget(null);
    },
    onError: e => toast.error(e.message),
  });

  const rows = (list.data ?? []) as unknown as WatchRow[];
  const reached = rows.filter(r => r.reachedTarget);

  if (list.isLoading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">ウォッチリスト</h1>
          <p className="text-sm text-muted-foreground">
            購入検討中の銘柄 {rows.length} 件
            {reached.length > 0 ? ` ・ 目標価格到達 ${reached.length} 件` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={syncPrices.isPending || rows.length === 0}
            onClick={() => syncPrices.mutate()}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncPrices.isPending ? "animate-spin" : ""}`} />
            株価更新
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            銘柄を追加
          </Button>
        </div>
      </header>

      {reached.length > 0 ? (
        <Card className="border-gain/40 bg-gain-soft">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-gain" />
              目標価格に到達した銘柄
            </CardTitle>
            <CardDescription className="text-xs">
              設定した目標買付価格を下回っています。買付条件を再確認してください。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {reached.map(r => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-card/60 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-gain" />
                  <span className="font-medium">{r.name}</span>
                  <span className="tabular text-xs text-muted-foreground">{r.tickerCode}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="tabular">
                    現在 {formatMoney(r.priceNum, r.currency)} / 目標{" "}
                    {formatMoney(r.targetNum, r.currency)}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => setPromoteTarget(r)}>
                    保有に登録
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
              <Eye className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-1.5">
              <h2 className="font-semibold">購入を検討している銘柄を登録しましょう</h2>
              <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                目標買付価格と買付条件を記録しておくと、条件に近づいたときに気づけます。ニュースも自動で追跡されます。
              </p>
            </div>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              銘柄を追加
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(r => (
            <Card key={r.id} className={r.reachedTarget ? "border-gain/40" : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <CardTitle className="truncate text-base">{r.name}</CardTitle>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
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
                  </div>
                  <Badge variant="outline" className={`shrink-0 text-[11px] ${PRIORITY_STYLES[r.priority]}`}>
                    優先度 {PRIORITY_LABELS[r.priority]}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 px-3 py-2.5">
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">現在値</p>
                    <MoneyText value={r.priceNum} currency={r.currency} className="text-sm font-medium" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">目標価格</p>
                    <MoneyText value={r.targetNum} currency={r.currency} className="text-sm font-medium" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">目標との差</p>
                    {r.gapPct === null ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={`tabular text-sm font-medium ${r.gapPct <= 0 ? "text-gain" : "text-muted-foreground"}`}
                      >
                        {r.gapPct > 0 ? "+" : ""}
                        {r.gapPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>

                {r.watchReason ? (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">注目理由</p>
                    <p className="line-clamp-2 text-xs leading-relaxed">{r.watchReason}</p>
                  </div>
                ) : null}

                {r.buyConditions ? (
                  <div className="space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">買付条件</p>
                    <p className="line-clamp-2 text-xs leading-relaxed">{r.buyConditions}</p>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <div className="flex items-center gap-2">
                    {r.signal ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help">
                            <SignalBadge action={r.signal.action} />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="text-xs leading-relaxed">{r.signal.rationale}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <SignalPlaceholder />
                    )}
                    {r.newsCount > 0 ? (
                      <span className="tabular text-[11px] text-muted-foreground">
                        ニュース {r.newsCount}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={signalBusyId !== null}
                          onClick={() => {
                            setSignalBusyId(r.id);
                            regenSignal.mutate({ id: r.id });
                          }}
                        >
                          <Brain className={`h-3.5 w-3.5 ${signalBusyId === r.id ? "animate-pulse" : ""}`} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>AI 分析</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setPromoteTarget(r)}
                        >
                          <TrendingDown className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>買付済みとして保有に登録</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditTarget(r)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>編集</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(r)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>削除</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <DisclaimerNote />

      <WatchFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <WatchFormDialog
        open={editTarget !== null}
        onOpenChange={o => !o && setEditTarget(null)}
        editing={editTarget}
      />
      <PromoteDialog target={promoteTarget} onClose={() => setPromoteTarget(null)} />

      <Dialog open={deleteTarget !== null} onOpenChange={o => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>ウォッチリストから削除</DialogTitle>
            <DialogDescription>
              {deleteTarget?.name} を削除します。記録した目標価格・買付条件も失われます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => deleteTarget && remove.mutate({ id: deleteTarget.id })}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* --------------------------- 追加・編集ダイアログ -------------------------- */

function WatchFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: WatchRow | null;
}) {
  const utils = trpc.useUtils();
  const isEdit = !!editing;
  const [code, setCode] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [plannedAmount, setPlannedAmount] = useState("");
  const [priority, setPriority] = useState<WatchPriority>("MEDIUM");
  const [watchReason, setWatchReason] = useState("");
  const [buyConditions, setBuyConditions] = useState("");
  const [initialized, setInitialized] = useState(false);

  // 編集対象が変わったらフォームを同期する
  if (open && isEdit && !initialized) {
    setCode(editing!.tickerCode);
    setTargetPrice(editing!.targetPrice ?? "");
    setPlannedAmount(editing!.plannedAmount ?? "");
    setPriority(editing!.priority);
    setWatchReason(editing!.watchReason ?? "");
    setBuyConditions(editing!.buyConditions ?? "");
    setInitialized(true);
  }

  const reset = () => {
    setCode("");
    setTargetPrice("");
    setPlannedAmount("");
    setPriority("MEDIUM");
    setWatchReason("");
    setBuyConditions("");
    setInitialized(false);
    lookup.reset();
  };

  const lookup = trpc.portfolio.lookup.useMutation({ onError: e => toast.error(e.message) });

  const add = trpc.watchlist.add.useMutation({
    onSuccess: async () => {
      await utils.watchlist.invalidate();
      toast.success("ウォッチリストに追加しました");
      reset();
      onOpenChange(false);
    },
    onError: e => toast.error(e.message),
  });

  const update = trpc.watchlist.update.useMutation({
    onSuccess: async () => {
      await utils.watchlist.invalidate();
      toast.success("更新しました");
      reset();
      onOpenChange(false);
    },
    onError: e => toast.error(e.message),
  });

  const preview = lookup.data;
  const pending = add.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "ウォッチ銘柄を編集" : "ウォッチリストに追加"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "目標価格や買付条件を更新できます。"
              : "日本株は 4 桁コード（例: 7203）、米国株はティッカー（例: MSFT）を入力してください。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="w-code">銘柄コード</Label>
              <div className="flex gap-2">
                <Input
                  id="w-code"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="7203 / MSFT"
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
              {preview ? (
                <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{preview.name}</span>
                    <span className="tabular text-muted-foreground">{preview.symbol}</span>
                  </div>
                  <p className="text-muted-foreground">
                    現在値 {formatMoney(preview.price, preview.currency)}
                    {preview.sector ? ` ・ ${sectorJa(preview.sector)}` : ""}
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="font-medium">{editing!.name}</p>
              <p className="tabular text-xs text-muted-foreground">
                {editing!.tickerCode} ・ 現在値 {formatMoney(editing!.priceNum, editing!.currency)}
              </p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="w-target">目標買付価格</Label>
              <Input
                id="w-target"
                type="number"
                inputMode="decimal"
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                placeholder="2500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-amount">投資予定額</Label>
              <Input
                id="w-amount"
                type="number"
                inputMode="decimal"
                value={plannedAmount}
                onChange={e => setPlannedAmount(e.target.value)}
                placeholder="500000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="w-priority">優先度</Label>
              <Select value={priority} onValueChange={v => setPriority(v as WatchPriority)}>
                <SelectTrigger id="w-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WATCH_PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="w-reason">注目理由</Label>
            <Textarea
              id="w-reason"
              value={watchReason}
              onChange={e => setWatchReason(e.target.value)}
              placeholder="なぜこの銘柄に注目しているのか。事業の強み、成長ドライバーなど。"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="w-cond">買付条件</Label>
            <Textarea
              id="w-cond"
              value={buyConditions}
              onChange={e => setBuyConditions(e.target.value)}
              placeholder="どうなったら買うのか。株価水準、決算内容、事業進捗など。AI シグナルはこの条件を判断材料に使います。"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            disabled={pending || (!isEdit && !code.trim())}
            onClick={() => {
              const payload = {
                targetPrice: targetPrice ? Number(targetPrice) : null,
                plannedAmount: plannedAmount ? Number(plannedAmount) : null,
                priority,
                watchReason: watchReason || undefined,
                buyConditions: buyConditions || undefined,
              };
              if (isEdit) {
                update.mutate({ id: editing!.id, ...payload });
              } else {
                add.mutate({ code: code.trim(), name: preview?.name, ...payload });
              }
            }}
          >
            {pending ? "保存中..." : isEdit ? "保存" : "追加する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- 保有への昇格 ------------------------------ */

function PromoteDialog({ target, onClose }: { target: WatchRow | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [keep, setKeep] = useState(false);

  const promote = trpc.watchlist.promote.useMutation({
    onSuccess: async () => {
      await utils.invalidate();
      toast.success("保有銘柄に登録しました。注目理由は投資カードに引き継がれています。");
      setQuantity("");
      setAvgCost("");
      onClose();
    },
    onError: e => toast.error(e.message),
  });

  return (
    <Dialog open={target !== null} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>保有銘柄として登録</DialogTitle>
          <DialogDescription>
            {target?.name} を買付済みとして保有一覧に移します。記録した注目理由と買付条件は投資カードに引き継がれます。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="p-qty">買付株数</Label>
              <Input
                id="p-qty"
                type="number"
                inputMode="decimal"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-cost">取得単価（{target?.currency}）</Label>
              <Input
                id="p-cost"
                type="number"
                inputMode="decimal"
                value={avgCost}
                onChange={e => setAvgCost(e.target.value)}
                placeholder={target?.priceNum ? String(target.priceNum) : "2500"}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={keep}
              onChange={e => setKeep(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            ウォッチリストにも残す（追加購入を検討する場合）
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            disabled={promote.isPending || Number(quantity) <= 0 || avgCost === ""}
            onClick={() =>
              target &&
              promote.mutate({
                id: target.id,
                quantity: Number(quantity),
                avgCost: Number(avgCost),
                keepInWatchlist: keep,
              })
            }
          >
            登録する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
