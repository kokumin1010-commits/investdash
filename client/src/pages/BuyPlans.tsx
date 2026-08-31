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
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  BAND_ACTION_LABELS,
  BAND_ACTION_STYLES,
  type BandAction,
} from "@shared/priceBands";
import {
  AlertTriangle,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  ShieldCheck,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { TransitionHistoryCard } from "@/components/investing/TransitionHistoryCard";
import { AddProposalCard } from "@/components/investing/AddProposalCard";
import {
  filterBuyPlanRows,
  formatNextBandHint,
  type BuyPlanListFilter,
} from "@shared/buyPlanUi";

/**
 * 買い増しプランの一覧。
 *
 * 112 銘柄を 1 つずつ開いて確認するのは現実的でないため、
 * 「今どの段にいるか」を横断で見て、買い増し圏に入っている銘柄と
 * 確認が必要な銘柄だけを拾えるようにする。
 */

type Filter = BuyPlanListFilter;

const FILTERS: Array<{ key: Filter; label: string; hint: string }> = [
  { key: "BUY", label: "買い増し圏", hint: "打診買い・主力買い増しの段にいる銘柄" },
  { key: "WAIT", label: "様子見", hint: "現在の価格帯では急いで買い増さない銘柄" },
  { key: "VERIFY", label: "確認が必要", hint: "下落要因を確かめる段にいる銘柄" },
  { key: "OUTSIDE", label: "価格帯の外", hint: "登録した段より上か下にいる銘柄" },
  { key: "ALL", label: "すべて", hint: "プランがある全銘柄" },
];

export default function BuyPlans() {
  const [filter, setFilter] = useState<Filter>("BUY");
  const [keyword, setKeyword] = useState("");
  const [showFullList, setShowFullList] = useState(false);

  const { data, isLoading, error } = trpc.portfolio.priceBandOverview.useQuery();
  const utils = trpc.useUtils();
  const runMissingChecks = trpc.portfolio.runMissingBandChecks.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.portfolio.priceBandOverview.invalidate(),
        utils.portfolio.schedulerRuns.invalidate(),
      ]);
      if (result.checked > 0) {
        toast.success(`${result.checked} 銘柄・${result.itemsChecked} 項目を照合しました`, {
          description:
            result.remaining > 0
              ? `残り ${result.remaining} 銘柄は Railway が自動で続行します`
              : "現在の価格帯にある確認項目をすべて照合しました",
        });
      } else if (result.deferred.length > 0) {
        toast.info(`${result.deferred.length} 銘柄は直近失敗のため一時保留です`);
      } else {
        toast.info("現在、未照合の確認項目はありません");
      }
    },
    onError: mutationError => toast.error(mutationError.message),
  });
  const allRows = data?.rows;
  const stats = data?.stats;
  const coverage = data?.coverage;
  const ranking = data?.ranking;
  const monthlyCandidates = ranking?.monthlyCandidates ?? [];

  const pendingRows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    const pending = coverage?.pending ?? [];
    if (!normalized) return pending;
    return pending.filter(
      row =>
        row.symbol.toLowerCase().includes(normalized) ||
        row.name.toLowerCase().includes(normalized)
    );
  }, [coverage?.pending, keyword]);

  const rows = useMemo(() => {
    if (!allRows) return [];
    return filterBuyPlanRows(allRows, filter, keyword)
      .sort((a, b) => {
        const aRank = a.ranking.eligible ? (a.ranking.rank ?? 999) : 999;
        const bRank = b.ranking.eligible ? (b.ranking.rank ?? 999) : 999;
        if (aRank !== bRank) return aRank - bRank;
        /*
         * 買う量が多い段を上に出す。同じ段なら「次の段まで近い」順。
         * 迷ったときに上から見れば良い並びにする。
         */
        const rank = (x: typeof a) =>
          x.action === "ADD_MAIN"
            ? 0
            : x.action === "ADD_SMALL"
              ? 1
              : x.action === "VERIFY"
                ? 2
                : x.action === "REDUCE"
                  ? 3
                  : 4;
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        const ag = a.nextGapPct === null ? -Infinity : a.nextGapPct;
        const bg = b.nextGapPct === null ? -Infinity : b.nextGapPct;
        return bg - ag;
      });
  }, [allRows, filter, keyword]);

  const counts = useMemo(() => {
    const c = { BUY: 0, WAIT: 0, VERIFY: 0, OUTSIDE: 0, ALL: 0 };
    for (const r of allRows ?? []) {
      c.ALL += 1;
      if (r.action === "ADD_SMALL" || r.action === "ADD_MAIN") c.BUY += 1;
      if (r.action === "HOLD") c.WAIT += 1;
      if (r.action === "VERIFY") c.VERIFY += 1;
      if (r.outsideDirection !== null) c.OUTSIDE += 1;
    }
    return c;
  }, [allRows]);

  const needsCheckCount = (allRows ?? []).filter(r => r.needsCheck).length;
  const pendingCheckItemCount = (allRows ?? []).reduce(
    (sum, row) => sum + row.pendingCheckCount,
    0
  );
  const concernCount = (allRows ?? []).filter(r => r.concernCount > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">買い増しプラン</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            AI が銘柄ごとに価格帯と行動を作ります。今どの段にいるかで判断してください。
          </p>
        </div>
      </div>

      {/* 今すぐ見るべきものがあるかを最初に出す */}
      {(counts.BUY > 0 || needsCheckCount > 0) && (
        <Card className="border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
            {counts.BUY > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="size-4 text-emerald-600" />
                <span className="font-medium">{counts.BUY} 銘柄</span>
                <span className="text-muted-foreground">が買い増しの価格帯に入っています</span>
              </div>
            )}
            {needsCheckCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 text-amber-600" />
                <span className="font-medium">{needsCheckCount} 銘柄</span>
                <span className="text-muted-foreground">
                  に未照合 {pendingCheckItemCount} 項目があります
                </span>
              </div>
            )}
            {concernCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 text-rose-600" />
                <span className="font-medium">{concernCount} 銘柄</span>
                <span className="text-muted-foreground">に懸念材料が見つかっています</span>
              </div>
            )}
            {needsCheckCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto border-amber-300 bg-white"
                disabled={runMissingChecks.isPending}
                onClick={() => runMissingChecks.mutate({ batchSize: 2, retryFailed: false })}
              >
                {runMissingChecks.isPending ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <AlertTriangle className="mr-1.5 size-4" />
                )}
                2 銘柄を今すぐ照合
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {needsCheckCount > 0 && (
        <p className="-mt-3 text-xs leading-5 text-muted-foreground">
          未照合分は Railway が 20 分ごとに小分けで自動確認します。ニュース根拠がない項目は「不明」のまま残し、安全と断定しません。
        </p>
      )}

      {coverage && coverage.total > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <CardTitle className="text-base">価格帯プランの作成状況</CardTitle>
                <CardDescription className="mt-1">
                  {coverage.ready} / {coverage.total} 銘柄を作成済み。未作成は架空の価格を表示せず、Railway
                  が小分けで自動生成します。
                </CardDescription>
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {coverage.total > 0
                  ? `${Math.round((coverage.ready / coverage.total) * 100)}%`
                  : "0%"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="価格帯プラン作成率"
              aria-valuemin={0}
              aria-valuemax={coverage.total}
              aria-valuenow={coverage.ready}
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{
                  width: `${coverage.total > 0 ? (coverage.ready / coverage.total) * 100 : 0}%`,
                }}
              />
            </div>

            {coverage.pending.length > 0 ? (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">未作成 {coverage.pending.length} 銘柄</span>
                  <span className="text-muted-foreground">既存プランは上書きしません</span>
                </div>
                <div className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                  {pendingRows.map(item => (
                    <Link
                      key={item.symbol}
                      href={`/holdings?symbol=${encodeURIComponent(item.symbol)}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                    >
                      <span className="min-w-0 truncate font-medium">{item.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{item.symbol}</span>
                    </Link>
                  ))}
                  {pendingRows.length === 0 && (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                      この検索条件に一致する未作成銘柄はありません
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                すべての保有銘柄に価格帯プランがあります。
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && ranking && (
        <section className="space-y-3" data-testid="monthly-priority-candidates">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-emerald-700 dark:text-emerald-300">
                MONTHLY CAPITAL ALLOCATION
              </p>
              <h2 className="mt-1 text-xl font-semibold">今月の優先候補</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                実行条件を満たす上位5銘柄だけを表示します。順位は売買指示ではなく、月1回の検討順です。
              </p>
            </div>
            <div className="text-xs text-muted-foreground sm:text-right">
              <p>{ranking.rankingMonth} · {ranking.scoreVersion}</p>
              <p>実行可能 {ranking.eligibleCount} 銘柄 / 表示 {monthlyCandidates.length} 銘柄</p>
            </div>
          </div>

          {monthlyCandidates.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {monthlyCandidates.map(row => (
                <MonthlyCandidateCard key={row.symbol} row={row} />
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex min-h-40 items-center gap-3 p-5">
                <ShieldCheck className="size-7 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold">今月、無理に買う候補はありません</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    未照合事項、シグナル競合、集中度、現金余力または IBKR リスクの門槛を優先しています。
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/**
        AI の結論を一覧より前に置く。
        月 1 回しか開かない使い方では、123 行から自分で探させるのではなく
        「どれを買うべきか」の結論が先に見えている方が判断が始まる。
      */}
      <AddProposalCard />

      <Card className="border-dashed">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">全プラン一覧</p>
            <p className="text-sm text-muted-foreground">
              価格帯にいる全銘柄は必要なときだけ開きます。候補外の理由も確認できます。
            </p>
          </div>
          <Button
            variant="outline"
            className="bg-background"
            onClick={() => setShowFullList(value => !value)}
            aria-expanded={showFullList}
          >
            {showFullList ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            {showFullList ? "一覧を閉じる" : `全 ${counts.ALL} 銘柄を表示`}
          </Button>
        </CardContent>
      </Card>

      {showFullList && <div className="flex flex-wrap items-center gap-2">
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
          {FILTERS.map(f => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              className={`w-full sm:w-auto ${filter === f.key ? "" : "bg-background"}`}
              onClick={() => setFilter(f.key)}
              title={f.hint}
              aria-pressed={filter === f.key}
            >
              {f.label}
              <span className="ml-1.5 opacity-70">{counts[f.key]}</span>
            </Button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="銘柄名・ティッカー"
            className="pl-8"
          />
        </div>
      </div>}

      {showFullList && isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {showFullList && error && (
        <Card>
          <CardContent className="py-6 text-sm text-rose-600">
            一覧を読み込めませんでした: {error.message}
          </CardContent>
        </Card>
      )}

      {showFullList && !isLoading && !error && rows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">該当する銘柄はありません</CardTitle>
            <CardDescription>
              {filter === "BUY"
                ? "今は買い増しの価格帯に入っている銘柄がありません。価格が下がるとここに出ます。"
                : filter === "WAIT"
                  ? "現在の価格帯で様子見になっている銘柄はありません。"
                : filter === "VERIFY"
                  ? "下落要因を確認すべき段にいる銘柄はありません。"
                  : "条件を変えて試してください。"}
            </CardDescription>
          </CardHeader>
          {keyword.trim() && (
            <CardContent className="pt-0">
              <Button variant="outline" size="sm" onClick={() => setKeyword("")}>
                検索をクリアして一覧に戻す
              </Button>
            </CardContent>
          )}
        </Card>
      )}

      {showFullList && <div className="space-y-2" data-testid="full-buy-plan-list">
        {rows.map(r => (
          <PlanRow key={r.symbol} row={r} stats={stats} />
        ))}
      </div>}

      {/*
        判定変化の履歴は一覧の下に置く。
        今の判定（何をすべきか）が先に来るべきで、履歴は
        「見逃していないか」を後から確かめるためのものだから。
      */}
      <TransitionHistoryCard />
    </div>
  );
}

type Row = {
  symbol: string;
  name: string;
  currency: string;
  currentPrice: number | null;
  action: BandAction | null;
  actionLabel: string | null;
  outsideDirection: "ABOVE" | "BELOW" | null;
  nextGapPct: number | null;
  nextActionLabel: string | null;
  needsCheck: boolean;
  concernCount: number;
  holdingValueJpy: number | null;
  weightPct: number | null;
  avgCost: number | null;
  pnlPct: number | null;
  costRecovered: boolean;
  held: boolean;
  watchTargetPrice: number | null;
  watchGapPct: number | null;
  watchPriority: string | null;
  targetTooFar: boolean;
  currentBandLowerPrice: number | null;
  currentBandUpperPrice: number | null;
  currentBandReason: string | null;
  currentBandPlannedAmount: number | null;
  currentBandCheckItems: string[];
  signalAction: "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT" | null;
  signalConfidence: number | null;
  signalDataQuality: "STRONG" | "MODERATE" | "LIMITED" | null;
  cardConviction: number | null;
  sizing: {
    status: string;
    amountBase: number;
    amountLocal: number;
    shares: number;
    currentWeightPct: number;
    afterWeightPct: number;
    sectorAfterPct: number;
    sectorLimitPct: number;
    ibkrRiskLevel: string | null;
    reasons: string[];
  };
  ranking: {
    eligible: boolean;
    rank: number | null;
    score: number;
    scoreVersion: string;
    breakdown: Record<string, number>;
    gateReasons: string[];
    rationale: string[];
  };
};

type Stats = {
  avgWeightPct: number | null;
  topAvgWeightPct: number | null;
};

/** 万円単位で丸める。8.58 億円規模なので円単位まで出すと桁が読めない */
function manYen(jpy: number): string {
  const man = jpy / 10000;
  if (man >= 10000) return `${(man / 10000).toFixed(2)} 億円`;
  return `${Math.round(man).toLocaleString()} 万円`;
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

function priceBandText(row: Row): string {
  const format = (value: number) =>
    value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  if (row.currentBandLowerPrice !== null && row.currentBandUpperPrice !== null) {
    return `${format(row.currentBandLowerPrice)}〜${format(row.currentBandUpperPrice)} ${row.currency}`;
  }
  if (row.currentBandUpperPrice !== null) {
    return `${format(row.currentBandUpperPrice)} ${row.currency} 以下`;
  }
  if (row.currentBandLowerPrice !== null) {
    return `${format(row.currentBandLowerPrice)} ${row.currency} 以上`;
  }
  return "価格条件未取得";
}

function MonthlyCandidateCard({ row }: { row: Row }) {
  return (
    <Card className="overflow-hidden border-emerald-200 shadow-sm dark:border-emerald-900">
      <CardHeader className="border-b bg-gradient-to-br from-emerald-50 to-white pb-3 dark:from-emerald-950/40 dark:to-background">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-emerald-700 text-white hover:bg-emerald-700">
                #{row.ranking.rank}
              </Badge>
              <CardTitle className="text-base break-words">{row.name}</CardTitle>
              <span className="text-xs text-muted-foreground">{row.symbol}</span>
              {!row.held && <Badge variant="outline">未保有</Badge>}
            </div>
            <CardDescription className="mt-1">
              {row.actionLabel ?? (row.action ? BAND_ACTION_LABELS[row.action] : "判定待ち")}
            </CardDescription>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-2xl font-semibold text-emerald-700 dark:text-emerald-300">
              {row.ranking.score}
            </p>
            <p className="text-[10px] text-muted-foreground">100点・資料品質ベース</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="text-[11px] text-muted-foreground">現在の保有</p>
            <p className="mt-1 font-mono text-sm font-semibold">
              {row.held && row.holdingValueJpy !== null ? manYen(row.holdingValueJpy) : "0円（未保有）"}
            </p>
            <p className="text-[11px] text-muted-foreground">{formatPct(row.weightPct)}</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-2.5 dark:bg-emerald-950/30">
            <p className="text-[11px] text-muted-foreground">今回の目安</p>
            <p className="mt-1 font-mono text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              {row.sizing.shares.toLocaleString("ja-JP", { maximumFractionDigits: 4 })} 株
            </p>
            <p className="text-[11px] text-muted-foreground">{manYen(row.sizing.amountBase)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="text-[11px] text-muted-foreground">買付後構成比</p>
            <p className="mt-1 font-mono text-sm font-semibold">{row.sizing.afterWeightPct.toFixed(2)}%</p>
            <p className="text-[11px] text-muted-foreground">単一銘柄上限 5%</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="text-[11px] text-muted-foreground">価格条件</p>
            <p className="mt-1 text-xs font-semibold leading-5">{priceBandText(row)}</p>
          </div>
        </div>

        <div className="rounded-xl border px-3 py-2.5 text-sm">
          <p className="font-medium">{row.currentBandReason || row.ranking.rationale[0]}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            最新シグナル {row.signalAction ?? "未取得"} · カード確信度 {row.cardConviction ?? "未設定"}/5 ·
            IBKR {row.sizing.ibkrRiskLevel ?? "未取得"}
          </p>
        </div>

        <details className="rounded-xl border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">順位の内訳と制約</summary>
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-5">
            <span>資料品質 {row.ranking.breakdown.quality ?? 0}/30</span>
            <span>安全余地 {row.ranking.breakdown.valuation ?? 0}/25</span>
            <span>基礎動向 {row.ranking.breakdown.fundamentals ?? 0}/20</span>
            <span>組合適合 {row.ranking.breakdown.portfolioFit ?? 0}/15</span>
            <span>資金余力 {row.ranking.breakdown.liquidityLeverage ?? 0}/10</span>
          </div>
          {row.sizing.reasons.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {row.sizing.reasons.map((reason, index) => (
                <li key={`${reason}-${index}`}>・{reason}</li>
              ))}
            </ul>
          )}
        </details>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <WalletCards className="size-3.5" /> 借入を増やさず現金性資産で計算
          </div>
          <Link
            href={row.held ? `/holdings?symbol=${encodeURIComponent(row.symbol)}` : "/watchlist"}
            className="text-sm font-medium text-primary hover:underline"
          >
            詳細を見る
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanRow({ row, stats }: { row: Row; stats?: Stats }) {
  const price =
    row.currentPrice === null
      ? "株価未取得"
      : `${row.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.currency}`;

  return (
    /*
     * 未保有銘柄は保有一覧に出ないので、行き先をウォッチリストに分ける。
     * 同じ /holdings に飛ばすと「該当なし」の画面に着いて行き止まりになる。
     */
    <Link href={row.held ? `/holdings?symbol=${encodeURIComponent(row.symbol)}` : "/watchlist"}>
      <Card className="hover:border-primary/40 cursor-pointer transition-colors">
        {/*
         * スマホでは横並びにすると銘柄名が「リ...」まで省略されて読めなくなるため
         * 縦に積む。PC では横並びにして一覧性を保つ。
         */}
        <CardContent className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium break-words">{row.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{row.symbol}</span>
              {!row.held && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-sky-300 bg-sky-50 text-[10px] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                >
                  未保有
                </Badge>
              )}
            </div>
            <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <span>{price}</span>
              {/*
               * 取得単価は段の根拠として意味がある。段は取得単価を基準に
               * 組まれているので、「取得 1,847 に対して今 1,992」が見えると
               * なぜ -7.2% 下がると「取得単価付近の重点買い増し」になるのかが繋がる。
               */}
              {row.avgCost !== null && (
                <span className="text-xs">
                  取得 {row.avgCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              )}
              {row.costRecovered ? (
                <span className="text-xs text-emerald-600">原価回収済み</span>
              ) : (
                row.pnlPct !== null && (
                  <span
                    className={
                      row.pnlPct >= 0
                        ? "text-xs font-medium text-emerald-600"
                        : "text-xs font-medium text-rose-600"
                    }
                  >
                    {row.pnlPct >= 0 ? "+" : ""}
                    {row.pnlPct.toFixed(1)}%
                  </span>
                )
              )}
            </div>
            {/*
             * 保有額と構成比。5 銘柄すべてが買い増し圏にあるとき、
             * どれを優先すべきかはこの数字で決まる。
             * 上限という人工的な線は引かず、全体の分布と比べられるようにする。
             */}
            {row.holdingValueJpy !== null && (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <span className="font-medium">
                  保有 {manYen(row.holdingValueJpy)}
                  {row.weightPct !== null && `・全体の ${row.weightPct.toFixed(1)}%`}
                </span>
                {stats?.avgWeightPct != null && stats.topAvgWeightPct != null && (
                  <span className="text-muted-foreground">
                    平均 {stats.avgWeightPct.toFixed(1)}% / 上位 10 平均{" "}
                    {stats.topAvgWeightPct.toFixed(1)}%
                  </span>
                )}
              </div>
            )}

            {/*
             * 未保有銘柄は保有額がないので、代わりに目標価格までの距離を出す。
             * 目標が現在値から離れすぎている場合は「待つ」ことが実質
             * 「買わない」と同じになるため、その旨を明示する。
             */}
            {!row.held && (
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <span className="text-muted-foreground">まだ持っていません</span>
                {row.watchTargetPrice !== null && (
                  <span className="font-medium">
                    目標{" "}
                    {row.watchTargetPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    {row.watchGapPct !== null && `（あと ${row.watchGapPct.toFixed(1)}%）`}
                  </span>
                )}
                {row.targetTooFar && (
                  <span className="text-amber-600">目標が遠すぎます（作り直しを検討）</span>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            {row.action ? (
              <Badge variant="outline" className={BAND_ACTION_STYLES[row.action]}>
                {row.actionLabel ?? BAND_ACTION_LABELS[row.action]}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-900/40"
              >
                {row.outsideDirection === "ABOVE"
                  ? "価格帯より上（対象外）"
                  : row.outsideDirection === "BELOW"
                    ? "価格帯より下（想定外の下落）"
                    : "判定できません"}
              </Badge>
            )}

            {/* 次の段までの距離。買い場がどれだけ近いかが一番知りたい情報 */}
            {row.nextGapPct !== null && row.nextActionLabel && (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <ArrowDown className="size-3" />
                {formatNextBandHint(row.nextGapPct, row.nextActionLabel)}
              </div>
            )}

            {row.concernCount > 0 && (
              <span className="text-xs text-rose-600">懸念 {row.concernCount} 件</span>
            )}
            {row.needsCheck && row.concernCount === 0 && (
              <span className="text-xs text-amber-600">確認項目が未照合</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
