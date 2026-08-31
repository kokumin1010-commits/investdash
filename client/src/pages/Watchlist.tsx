import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import { ExpandableText } from "@/components/investing/ExpandableText";
import { MoneyText, PctText } from "@/components/investing/Figures";
import { SignalBadge, SignalPlaceholder } from "@/components/investing/SignalBadge";
import {
  WatchProposalReviewDialog,
  type WatchProposalDraftView,
} from "@/components/investing/WatchProposalReviewDialog";
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
  BROKER_LABELS,
  formatMoney,
  marketLabel,
  sectorJa,
  type WatchPriority,
  type Market,
  type Broker,
} from "@shared/investing";
import {
  TARGET_DISTANCE_LABELS,
  type TargetDistanceLevel,
} from "@shared/targetDistance";
import {
  WATCHLIST_SORT_KEYS,
  WATCHLIST_SORT_LABELS,
  sortWatchlistRows,
  type WatchlistSortKey,
} from "@shared/watchlistSort";
import {
  Brain,
  CheckCircle2,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ArrowUpDown,
  Target,
  Trash2,
  TrendingDown,
} from "lucide-react";
import { Lightbulb, ChevronDown, ChevronUp, AlertTriangle, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
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
  /** 目標価格の距離の区分。サーバー側で判定済み */
  targetLevel: TargetDistanceLevel;
  /** 作り直しを検討すべきか */
  targetNeedsRework: boolean;
  /** なぜ作り直すべきかの説明。問題なければ null */
  targetNote: string | null;
  /**
   * 既に保有しているか。ウォッチリストに残っていても保有済みなら
   * 「新規に買うか」ではなく「買い増すか」の判断になる。
   */
  alreadyHeld: boolean;
  heldQuantity: number | null;
  heldAvgCost: number | null;
  heldBrokers: string[];
  heldPnlPct: number | null;
  signal: { action: "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT"; confidence: number | null; rationale: string; createdAt: Date } | null;
  pendingProposal: WatchProposalDraftView | null;
  latestProposal: (WatchProposalDraftView & {
    reviewStatus: "PENDING" | "ACCEPTED" | "EDITED" | "REJECTED";
  }) | null;
  createdAt: Date;
};

/** AI が提案した候補（実在検証を通ったもの） */
type SuggestedRow = {
  symbol: string;
  name: string;
  verifiedName: string;
  market: Market;
  marketLabel: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  gapKind: string;
  /**
   * 提案の系統。
   * EXPAND = 今の関心を広げる、FILL = 持っていない業種の穴を埋める。
   */
  track: "EXPAND" | "FILL";
  /** EXPAND の起点になった産業名。FILL では null */
  basedOn: string | null;
  reason: string;
  concern: string;
  targetPrice: number | null;
  currentPrice: number | null;
  currency: string;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sector: string | null;
  industry: string | null;
  /** 現在値から買いたい値段までの下落率（%）。サーバー側で算出済み */
  gapToTargetPct: number | null;
  /** その値段にした根拠 */
  targetBasis: string | null;
  /** 目標価格を補正した場合の説明。補正なしなら null */
  targetAdjustedNote: string | null;
};

/*
 * 買いたい値段は根拠と一緒に見せる。
 * 数字だけ出しても「なぜその値段か」が分からず判断材料にならない。
 * 補正した場合はその旨も必ず出す。黙って書き換えると数字を信用できなくなる。
 */

type SuggestionResult = {
  gaps: Array<{ kind: string; label: string; evidence: string }>;
  candidates: SuggestedRow[];
  overview: string;
  rejected: Array<{ name: string; symbol: string; reason: string }>;
};

/** 偏りの種類を日本語にする */
const GAP_KIND_LABELS: Record<string, string> = {
  SECTOR: "業種の偏り",
  REGION: "地域の偏り",
  YIELD: "利回りの改善",
  RISK: "下落耐性",
  SIZE: "規模の偏り",
};

/**
 * 産業名を日本語にする。
 *
 * 「Semiconductors に関心があるので」と英語で出すと、何の話か分かりにくい。
 * 対応がないものは英語のまま出す（勝手に「その他」に丸めると新しい産業が
 * 来たときに気付けない）。
 */
const INDUSTRY_JA: Record<string, string> = {
  Semiconductors: "半導体",
  "Semiconductor Equipment & Materials": "半導体製造装置・材料",
  "Software - Application": "業務ソフト",
  "Software - Infrastructure": "基盤ソフト",
  Conglomerates: "総合商社・複合企業",
  "Auto Manufacturers": "自動車",
  "Banks - Regional": "地域銀行",
  "Household & Personal Products": "日用品・化粧品",
  "Internet Retail": "ネット通販",
  "Telecom Services": "通信",
  "Credit Services": "決済・カード",
  "Building Products & Equipment": "建材・設備",
  "Computer Hardware": "コンピュータ機器",
  "REIT - Industrial": "物流・工業 REIT",
  "Electrical Equipment & Parts": "電機・電力設備",
  "Oil & Gas Integrated": "石油・ガス（総合）",
  "Oil & Gas E&P": "石油・ガス（開発）",
  "Utilities - Renewable": "再生可能エネルギー",
  "Drug Manufacturers - General": "医薬品",
  "Medical Devices": "医療機器",
  "Aerospace & Defense": "航空宇宙・防衛",
  "Specialty Chemicals": "化学",
  Insurance: "保険",
};

function industryJa(v: string | null): string {
  if (!v) return "";
  return INDUSTRY_JA[v] ?? v;
}

function formatWatchAddedDate(value: Date | string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "日付不明";
  return parsed.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

export default function Watchlist() {
  const utils = trpc.useUtils();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const list = trpc.watchlist.list.useQuery();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<WatchRow | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<WatchRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WatchRow | null>(null);
  const [signalBusyId, setSignalBusyId] = useState<number | null>(null);
  const [proposalBusyId, setProposalBusyId] = useState<number | null>(null);
  const [proposalErrors, setProposalErrors] = useState<Record<number, string>>({});
  const [proposalReview, setProposalReview] = useState<WatchProposalDraftView | null>(null);
  /** 作り直し中の銘柄。押した行だけ進行が分かるようにする */
  const [reviseBusyId, setReviseBusyId] = useState<number | null>(null);
  /**
   * AI が提案した候補銘柄。
   * 保存はせずこの画面の状態として持つ。取り込むまでは「見ただけ」の状態にしたい
   * （提案が自動で DB に入ると、自分で選んだ銘柄と AI が挙げた銘柄が混ざる）。
   */
  const [suggestion, setSuggestion] = useState<SuggestionResult | null>(null);
  const [gapsOpen, setGapsOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [highlightedWatchId, setHighlightedWatchId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<WatchlistSortKey>("NEWEST");
  const focusTimerRef = useRef<number | null>(null);

  const focusWatchId = useMemo(() => {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const value = Number(params.get("focus"));
    return Number.isInteger(value) && value > 0 ? value : null;
  }, [search]);

  const revealWatchCard = useCallback((id: number) => {
    const target = document.getElementById(`watch-${id}`);
    if (!target) return;

    setHighlightedWatchId(id);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });

    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      setHighlightedWatchId(current => (current === id ? null : current));
      focusTimerRef.current = null;
    }, 2600);
  }, []);

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

  const generateProposal = trpc.watchlist.generateProposal.useMutation({
    onSuccess: async result => {
      await utils.watchlist.invalidate();
      setProposalErrors(current => {
        const next = { ...current };
        delete next[result.watchItemId];
        return next;
      });
      setProposalReview(result as unknown as WatchProposalDraftView);
      toast.success("価格・企業情報・ニュースから AI 提案を作りました");
    },
    onError: (error, variables) => {
      setProposalErrors(current => ({ ...current, [variables.id]: error.message }));
      toast.error(error.message);
    },
    onSettled: () => setProposalBusyId(null),
  });

  const remove = trpc.watchlist.remove.useMutation({
    onSuccess: async () => {
      await utils.watchlist.invalidate();
      toast.success("ウォッチリストから削除しました");
      setDeleteTarget(null);
    },
    onError: e => toast.error(e.message),
  });

  /*
   * 買いたい値段の作り直し。
   *
   * 結果は必ず「いくらから何に変わったか」と根拠まで出す。
   * 「見直しました」だけだと、書き換わった値段を信用する材料がない。
   */
  const reviseTarget = trpc.watchlist.reviseTarget.useMutation({
    onSuccess: async res => {
      await utils.watchlist.invalidate();
      await utils.portfolio.invalidate();
      const before =
        res.previousTarget === null ? "未設定" : formatMoney(res.previousTarget, res.currency);
      toast.success(
        `${res.name} の買いたい値段を ${before} → ${formatMoney(res.targetPrice, res.currency)} に見直しました（あと ${res.gapPct?.toFixed(1) ?? "―"}%）`,
        { description: res.adjustedNote ? `${res.basis}\n${res.adjustedNote}` : res.basis, duration: 12000 }
      );
    },
    onError: e => toast.error(e.message),
    onSettled: () => setReviseBusyId(null),
  });

  const suggest = trpc.portfolio.suggestCandidates.useMutation({
    onSuccess: res => {
      setSuggestion(res as unknown as SuggestionResult);
      setPicked(new Set());
      toast.success(`候補 ${res.candidates.length} 件を提案しました`);
    },
    onError: e => toast.error(e.message),
  });
  /*
   * 前回の提案。生成には 40〜60 秒かかるため、画面を開くたびに作り直すのは
   * 現実的でない。月 1 回しか開かない使い方では、開いた瞬間に前回の提案が
   * 見えることの方が重要。
   */
  const saved = trpc.portfolio.savedCandidates.useQuery();
  const dismiss = trpc.portfolio.dismissCandidate.useMutation({
    onSuccess: async () => {
      await utils.portfolio.savedCandidates.invalidate();
      toast.success("この提案は今後出さないようにしました");
    },
    onError: e => toast.error(e.message),
  });

  const addSuggested = trpc.portfolio.addSuggestedToWatchlist.useMutation({
    onSuccess: async res => {
      await utils.watchlist.invalidate();
      toast.success(`${res.added} 件をウォッチリストに追加しました`);
      setPicked(new Set());
    },
    onError: e => toast.error(e.message),
  });

  const rows = (list.data ?? []) as unknown as WatchRow[];
  const sortedRows = useMemo(
    () => sortWatchlistRows(rows, sortKey),
    [rows, sortKey]
  );
  const reached = sortedRows.filter(r => r.reachedTarget);
  /*
   * 目標価格が現在値から離れすぎている銘柄。
   * 「待っている」ように見えて実際は買えない状態なので、
   * 到達した銘柄と同じ強さで目に入る位置に出す。
   */
  const needsRework = sortedRows.filter(r => r.targetNeedsRework);
  const heldSymbols = new Set(rows.map(r => r.symbol));

  useEffect(() => {
    if (focusWatchId === null || list.isLoading) return;
    const frame = window.requestAnimationFrame(() => revealWatchCard(focusWatchId));
    return () => window.cancelAnimationFrame(frame);
  }, [focusWatchId, list.data, list.isLoading, revealWatchCard]);

  useEffect(
    () => () => {
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    },
    []
  );

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
            {needsRework.length > 0 ? ` ・ 見直しが必要 ${needsRework.length} 件` : ""}
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
          <Button
            variant="outline"
            size="sm"
            disabled={suggest.isPending}
            onClick={() => suggest.mutate()}
          >
            <Lightbulb className={`mr-1.5 h-3.5 w-3.5 ${suggest.isPending ? "animate-pulse" : ""}`} />
            {suggest.isPending ? "AI が分析中..." : "AI に候補を出させる"}
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            銘柄を追加
          </Button>
        </div>
      </header>

      {suggest.isPending ? (
        <Card className="border-primary/30 bg-accent/40">
          <CardContent className="space-y-2 py-5 text-center">
            <p className="text-sm font-medium">保有と検討中の銘柄から関心を読み取っています</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              どの分野に関心が集まっているかを集計し、同じ分野でまだ持っていない銘柄と、
              逆に持っていない分野の銘柄を挙げます。挙がった銘柄は株価が実際に取得できるか
              検証してから表示します（40〜60 秒）。
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/*
       * 前回の提案。今回の提案を出している間は隠す（同じ銘柄が
       * 上下に二重で並ぶと、どちらが新しいのか分からなくなる）。
       */}
      {!suggestion && !suggest.isPending && (saved.data ?? []).filter(s => !s.dismissed && !s.addedToWatchlist).length > 0 ? (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4 text-muted-foreground" />
              前回 AI が挙げた候補{" "}
              {(saved.data ?? []).filter(s => !s.dismissed && !s.addedToWatchlist).length} 件
            </CardTitle>
            <CardDescription className="text-xs">
              まだウォッチリストに入れていない提案です。もう不要なものは「今後出さない」を
              押すと、次回の提案から除外されます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(saved.data ?? [])
              .filter(s => !s.dismissed && !s.addedToWatchlist)
              .map(s => (
                <div key={s.symbol} className="rounded-lg border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="tabular text-xs text-muted-foreground">{s.symbol}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {s.track === "EXPAND" ? "関心を広げる" : "分野を埋める"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${PRIORITY_STYLES[s.priority]}`}
                    >
                      優先度 {PRIORITY_LABELS[s.priority]}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                    <span className="tabular">
                      提案時 {formatMoney(s.priceAtSuggestion, s.currency ?? "USD")}
                    </span>
                    {s.targetPrice != null ? (
                      <span className="tabular text-gain">
                        買いたい値段 {formatMoney(s.targetPrice, s.currency ?? "USD")}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString("ja-JP")}
                    </span>
                  </div>
                  <ExpandableText
                    label="この銘柄を挙げた理由"
                    text={s.reason}
                    className="mt-1 text-xs"
                  />
                  <div className="mt-1.5 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={dismiss.isPending}
                      onClick={() => dismiss.mutate({ symbol: s.symbol })}
                    >
                      今後出さない
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {suggestion ? (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4 text-primary" />
                  AI が挙げた候補 {suggestion.candidates.length} 件
                </CardTitle>
                <CardDescription className="text-xs">
                  保有と検討中の銘柄から関心を読み取り、同じ分野でまだ持っていない銘柄と、
                  逆に持っていない分野の銘柄を挙げています。
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSuggestion(null)}>
                閉じる
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted/50 px-3 py-2.5">
              <p className="text-xs leading-relaxed">{suggestion.overview}</p>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setGapsOpen(v => !v)}
              >
                <span className="text-xs font-medium text-muted-foreground">
                  提案の根拠にした偏り {suggestion.gaps.length} 件
                </span>
                {gapsOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
              {gapsOpen ? (
                <div className="space-y-1.5">
                  {suggestion.gaps.map((g, i) => (
                    <div key={i} className="rounded-lg border border-dashed px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {GAP_KIND_LABELS[g.kind] ?? g.kind}
                        </Badge>
                        <span className="text-xs font-medium">{g.label}</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {g.evidence}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              {/*
               * 系統ごとに分けて出す。混ぜて並べると「今の関心の延長」と
               * 「持っていない業種の穴埋め」が交互に来て、どの観点で
               * 見ればよいのか分からなくなる。
               */}
              {(["EXPAND", "FILL"] as const).map(track => {
                const items = suggestion.candidates.filter(c => c.track === track);
                if (items.length === 0) return null;
                return (
                  <div key={track} className="space-y-2">
                    <div className="flex items-baseline gap-2 pt-1">
                      <h3 className="text-xs font-semibold">
                        {track === "EXPAND"
                          ? `今の関心を広げる ${items.length} 件`
                          : `持っていない分野を埋める ${items.length} 件`}
                      </h3>
                      <span className="text-[11px] text-muted-foreground">
                        {track === "EXPAND"
                          ? "保有・検討中の銘柄と同じ分野"
                          : "偏りを減らす目的"}
                      </span>
                    </div>
                    {items.map(c => {
                      const already = heldSymbols.has(c.symbol);
                      const checked = picked.has(c.symbol);
                      return (
                        <div
                          key={c.symbol}
                          className={`rounded-lg border px-3 py-2.5 ${checked ? "border-primary bg-accent/40" : ""}`}
                        >
                          <div className="flex items-start gap-2.5">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]"
                              checked={checked}
                              disabled={already}
                              onChange={e => {
                                const next = new Set(picked);
                                if (e.target.checked) next.add(c.symbol);
                                else next.delete(c.symbol);
                                setPicked(next);
                              }}
                            />
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="text-sm font-medium">{c.verifiedName}</span>
                                <span className="tabular text-xs text-muted-foreground">
                                  {c.symbol}
                                </span>
                                <Badge variant="outline" className="text-[10px]">
                                  {c.marketLabel}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${PRIORITY_STYLES[c.priority]}`}
                                >
                                  優先度 {PRIORITY_LABELS[c.priority]}
                                </Badge>
                                {already ? (
                                  <Badge variant="outline" className="text-[10px]">
                                    すでに登録済み
                                  </Badge>
                                ) : null}
                              </div>

                              {/*
                               * EXPAND はどの関心から来たかを出す。これがないと
                               * 「なぜこの銘柄が挙がったのか」が読み取れない。
                               * FILL はどの穴を埋めるかを出す。
                               */}
                              <p className="text-[11px] text-muted-foreground">
                                {c.track === "EXPAND" && c.basedOn
                                  ? `${industryJa(c.basedOn)}に関心があるため`
                                  : GAP_KIND_LABELS[c.gapKind] ?? c.gapKind}
                                {c.industry && c.industry !== c.basedOn
                                  ? ` ／ この銘柄は ${industryJa(c.industry)}`
                                  : ""}
                              </p>

                              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
                                <span className="tabular">
                                  現在値 {formatMoney(c.currentPrice, c.currency)}
                                </span>
                                {c.targetPrice != null ? (
                                  <span className="tabular text-gain">
                                    買いたい値段 {formatMoney(c.targetPrice, c.currency)}
                                    {c.gapToTargetPct != null ? (
                                      <span className="ml-1 text-muted-foreground">
                                        （あと {c.gapToTargetPct.toFixed(1)}%）
                                      </span>
                                    ) : null}
                                  </span>
                                ) : null}
                                {c.fiftyTwoWeekLow != null && c.fiftyTwoWeekHigh != null ? (
                                  <span className="tabular text-muted-foreground">
                                    52週 {formatMoney(c.fiftyTwoWeekLow, c.currency)} 〜{" "}
                                    {formatMoney(c.fiftyTwoWeekHigh, c.currency)}
                                  </span>
                                ) : null}
                              </div>

                              <ExpandableText
                                label="この銘柄を挙げた理由"
                                text={c.reason}
                                className="text-xs"
                              />
                              {c.targetBasis ? (
                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                  <span className="font-medium">この値段の根拠: </span>
                                  {c.targetBasis}
                                </p>
                              ) : null}
                              {c.targetAdjustedNote ? (
                                <p className="rounded bg-amber-500/10 px-2 py-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                                  {c.targetAdjustedNote}
                                </p>
                              ) : null}
                              <p className="text-[11px] leading-relaxed text-loss">
                                <span className="font-medium">懸念: </span>
                                {c.concern}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {suggestion.rejected.length > 0 ? (
              <div className="rounded-lg border border-dashed px-3 py-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  株価が取得できず除外した銘柄 {suggestion.rejected.length} 件
                </p>
                {suggestion.rejected.map(r => (
                  <p key={r.symbol} className="mt-1 text-[11px] text-muted-foreground">
                    {r.name}（{r.symbol}）: {r.reason}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {picked.size > 0
                  ? `${picked.size} 件を選択中`
                  : "追加したい銘柄にチェックを入れてください"}
              </p>
              <Button
                size="sm"
                disabled={picked.size === 0 || addSuggested.isPending}
                onClick={() => {
                  const targets = suggestion.candidates
                    .filter(c => picked.has(c.symbol))
                    .map(c => ({
                      symbol: c.symbol,
                      name: c.verifiedName,
                      market: c.market,
                      priority: c.priority,
                      targetPrice: c.targetPrice,
                      reason: c.reason,
                      concern: c.concern,
                    }));
                  addSuggested.mutate({ candidates: targets });
                }}
              >
                {addSuggested.isPending ? "追加中..." : "ウォッチリストに追加"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

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

      {/*
        目標価格が現在値から離れすぎている銘柄。

        待っているつもりでも実際には買えない状態なので、到達した銘柄と
        同じ高さに置く。下の一覧の中だけに出すと、カードを 1 枚ずつ
        見ないと気付けない。
      */}
      {needsRework.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              買いたい値段が現実的でない銘柄
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              現在値から 30% 以上離れた値段を待つ設定になっています。この水準まで待つことは実質「買わない」に近く、買い場を逃す恐れがあります。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsRework.map(r => (
              <div
                key={r.id}
                className="space-y-1.5 rounded-lg bg-card/60 px-3 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{r.name}</span>
                  <span className="tabular text-xs text-muted-foreground">{r.tickerCode}</span>
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-100/60 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                  >
                    {TARGET_DISTANCE_LABELS[r.targetLevel]}
                  </Badge>
                </div>
                <p className="tabular text-xs text-muted-foreground">
                  現在 {formatMoney(r.priceNum, r.currency)} / 目標{" "}
                  {formatMoney(r.targetNum, r.currency)}
                  {r.gapPct !== null ? `（あと ${r.gapPct.toFixed(1)}%）` : ""}
                </p>
                {r.targetNote ? (
                  <p className="text-xs leading-relaxed">{r.targetNote}</p>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-background"
                    disabled={reviseBusyId !== null}
                    onClick={() => {
                      setReviseBusyId(r.id);
                      reviseTarget.mutate({ id: r.id });
                    }}
                  >
                    <Wand2
                      className={`mr-1.5 h-3.5 w-3.5 ${reviseBusyId === r.id ? "animate-pulse" : ""}`}
                    />
                    {reviseBusyId === r.id ? "AI が見直し中..." : "AI に作り直させる"}
                  </Button>
                  {/* 自分で決めたい場合の逃げ道。AI に任せる以外の選択肢を必ず残す */}
                  <Button size="sm" variant="ghost" onClick={() => setEditTarget(r)}>
                    自分で直す
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border bg-card/70 px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-primary" />
            <div>
              <Label htmlFor="watchlist-sort" className="text-sm font-semibold">
                並び順
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {WATCHLIST_SORT_LABELS[sortKey]}で {sortedRows.length} 件を表示
              </p>
            </div>
          </div>
          <select
            value={sortKey}
            onChange={event => setSortKey(event.target.value as WatchlistSortKey)}
            id="watchlist-sort"
            aria-label="ウォッチリストの並び順"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-[220px]"
          >
            {WATCHLIST_SORT_KEYS.map(key => (
              <option key={key} value={key}>
                {WATCHLIST_SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </div>
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
                まず銘柄コードだけ追加してください。価格・ニュース・企業情報を取得し、AI が目標価格と買付条件を下書きします。
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
          {sortedRows.map(r => (
            <Card
              key={r.id}
              id={`watch-${r.id}`}
              data-watch-id={r.id}
              className={`scroll-mt-6 transition-[box-shadow,background-color,border-color] duration-300 ${
                r.reachedTarget ? "border-gain/40" : ""
              } ${
                highlightedWatchId === r.id
                  ? "border-sky-500 bg-sky-50/70 ring-4 ring-sky-400/30 dark:border-sky-400 dark:bg-sky-950/30"
                  : ""
              }`}
            >
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
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className={`text-[11px] ${PRIORITY_STYLES[r.priority]}`}>
                      優先度 {PRIORITY_LABELS[r.priority]}
                    </Badge>
                    {/*
                      既に持っている銘柄はここで分かるようにする。
                      「まだ持っていない」前提で目標価格を見ていると、
                      実際には買い増しの判断をすべき銘柄を新規購入として扱う。
                    */}
                    {r.alreadyHeld ? (
                      <Badge
                        variant="outline"
                        className="border-sky-300 bg-sky-100/70 text-[10px] text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300"
                      >
                        既に保有
                      </Badge>
                    ) : null}
                    <span className="tabular text-[10px] text-muted-foreground">
                      追加 {formatWatchAddedDate(r.createdAt)}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/*
                  保有済みの場合は取得単価と損益を出す。買い増しの判断では
                  「今いくらで持っているか」が目標価格と同じくらい効く。
                */}
                {r.alreadyHeld ? (
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-sky-200/70 bg-sky-50/60 px-2.5 py-2 text-[11px] dark:border-sky-900/60 dark:bg-sky-950/20">
                    <span className="font-medium text-sky-700 dark:text-sky-300">
                      この銘柄は既に持っています
                    </span>
                    {r.heldQuantity !== null ? (
                      <span className="tabular text-muted-foreground">
                        {r.heldQuantity.toLocaleString("ja-JP")} 株
                      </span>
                    ) : null}
                    {r.heldAvgCost !== null ? (
                      <span className="text-muted-foreground">
                        取得単価{" "}
                        <MoneyText
                          value={r.heldAvgCost}
                          currency={r.currency}
                          className="tabular text-[11px]"
                        />
                      </span>
                    ) : null}
                    {r.heldPnlPct !== null ? (
                      <span
                        className={`tabular font-medium ${r.heldPnlPct >= 0 ? "text-gain" : "text-loss"}`}
                      >
                        {r.heldPnlPct >= 0 ? "+" : ""}
                        {r.heldPnlPct.toFixed(1)}%
                      </span>
                    ) : null}
                    {r.heldBrokers.length > 0 ? (
                      <span className="text-muted-foreground">
                        {r.heldBrokers.map(b => BROKER_LABELS[b as Broker] ?? b).join(" / ")}
                      </span>
                    ) : null}
                    <Link
                      href={`/holdings?symbol=${encodeURIComponent(r.symbol)}`}
                      className="text-sky-700 underline underline-offset-2 dark:text-sky-300"
                    >
                      保有を見る
                    </Link>
                  </div>
                ) : null}

                <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 px-3 py-2.5">
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">現在値</p>
                    {/*
                      ここは株価そのものなので表示通貨に換算しない。
                      「いくらになったら買うか」を板の値段で判断するため、
                      USD 換算した目標価格を出しても注文に使えない。
                    */}
                    <MoneyText value={r.priceNum} currency={r.currency} className="text-sm font-medium" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">目標価格</p>
                    <MoneyText value={r.targetNum} currency={r.currency} className="text-sm font-medium" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[11px] text-muted-foreground">目標まで</p>
                    {r.gapPct === null ? (
                      <span className="text-sm text-muted-foreground">—</span>
                    ) : r.gapPct >= 0 ? (
                      /* 現在値が目標以下。すでに買える水準に来ている */
                      <span className="tabular text-sm font-medium text-gain">到達</span>
                    ) : (
                      <span
                        className={`tabular text-sm font-medium ${r.gapPct > -10 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}
                      >
                        {r.gapPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>

                {/*
                  距離の区分は一覧の中でも出す。上の警告カードだけだと
                  「やや遠い」（作り直しの対象にはしないが時間がかかる）が
                  どこにも表示されず、判断の材料が落ちる。
                */}
                {r.targetNote ? (
                  <div className="space-y-1.5 rounded-lg border border-amber-300/70 bg-amber-50/60 px-2.5 py-2 dark:border-amber-900/60 dark:bg-amber-950/20">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        買いたい値段が{TARGET_DISTANCE_LABELS[r.targetLevel]}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed">{r.targetNote}</p>
                    {r.targetNeedsRework ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-full bg-background text-[11px]"
                        disabled={reviseBusyId !== null}
                        onClick={() => {
                          setReviseBusyId(r.id);
                          reviseTarget.mutate({ id: r.id });
                        }}
                      >
                        <Wand2
                          className={`mr-1.5 h-3 w-3 ${reviseBusyId === r.id ? "animate-pulse" : ""}`}
                        />
                        {reviseBusyId === r.id ? "AI が見直し中..." : "AI に作り直させる"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {r.watchReason ? (
                  <ExpandableText label="注目理由" text={r.watchReason} />
                ) : null}

                {r.buyConditions ? (
                  <ExpandableText label="買付条件" text={r.buyConditions} />
                ) : null}

                {proposalErrors[r.id] ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50/70 p-3 dark:border-rose-900 dark:bg-rose-950/20">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-loss" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold">AI提案を作成できませんでした</p>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          {proposalErrors[r.id]}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-8 bg-background"
                          disabled={proposalBusyId !== null}
                          onClick={() => {
                            setProposalErrors(current => {
                              const next = { ...current };
                              delete next[r.id];
                              return next;
                            });
                            setProposalBusyId(r.id);
                            generateProposal.mutate({ id: r.id });
                          }}
                        >
                          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${proposalBusyId === r.id ? "animate-spin" : ""}`} />
                          {proposalBusyId === r.id ? "再取得中..." : "もう一度試す"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {r.pendingProposal ? (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="border-violet-300 bg-white text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                          AI提案・要確認
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          確信度 {r.pendingProposal.confidence}
                        </span>
                      </div>
                      <Button size="sm" className="h-8" onClick={() => setProposalReview(r.pendingProposal)}>
                        提案を確認
                      </Button>
                    </div>
                    <p className="mt-2 text-xs font-medium leading-relaxed">{r.pendingProposal.conclusion}</p>
                  </div>
                ) : r.latestProposal && r.latestProposal.reviewStatus !== "PENDING" ? (
                  <div className="rounded-lg border bg-muted/25 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="bg-background text-[10px]">
                        {r.latestProposal.reviewStatus === "ACCEPTED"
                          ? "AI提案を採用済み"
                          : r.latestProposal.reviewStatus === "EDITED"
                            ? "確認して修正済み"
                            : "今回は見送り済み"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {r.latestProposal.stance === "BUY"
                          ? "今買う"
                          : r.latestProposal.stance === "WAIT"
                            ? "価格を待つ"
                            : "今回は見送る"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed">{r.latestProposal.conclusion}</p>
                    {r.latestProposal.reviewStatus === "REJECTED" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-8 bg-background"
                        disabled={proposalBusyId !== null}
                        onClick={() => {
                          setProposalErrors(current => {
                            const next = { ...current };
                            delete next[r.id];
                            return next;
                          });
                          setProposalBusyId(r.id);
                          generateProposal.mutate({ id: r.id });
                        }}
                      >
                        <Wand2 className={`mr-1.5 h-3.5 w-3.5 ${proposalBusyId === r.id ? "animate-pulse" : ""}`} />
                        {proposalBusyId === r.id ? "AI が提案中..." : "もう一度提案"}
                      </Button>
                    ) : null}
                  </div>
                ) : r.targetPrice === null && !r.watchReason && !r.buyConditions ? (
                  <div className="rounded-lg border border-dashed bg-muted/20 p-3">
                    <p className="text-xs font-medium">
                      {proposalBusyId === r.id ? "価格・ニュース・企業情報を取得中..." : "目標価格と買付条件はまだ未設定です"}
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      AI が「今買う・価格を待つ・見送る」を根拠付きで下書きします。確認するまで自動保存しません。
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-8 bg-background"
                      disabled={proposalBusyId !== null}
                      onClick={() => {
                        setProposalErrors(current => {
                          const next = { ...current };
                          delete next[r.id];
                          return next;
                        });
                        setProposalBusyId(r.id);
                        generateProposal.mutate({ id: r.id });
                      }}
                    >
                      <Wand2 className={`mr-1.5 h-3.5 w-3.5 ${proposalBusyId === r.id ? "animate-pulse" : ""}`} />
                      {proposalBusyId === r.id ? "AI が提案中..." : "AI 提案を作る"}
                    </Button>
                  </div>
                ) : null}

                <WatchPlanSummary symbol={r.symbol} currency={r.currency} />

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

      <WatchFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onExistingWatch={id => {
          setAddOpen(false);
          setLocation(`/watchlist?focus=${id}`);
          window.requestAnimationFrame(() => revealWatchCard(id));
        }}
        onExistingHolding={id => {
          setAddOpen(false);
          setLocation(`/holdings/${id}`);
        }}
        onAdded={item => {
          setAddOpen(false);
          setProposalBusyId(item.id);
          generateProposal.mutate({ id: item.id });
        }}
      />
      <WatchFormDialog
        open={editTarget !== null}
        onOpenChange={o => !o && setEditTarget(null)}
        editing={editTarget}
      />
      <PromoteDialog target={promoteTarget} onClose={() => setPromoteTarget(null)} />
      <WatchProposalReviewDialog
        proposal={proposalReview}
        open={proposalReview !== null}
        onOpenChange={open => !open && setProposalReview(null)}
      />

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

export function WatchFormDialog({
  open,
  onOpenChange,
  editing,
  onAdded,
  onExistingWatch,
  onExistingHolding,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing?: WatchRow | null;
  onAdded?: (item: { id: number; symbol: string }) => void;
  onExistingWatch?: (id: number) => void;
  onExistingHolding?: (id: number) => void;
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
    onSuccess: async result => {
      await utils.watchlist.invalidate();
      toast.success("銘柄を追加しました。続けて AI 提案を作ります");
      reset();
      onAdded?.(result);
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
  const existingWatch = preview?.existingWatch ?? null;
  const existingHoldings = preview?.existingHoldings ?? [];
  const recommendedHolding = existingHoldings[0] ?? null;
  const isAlreadyRegistered = existingWatch !== null || recommendedHolding !== null;
  const pending = add.isPending || update.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto border-slate-200 bg-white text-slate-950 shadow-2xl dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "ウォッチ銘柄を編集" : "ウォッチリストに追加"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "目標価格や買付条件を更新できます。"
              : "最初は銘柄コードだけで追加できます。追加後、AI の下書きを確認してから目標価格や買付条件を保存します。"}
          </DialogDescription>
        </DialogHeader>

        {!isEdit ? (
          <div className="grid grid-cols-3 gap-2 rounded-xl border bg-slate-50 p-3 text-center text-[11px] dark:bg-slate-900/70">
            <span><b className="block text-sm text-primary">1</b>銘柄を追加</span>
            <span><b className="block text-sm text-primary">2</b>AIが情報取得</span>
            <span><b className="block text-sm text-primary">3</b>確認して保存</span>
          </div>
        ) : null}

        <div className="space-y-4">
          {!isEdit ? (
            <div className="space-y-2">
              <Label htmlFor="w-code">銘柄コード</Label>
              <div className="flex gap-2">
                <Input
                  id="w-code"
                  value={code}
                  onChange={e => {
                    setCode(e.target.value);
                    if (lookup.data) lookup.reset();
                  }}
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

          {isEdit ? (
            <>
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
            </>
          ) : preview && isAlreadyRegistered ? (
            <div className="space-y-2" role="status" aria-live="polite">
              {existingWatch ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900 dark:bg-sky-950/25">
                  <p className="text-xs font-semibold text-sky-800 dark:text-sky-200">
                    ウォッチリスト登録済み
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    新しく追加せず、登録済みのウォッチカードへ移動できます。
                  </p>
                </div>
              ) : null}
              {recommendedHolding ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/25">
                  <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
                    保有銘柄として登録済み
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {existingHoldings.length > 1
                      ? `${existingHoldings.length}口座で保有しています。保有詳細を優先して表示します。`
                      : `${BROKER_LABELS[recommendedHolding.broker as Broker] ?? recommendedHolding.broker} で保有しています。`}
                  </p>
                </div>
              ) : null}
            </div>
          ) : preview ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs leading-relaxed text-sky-800 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-200">
              この銘柄だけ先に保存します。その後、現在値・6か月価格・配当・企業情報・ニュースを取得し、AI が「今買うか」を提案します。
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            キャンセル
          </Button>
          {!isEdit && existingWatch ? (
            <Button
              variant={recommendedHolding ? "outline" : "default"}
              onClick={() => onExistingWatch?.(existingWatch.id)}
            >
              {recommendedHolding ? "ウォッチカードを見る" : "登録済みの銘柄を見る"}
            </Button>
          ) : null}
          {!isEdit && recommendedHolding ? (
            <Button onClick={() => onExistingHolding?.(recommendedHolding.id)}>
              保有詳細を見る
            </Button>
          ) : null}
          {isEdit || !isAlreadyRegistered ? (
            <Button
              disabled={pending || (!isEdit && (!code.trim() || !preview))}
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
                  add.mutate({ code: code.trim(), name: preview?.name });
                }
              }}
            >
              {pending ? "保存中..." : isEdit ? "保存" : "この銘柄を追加"}
            </Button>
          ) : null}
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

/**
 * ウォッチリスト銘柄の購入プラン（価格帯）の要約。
 *
 * 保有銘柄の買い増しプランと同じ仕組みを未保有銘柄にも使う。
 * カード内に置くため全段は出さず「今どの段にいるか」と
 * 「次の段まであと何 %」だけに絞る。詳細は段を開いて確認する。
 */
function compactJpy(value: number): string {
  const man = value / 10_000;
  const digits = man >= 100 ? 0 : 1;
  return `${man.toLocaleString("ja-JP", { minimumFractionDigits: digits, maximumFractionDigits: digits })}万円`;
}

function WatchPlanSummary({ symbol, currency }: { symbol: string; currency: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const plan = trpc.portfolio.priceBandPlan.useQuery({ symbol });
  const generate = trpc.portfolio.generateWatchPricePlan.useMutation({
    onSuccess: () => {
      utils.portfolio.priceBandPlan.invalidate({ symbol });
      toast.success("購入プランを作成しました");
    },
    onError: e => toast.error(e.message),
  });

  /*
   * 取得中は枠だけを出す。ただし isLoading は「まだ一度も成功していない」状態で、
   * エラーで止まった場合も true のままになる。それをそのまま出すと
   * 灰色の空欄が消えずに残り、プランが無いのか読み込み中なのか分からなくなる。
   * そのためエラーを先に判定する。
   */
  if (plan.isError) {
    return (
      <p className="rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
        購入プランを読み込めませんでした（{plan.error.message}）
      </p>
    );
  }

  if (plan.isPending) {
    return <Skeleton className="h-9 w-full rounded-lg" />;
  }

  // 未作成。生成を促す
  if (!plan.data) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="w-full bg-background"
        disabled={generate.isPending}
        onClick={() => generate.mutate({ symbol })}
      >
        <Target className={`mr-1.5 h-3.5 w-3.5 ${generate.isPending ? "animate-pulse" : ""}`} />
        {generate.isPending ? "AI が価格帯を設計中..." : "AI に購入価格帯を提案させる"}
      </Button>
    );
  }

  const ev = plan.data.evaluation;
  const current = ev.currentBand;
  const bands = plan.data.bands;
  const sizing = plan.data.sizing;
  const canBuy = sizing.status === "BUY" && sizing.shares > 0;
  const actionPrice = canBuy ? plan.data.currentPrice : (ev.nextBand?.upperPrice ?? plan.data.currentPrice);
  const statusText = (() => {
    if (canBuy) {
      return sizing.lotAdjusted
        ? "最低売買単位に合わせた打診額です"
        : `${sizing.tranchePct}%ずつ段階的に入る初回額です`;
    }
    if (sizing.status === "BLOCKED_MARGIN") return "IBKR の借入リスクを下げるまで新規買付を止めます";
    if (sizing.status === "BLOCKED_POSITION") return "この銘柄は上限に達しているため追加しません";
    if (sizing.status === "BLOCKED_SECTOR") return "この業種は慎重上限に達しているため追加しません";
    if (sizing.status === "TOO_SMALL") return "最低売買単位が今回のリスク予算を超えます";
    if (sizing.status === "UNAVAILABLE") return "金額計算に必要なデータを確認できません";
    return "現在の価格帯では買わず、次の条件を待ちます";
  })();

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">ポートフォリオ連動の買付目安</p>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setOpen(v => !v)}
        >
          {open ? "閉じる" : "計算根拠を見る"}
        </button>
      </div>

      <div
        data-testid={`position-sizing-summary-${symbol}`}
        className="grid grid-cols-3 gap-2 rounded-lg bg-background/80 p-2.5 shadow-sm"
      >
        <div className="min-w-0">
          <p className="text-[10px] text-muted-foreground">今回</p>
          {canBuy ? (
            <>
              <p className="tabular whitespace-nowrap text-sm font-semibold" title={formatMoney(sizing.amountBase, "JPY")}>
                {compactJpy(sizing.amountBase)}
              </p>
              <p className="tabular text-[10px] text-muted-foreground">
                {sizing.shares.toLocaleString("ja-JP")} 株
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">0 株</p>
              <p className="text-[10px] text-muted-foreground">今は買わない</p>
            </>
          )}
        </div>
        <div className="min-w-0 border-l pl-2">
          <p className="text-[10px] text-muted-foreground">買う価格</p>
          <MoneyText value={actionPrice} currency={currency} className="block truncate text-sm font-semibold" />
          <p className="truncate text-[10px] text-muted-foreground">
            {canBuy ? "現在の水準" : "次の目安"}
          </p>
        </div>
        <div className="min-w-0 border-l pl-2">
          <p className="text-[10px] text-muted-foreground">買った後</p>
          <p className="tabular truncate text-sm font-semibold">{sizing.afterWeightPct.toFixed(2)}%</p>
          <p className="tabular truncate text-[10px] text-muted-foreground">
            現在 {sizing.currentWeightPct.toFixed(2)}%
            {sizing.currentWeightPct === 0 ? "・未保有" : ""}
          </p>
        </div>
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold leading-snug">{current?.actionLabel ?? "価格帯を確認中"}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{statusText}</p>
        </div>
        {sizing.marginFactor === 0.5 ? (
          <Badge variant="outline" className="shrink-0 border-amber-300 text-[10px]">
            借入考慮 50%
          </Badge>
        ) : null}
      </div>

      {open ? (
        <div data-testid={`position-sizing-details-${symbol}`} className="space-y-2.5 border-t pt-2.5">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-background/70 p-2.5 text-[11px]">
            <div>
              <p className="text-muted-foreground">今回の実額</p>
              <p className="tabular font-medium">
                {formatMoney(sizing.amountBase, "JPY")}・{sizing.shares.toLocaleString("ja-JP")} 株
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">現在の実保有</p>
              <p className="tabular font-medium">
                {sizing.currentWeightPct.toFixed(2)}%{sizing.currentWeightPct === 0 ? "（未保有）" : ""}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">目標総ポジション</p>
              <p className="tabular font-medium">{sizing.targetWeightPct.toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">現金性資産・買付後</p>
              <p className="tabular font-medium">{formatMoney(sizing.remainingLiquidBase, "JPY")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">業種比率・買付後</p>
              <p className="tabular font-medium">
                {sizing.sectorCurrentPct.toFixed(1)}% → {sizing.sectorAfterPct.toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">IBKR 主レバレッジ</p>
              <p className="tabular font-medium">
                {sizing.ibkrLeverage === null ? "―" : `${sizing.ibkrLeverage.toFixed(2)}x`}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">追証までの下落余地</p>
              <p className="tabular font-medium">
                {sizing.ibkrDropToMarginCallPct === null ? "―" : `${sizing.ibkrDropToMarginCallPct.toFixed(1)}%`}
              </p>
            </div>
          </div>

          <div className="space-y-1 rounded-md border border-dashed px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {sizing.reasons.map(reason => <p key={reason}>・{reason}</p>)}
            <p>・単一銘柄は最大 5%、業種は最大 {sizing.sectorLimitPct.toFixed(0)}%</p>
            <p>・現金性資産の 75% は追証・追加機会のため残します</p>
          </div>

          <p className="text-[11px] font-medium text-muted-foreground">価格帯ごとの次の行動</p>
          {bands.map(b => {
            const isCurrent = current?.id === b.id;
            return (
              <div
                key={b.id}
                className={`rounded-md px-2 py-1.5 text-[11px] leading-relaxed ${
                  isCurrent ? "bg-primary/10 font-medium" : "bg-muted/40"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="tabular shrink-0 text-muted-foreground">
                    {b.lowerPrice === null ? "―" : formatMoney(b.lowerPrice, currency)}
                    {" 〜 "}
                    {b.upperPrice === null ? "―" : formatMoney(b.upperPrice, currency)}
                  </span>
                  {isCurrent ? (
                    <Badge variant="outline" className="shrink-0 border-primary/40 text-[10px]">
                      現在ここ
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5">{b.actionLabel}</p>
                {b.reason ? <p className="mt-0.5 text-muted-foreground">{b.reason}</p> : null}
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full text-[11px]"
            disabled={generate.isPending}
            onClick={() => generate.mutate({ symbol })}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${generate.isPending ? "animate-spin" : ""}`} />
            作り直す
          </Button>
        </div>
      ) : null}
    </div>
  );
}
