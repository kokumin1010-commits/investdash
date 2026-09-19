import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import {
  buildLongTermGoalProgress,
  DEFAULT_LONG_TERM_SCENARIO_RATES,
  type LongTermGoalScenario,
} from "@shared/longTermGoal";
import type {
  ActualIncomeMetric,
  CashIncomeOverview,
  ForecastRunRateMetric,
} from "@shared/cashIncome";
import { Flag, Pencil, ShieldCheck, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  currentNetAssetsJpy: number | null | undefined;
  stockAssetsJpy: number | null | undefined;
  cashJpy: number | null | undefined;
  interestAssetsJpy: number | null | undefined;
  borrowedPrincipalJpy: number | null | undefined;
  unrealizedPnlJpy: number | null | undefined;
  annualDividendJpy: number | null | undefined;
  annualInterestIncomeJpy: number | null | undefined;
  annualBorrowingInterestJpy: number | null | undefined;
  cashIncome?: CashIncomeOverview | null;
};

const JPY_PER_OKU = 100_000_000;
const JPY_PER_MAN = 10_000;

function yen(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function signedYen(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}¥${Math.round(Math.abs(value)).toLocaleString("ja-JP")}`;
}

function oku(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const amount = value / JPY_PER_OKU;
  return `${amount.toLocaleString("ja-JP", {
    maximumFractionDigits: amount >= 100 ? 0 : 2,
  })} 億円`;
}

function optionalMan(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * JPY_PER_MAN : null;
}

function targetLabel(value: number | null) {
  return value === null ? "目標未設定" : `目標 ${yen(value)}`;
}

function parseRate(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= -50 && parsed <= 100
    ? parsed
    : null;
}

function durationLabel(months: number | null) {
  if (months === null) return "算出不可";
  if (months === 0) return "達成済み";
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years === 0) return `あと${remainingMonths}か月`;
  if (remainingMonths === 0) return `あと${years}年`;
  return `あと${years}年${remainingMonths}か月`;
}

function monthLabel(value: string | null) {
  if (!value) return null;
  const [year, month] = value.split("-");
  return year && month ? `${year}年${Number(month)}月` : value;
}

export function LongTermGoalCard(props: Props) {
  const utils = trpc.useUtils();
  const settings = trpc.portfolio.settings.useQuery();
  const [open, setOpen] = useState(false);
  const [targetOku, setTargetOku] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [dividendMan, setDividendMan] = useState("");
  const [interestMan, setInterestMan] = useState("");
  const [netCashMan, setNetCashMan] = useState("");
  const [contributionMan, setContributionMan] = useState("");
  const [conservativePct, setConservativePct] = useState(
    String(DEFAULT_LONG_TERM_SCENARIO_RATES.conservative)
  );
  const [basePct, setBasePct] = useState(
    String(DEFAULT_LONG_TERM_SCENARIO_RATES.base)
  );
  const [optimisticPct, setOptimisticPct] = useState(
    String(DEFAULT_LONG_TERM_SCENARIO_RATES.optimistic)
  );

  useEffect(() => {
    const data = settings.data;
    if (!data) return;
    setTargetOku(
      data.longTermTargetNetAssetsJpy
        ? String(Number(data.longTermTargetNetAssetsJpy) / JPY_PER_OKU)
        : ""
    );
    setTargetDate(data.longTermTargetDate ?? "");
    setDividendMan(
      data.longTermTargetAnnualDividendJpy
        ? String(Number(data.longTermTargetAnnualDividendJpy) / JPY_PER_MAN)
        : ""
    );
    setInterestMan(
      data.longTermTargetAnnualInterestJpy
        ? String(Number(data.longTermTargetAnnualInterestJpy) / JPY_PER_MAN)
        : ""
    );
    setNetCashMan(
      data.longTermTargetAnnualNetCashJpy
        ? String(Number(data.longTermTargetAnnualNetCashJpy) / JPY_PER_MAN)
        : ""
    );
    setContributionMan(
      data.longTermAnnualContributionJpy
        ? String(Number(data.longTermAnnualContributionJpy) / JPY_PER_MAN)
        : ""
    );
    setConservativePct(
      data.longTermScenarioConservativePct ??
        String(DEFAULT_LONG_TERM_SCENARIO_RATES.conservative)
    );
    setBasePct(
      data.longTermScenarioBasePct ?? String(DEFAULT_LONG_TERM_SCENARIO_RATES.base)
    );
    setOptimisticPct(
      data.longTermScenarioOptimisticPct ??
        String(DEFAULT_LONG_TERM_SCENARIO_RATES.optimistic)
    );
  }, [settings.data]);

  const progress = useMemo(
    () =>
      buildLongTermGoalProgress({
        currentNetAssetsJpy: props.currentNetAssetsJpy,
        stockAssetsJpy: props.stockAssetsJpy,
        cashJpy: props.cashJpy,
        interestAssetsJpy: props.interestAssetsJpy,
        borrowedPrincipalJpy: props.borrowedPrincipalJpy,
        targetNetAssetsJpy: settings.data?.longTermTargetNetAssetsJpy
          ? Number(settings.data.longTermTargetNetAssetsJpy)
          : null,
        targetDate: settings.data?.longTermTargetDate ?? null,
        annualDividendJpy: props.annualDividendJpy,
        annualInterestIncomeJpy: props.annualInterestIncomeJpy,
        annualBorrowingInterestJpy: props.annualBorrowingInterestJpy,
        targetAnnualDividendJpy: settings.data?.longTermTargetAnnualDividendJpy
          ? Number(settings.data.longTermTargetAnnualDividendJpy)
          : null,
        targetAnnualInterestJpy: settings.data?.longTermTargetAnnualInterestJpy
          ? Number(settings.data.longTermTargetAnnualInterestJpy)
          : null,
        targetAnnualNetCashJpy: settings.data?.longTermTargetAnnualNetCashJpy
          ? Number(settings.data.longTermTargetAnnualNetCashJpy)
          : null,
        annualContributionJpy: settings.data?.longTermAnnualContributionJpy
          ? Number(settings.data.longTermAnnualContributionJpy)
          : null,
        conservativeReturnPct:
          settings.data?.longTermScenarioConservativePct === null ||
          settings.data?.longTermScenarioConservativePct === undefined
            ? null
            : Number(settings.data.longTermScenarioConservativePct),
        baseReturnPct:
          settings.data?.longTermScenarioBasePct === null ||
          settings.data?.longTermScenarioBasePct === undefined
            ? null
            : Number(settings.data.longTermScenarioBasePct),
        optimisticReturnPct:
          settings.data?.longTermScenarioOptimisticPct === null ||
          settings.data?.longTermScenarioOptimisticPct === undefined
            ? null
            : Number(settings.data.longTermScenarioOptimisticPct),
      }),
    [props, settings.data]
  );
  const netAssetsTrend = props.cashIncome?.forecast.netAssets ?? null;
  const actualIncome = props.cashIncome?.actual ?? null;

  const update = trpc.portfolio.updateSettings.useMutation({
    onSuccess: async () => {
      await utils.portfolio.settings.invalidate();
      setOpen(false);
      toast.success("長期目標を保存しました");
    },
    onError: error => toast.error(error.message),
  });

  const save = () => {
    const parsedOku = Number(targetOku);
    if (!Number.isFinite(parsedOku) || parsedOku <= 0) {
      toast.error("目標純資産を正しく入力してください");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      toast.error("目標日を入力してください");
      return;
    }
    const parsedConservative = parseRate(conservativePct);
    const parsedBase = parseRate(basePct);
    const parsedOptimistic = parseRate(optimisticPct);
    if (
      parsedConservative === null ||
      parsedBase === null ||
      parsedOptimistic === null
    ) {
      toast.error("情景年率は -50%〜100% で入力してください");
      return;
    }
    if (!(parsedConservative <= parsedBase && parsedBase <= parsedOptimistic)) {
      toast.error("情景年率は 保守 ≤ 基準 ≤ 楽観 の順にしてください");
      return;
    }
    update.mutate({
      longTermTargetNetAssetsJpy: parsedOku * JPY_PER_OKU,
      longTermTargetDate: targetDate,
      longTermTargetAnnualDividendJpy: optionalMan(dividendMan),
      longTermTargetAnnualInterestJpy: optionalMan(interestMan),
      longTermTargetAnnualNetCashJpy: optionalMan(netCashMan),
      longTermAnnualContributionJpy: optionalMan(contributionMan),
      longTermScenarioConservativePct: parsedConservative,
      longTermScenarioBasePct: parsedBase,
      longTermScenarioOptimisticPct: parsedOptimistic,
    });
  };

  if (settings.isLoading) {
    return <div className="h-52 animate-pulse rounded-2xl border bg-muted/30" />;
  }

  return (
    <Card className="overflow-hidden border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 via-background to-amber-50/50 shadow-sm dark:border-emerald-900/60 dark:from-emerald-950/20 dark:to-amber-950/10">
      <CardHeader className="gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-emerald-700 dark:text-emerald-300">
            LONG-TERM NORTH STAR
          </p>
          <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
            <Target className="h-5 w-5 text-emerald-700" />
            長期目標
            {progress.status === "HIGH_CHALLENGE" ? (
              <Badge variant="outline" className="border-amber-300 text-amber-700">
                高い挑戦目標
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            目標は進捗確認だけに使い、売買順位や提案を変えません。
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="bg-background/80">
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              目標を編集
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>長期目標を編集</DialogTitle>
              <DialogDescription>
                純資産は株式・現金性資産・現金から借入を差し引く口径です。入金と収入目標は任意です。
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="goal-net-assets">目標純資産（億円）</Label>
                <Input id="goal-net-assets" type="number" inputMode="decimal" min="0" value={targetOku} onChange={event => setTargetOku(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-date">目標日</Label>
                <Input id="goal-date" type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-dividend">年間配当目標（万円・任意）</Label>
                <Input id="goal-dividend" type="number" inputMode="decimal" min="0" value={dividendMan} onChange={event => setDividendMan(event.target.value)} placeholder="未設定" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="goal-interest">年間利息目標（万円・任意）</Label>
                <Input id="goal-interest" type="number" inputMode="decimal" min="0" value={interestMan} onChange={event => setInterestMan(event.target.value)} placeholder="未設定" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="goal-net-cash">年間純キャッシュ収入目標（万円・任意）</Label>
                <Input id="goal-net-cash" type="number" inputMode="decimal" min="0" value={netCashMan} onChange={event => setNetCashMan(event.target.value)} placeholder="配当＋利息－借入利息" />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="goal-contribution">年間追加入金計画（万円・任意）</Label>
                <Input id="goal-contribution" type="number" inputMode="decimal" min="0" value={contributionMan} onChange={event => setContributionMan(event.target.value)} placeholder="未設定なら0円で試算" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  試算では年間額を12等分し、毎月末に入金する前提です。投資収益とは分けて表示します。
                </p>
              </div>
              <div className="space-y-3 rounded-xl border bg-muted/25 p-3 sm:col-span-2">
                <div>
                  <p className="text-sm font-medium">達成情景の名目年率</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    年率は予測ではなく編集可能な試算条件です。保守 ≤ 基準 ≤ 楽観の順で設定します。
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-rate-conservative">保守（%）</Label>
                    <Input id="goal-rate-conservative" type="number" inputMode="decimal" min="-50" max="100" value={conservativePct} onChange={event => setConservativePct(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-rate-base">基準（%）</Label>
                    <Input id="goal-rate-base" type="number" inputMode="decimal" min="-50" max="100" value={basePct} onChange={event => setBasePct(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="goal-rate-optimistic">楽観（%）</Label>
                    <Input id="goal-rate-optimistic" type="number" inputMode="decimal" min="-50" max="100" value={optimisticPct} onChange={event => setOptimisticPct(event.target.value)} />
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                キャンセル
              </Button>
              <Button type="button" disabled={update.isPending} onClick={save}>
                {update.isPending ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        {progress.configured ? (
          <>
            <div className="grid gap-3 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="rounded-xl border bg-background/75 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">現在の純資産（評価額）</p>
                    <p className="tabular mt-1 break-all text-2xl font-semibold sm:text-3xl">
                      {yen(progress.currentNetAssetsJpy)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{oku(progress.currentNetAssetsJpy)}</p>
                    <p className="mt-3 text-[11px] font-medium text-muted-foreground">
                      純資産の評価変動（未確定を含む）
                    </p>
                    <div className="mt-3 grid gap-1 text-xs sm:grid-cols-3">
                      <TrendLine label="前日／前回比" amount={netAssetsTrend?.dayChangeJpy ?? null} pct={netAssetsTrend?.dayChangePct ?? null} unavailable="前回値未取得" />
                      <TrendLine label="7日比" amount={netAssetsTrend?.sevenDayChangeJpy ?? null} pct={netAssetsTrend?.sevenDayChangePct ?? null} unavailable="7日前未取得" basisDate={netAssetsTrend?.sevenDayAsOfDate ?? null} />
                      <TrendLine label="30日比" amount={netAssetsTrend?.thirtyDayChangeJpy ?? null} pct={netAssetsTrend?.thirtyDayChangePct ?? null} unavailable="30日前未取得" basisDate={netAssetsTrend?.thirtyDayAsOfDate ?? null} />
                    </div>
                    {netAssetsTrend?.previousJpy !== null && netAssetsTrend?.previousJpy !== undefined ? <p className="mt-2 text-[11px] text-muted-foreground">前日純資産 {yen(netAssetsTrend.previousJpy)}（{netAssetsTrend.previousAsOfDate}）</p> : null}
                    <p className="mt-2 max-w-2xl text-[10px] leading-relaxed text-muted-foreground">
                      前日・7日・30日の数字は純資産総額の差です。株価・為替・入出金・現金性資産・借入などを含み、確定した利益や実際の入金だけを示すものではありません。
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">目標</p>
                    <p className="tabular mt-1 text-lg font-semibold text-emerald-800 dark:text-emerald-200">
                      {oku(progress.targetNetAssetsJpy)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {progress.targetDate} まで
                    </p>
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950">
                  <div
                    className="h-full rounded-full bg-emerald-600"
                    style={{ width: `${Math.min(100, Math.max(0.7, progress.progressPct ?? 0))}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
                  <span className="tabular font-semibold">
                    達成率 {(progress.progressPct ?? 0).toFixed(2)}%
                  </span>
                  <span className="text-muted-foreground">
                    残り {oku(progress.remainingJpy)}・{progress.daysRemaining?.toLocaleString("ja-JP")}日
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
                  <Flag className="h-3.5 w-3.5" />
                  入金を含めない単純必要年率
                </p>
                <p className="tabular mt-2 text-2xl font-semibold text-amber-900 dark:text-amber-100">
                  {progress.requiredAnnualGrowthPct === null
                    ? "算出不可"
                    : `${progress.requiredAnnualGrowthPct.toFixed(1)}%`}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-amber-800/80 dark:text-amber-200/80">
                  追加入金を考慮しない難易度の目安です。この数字を達成するための借入・短期売買は提案しません。
                </p>
              </div>
            </div>

            <div className="rounded-xl border bg-background/75 p-4" data-testid="return-classification">
              <div>
                <p className="text-sm font-semibold">利益の種類を分けて表示</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  株式は売却前の含み損益、現金宝利息と配当は付与・入金が記録された分だけを確定収益として表示します。
                </p>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <p className="text-[11px] text-muted-foreground">株式：含み損益</p>
                    <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-200">
                      未実現
                    </Badge>
                  </div>
                  <p className={`tabular mt-1 text-lg font-semibold ${(props.unrealizedPnlJpy ?? 0) < 0 ? "text-loss" : "text-emerald-700"}`}>
                    {yen(props.unrealizedPnlJpy)}
                  </p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    現在価格による評価損益。売却前のため確定収益ではありません。
                  </p>
                </div>
                <ConfirmedIncomeBox
                  label="現金宝：前回スクショ以降の確定利息"
                  metric={
                    actualIncome?.confirmedInterestFromScreenshots ??
                    actualIncome?.interestYtd
                  }
                />
                <ConfirmedIncomeBox label="株式：入金済み配当" metric={actualIncome?.dividendYtd} />
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                純資産差のうち、株価・為替・入出金・借入の寄与は同時点の明細が揃うまで分解しません。純資産差から推測して埋めることもしません。
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold">将来予想（未確定）</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  現在の保有株数・残高・記録利率からのランレートです。実際に付与・入金されるまでは確定収益ではありません。
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <IncomeBox label="未来の配当予想（税引前）" current={progress.annualDividend.currentJpy} target={progress.annualDividend.targetJpy} progressPct={progress.annualDividend.progressPct} runRate={props.cashIncome?.forecast.dividendRunRate} />
                <IncomeBox label="未来の利息予想" current={progress.annualInterest.currentJpy} target={progress.annualInterest.targetJpy} progressPct={progress.annualInterest.progressPct} runRate={props.cashIncome?.forecast.interestRunRate} />
                <IncomeBox label="借入利息予想" current={progress.annualBorrowingInterestJpy} target={null} negative runRate={props.cashIncome?.forecast.borrowingRunRate} />
                <IncomeBox label="未来の純キャッシュ収入予想" current={progress.annualNetCash.currentJpy} target={progress.annualNetCash.targetJpy} progressPct={progress.annualNetCash.progressPct} emphasized runRate={props.cashIncome?.forecast.netCashRunRate} />
              </div>
            </div>

            <div className="rounded-xl border bg-background/75 p-4" data-testid="long-term-scenarios">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">2030年末の3つの複利・再投資情景</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    株価変動、配当の全額再投資、現金宝の日次複利、借入利息、毎月入金を分けて積み上げる数学試算です。
                  </p>
                </div>
                <div className="text-left text-xs sm:text-right">
                  <p className="text-muted-foreground">年間追加入金</p>
                  <p className="tabular font-semibold">
                    {settings.data?.longTermAnnualContributionJpy
                      ? yen(progress.annualContributionJpy)
                      : "未設定（0円で試算）"}
                  </p>
                  {progress.scenarioRatesDefaulted ? (
                    <p className="mt-1 text-[11px] text-amber-700">標準仮定 4% / 8% / 12%</p>
                  ) : null}
                </div>
              </div>
              <div
                className="mt-4 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/15"
                data-testid="long-term-projection-basis"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold">今回から試算へ自動反映するもの</p>
                  <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700">
                    配当は全額再投資
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-4">
                  <ProjectionBasisItem
                    label="株式時価"
                    value={yen(progress.projectionBasis.stockAssetsJpy)}
                    detail={`予想配当 ${yen(progress.projectionBasis.annualDividendJpy)} / 年（税引前）・利回り ${progress.projectionBasis.dividendYieldPct?.toFixed(2) ?? "—"}%`}
                  />
                  <ProjectionBasisItem
                    label="現金宝・貨幣基金"
                    value={yen(progress.projectionBasis.interestAssetsJpy)}
                    detail={`日次複利・実効年率 ${progress.projectionBasis.interestEffectiveRatePct?.toFixed(2) ?? "—"}%`}
                  />
                  <ProjectionBasisItem
                    label="通常現金"
                    value={yen(progress.projectionBasis.cashJpy)}
                    detail="利息を付けず横ばい"
                  />
                  <ProjectionBasisItem
                    label="借入（返済しない前提）"
                    value={yen(progress.projectionBasis.borrowedPrincipalJpy)}
                    detail={`利息 ${yen(progress.projectionBasis.annualBorrowingInterestJpy)} / 年を控除`}
                  />
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                  配当は現在の税引前予想配当利回りを一定と置き、毎月末に株式へ全額再投資します。現金宝は現在の残高と確認済み日次収益からの実効年率で独立して複利計算します。入金済み配当の実績とは別で、予想を確定収益にはしません。
                </p>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {progress.scenarios.map(scenario => (
                  <ScenarioCard
                    key={scenario.key}
                    scenario={scenario}
                    currentMonthlyContributionJpy={progress.annualContributionJpy / 12}
                  />
                ))}
              </div>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              ここでの収入達成率は「現在保有の配当予想＋現金宝の利息予想－借入利息予想」の未来ランレートです。実際に入金済みの金額は上の実績欄で別に確認し、純資産へ重ねて加算しません。
            </p>
          </>
        ) : (
          <div className="rounded-xl border border-dashed bg-background/70 p-5 text-sm text-muted-foreground">
            目標純資産と目標日がまだ設定されていません。「目標を編集」から登録できます。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmedIncomeBox({
  label,
  metric,
}: {
  label: string;
  metric: ActualIncomeMetric | undefined;
}) {
  const status = metric?.status ?? "UNAVAILABLE";
  const statusLabel =
    status === "AVAILABLE"
      ? "確定"
      : status === "PARTIAL"
        ? "確定（記録範囲）"
        : "未連携";
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700 dark:border-emerald-800 dark:text-emerald-200">
          {statusLabel}
        </Badge>
      </div>
      <p className="tabular mt-1 text-lg font-semibold text-emerald-700">
        {yen(metric?.amountJpy)}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {metric?.lastDate
          ? metric.periodStartDate
            ? `${metric.periodStartDate}→${metric.lastDate}の累計差額`
            : `${metric.lastDate}基準の確認済み記録`
          : label.includes("配当")
            ? "入金実績は未連携。保有株からの予想は下段に分離"
            : "付与実績の記録がまだありません"}
      </p>
    </div>
  );
}

function IncomeBox({
  label,
  current,
  target,
  negative = false,
  emphasized = false,
  progressPct = null,
  runRate,
}: {
  label: string;
  current: number | null;
  target: number | null;
  negative?: boolean;
  emphasized?: boolean;
  progressPct?: number | null;
  runRate?: ForecastRunRateMetric;
}) {
  return (
    <div className={`rounded-lg border p-3 ${emphasized ? "bg-emerald-50/70 dark:bg-emerald-950/20" : "bg-background/70"}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`tabular mt-1 text-base font-semibold ${negative ? "text-loss" : emphasized ? "text-emerald-800 dark:text-emerald-200" : ""}`}>
        {negative && current !== null ? "−" : ""}{yen(current)}
      </p>
      {runRate ? <div className="mt-2 space-y-0.5 text-[11px] text-muted-foreground"><p>年額 {yen(runRate.annualJpy)}</p><p>月額換算 {yen(runRate.monthlyJpy)}</p><p>日額換算 {yen(runRate.dailyJpy)} <span className="text-[10px]">（予想÷365、実入金ではありません）</span></p><p>予想年額の前日比 {runRate.annualDayChangeJpy === null ? "未取得" : `${runRate.annualDayChangeJpy >= 0 ? "+" : ""}${yen(runRate.annualDayChangeJpy)}`}</p></div> : null}
      <p className="mt-1 text-[11px] text-muted-foreground">{targetLabel(target)}</p>
      {progressPct !== null ? (
        <p className="tabular mt-1 text-[11px] font-medium text-emerald-700">
          目標達成率 {progressPct.toFixed(1)}%
        </p>
      ) : null}
    </div>
  );
}

function TrendLine({
  label,
  amount,
  pct,
  unavailable,
  basisDate = null,
}: {
  label: string;
  amount: number | null;
  pct: number | null;
  unavailable: string;
  basisDate?: string | null;
}) {
  if (amount === null)
    return <p className="text-muted-foreground">{label} {unavailable}</p>;
  const positive = amount >= 0;
  return (
    <p className={`tabular font-medium ${positive ? "text-emerald-700" : "text-loss"}`}>
      {label}{basisDate ? `（${basisDate}基準）` : ""} {positive ? "+" : ""}{yen(amount)} {pct === null ? "" : `(${positive ? "+" : ""}${pct.toFixed(2)}%)`}
    </p>
  );
}

function ProjectionBasisItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-background/75 p-2.5">
      <p className="text-muted-foreground">{label}</p>
      <p className="tabular mt-0.5 break-all text-sm font-semibold">{value}</p>
      <p className="mt-1 leading-relaxed text-muted-foreground">{detail}</p>
    </div>
  );
}

function ScenarioCard({
  scenario,
  currentMonthlyContributionJpy,
}: {
  scenario: LongTermGoalScenario;
  currentMonthlyContributionJpy: number;
}) {
  const tone =
    scenario.key === "BASE"
      ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
      : "bg-background/80";
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{scenario.label}</p>
        <Badge variant="outline" className="tabular">
          株価年率 {scenario.annualReturnPct.toFixed(1)}%
        </Badge>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">目標日の試算純資産</p>
      <p className="tabular mt-1 text-xl font-semibold">
        {oku(scenario.projectedNetAssetsJpy)}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="tabular font-medium">
          目標達成率 {scenario.targetProgressPct?.toFixed(2) ?? "—"}%
        </span>
        <Badge variant={scenario.achievesTarget ? "default" : "secondary"}>
          {scenario.achievesTarget ? "達成試算" : "未達試算"}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-[11px]">
        <div>
          <p className="text-muted-foreground">追加入金元本</p>
          <p className="tabular mt-0.5 font-medium">{oku(scenario.totalContributionJpy)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">収益等の純寄与</p>
          <p className="tabular mt-0.5 font-medium">{oku(scenario.investmentGrowthJpy)}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border bg-background/60 p-2.5 text-[10px]">
        <div>
          <p className="text-muted-foreground">株価変動</p>
          <p className="tabular mt-0.5 font-medium">{signedYen(scenario.stockPriceChangeJpy)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">配当再投資</p>
          <p className="tabular mt-0.5 font-medium text-emerald-700">{signedYen(scenario.reinvestedDividendJpy)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">現金宝複利</p>
          <p className="tabular mt-0.5 font-medium text-emerald-700">{signedYen(scenario.compoundedInterestJpy)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">借入利息</p>
          <p className="tabular mt-0.5 font-medium text-loss">{signedYen(scenario.borrowingInterestCostJpy === null ? null : -scenario.borrowingInterestCostJpy)}</p>
        </div>
      </div>
      <div className="mt-3 space-y-2 rounded-lg bg-muted/40 p-2.5 text-[11px]">
        <div>
          <p className="text-muted-foreground">
            現在の入金計画（{oku(currentMonthlyContributionJpy)} / 月）での到達目安
          </p>
          {scenario.attainmentStatus === "ESTIMATED" ? (
            <p className="tabular mt-0.5 font-semibold">
              {monthLabel(scenario.estimatedTargetMonth)}・{durationLabel(scenario.estimatedMonthsToTarget)}
            </p>
          ) : scenario.attainmentStatus === "ALREADY_ACHIEVED" ? (
            <p className="mt-0.5 font-semibold text-emerald-700">達成済み</p>
          ) : scenario.attainmentStatus === "BEYOND_HORIZON" ? (
            <p className="mt-0.5 font-semibold text-amber-700">100年以内に到達しない試算</p>
          ) : (
            <p className="mt-0.5 font-semibold text-muted-foreground">算出不可</p>
          )}
        </div>
        <div className="border-t pt-2">
          <p className="text-muted-foreground">2030年までに必要な月次入金</p>
          <p className="tabular mt-0.5 font-semibold">
            {scenario.requiredMonthlyContributionJpy === null
              ? "算出不可"
              : `${oku(scenario.requiredMonthlyContributionJpy)} / 月`}
          </p>
          {scenario.additionalMonthlyContributionJpy !== null ? (
            <p className="tabular mt-0.5 text-muted-foreground">
              現在計画との差 +{oku(scenario.additionalMonthlyContributionJpy)} / 月
            </p>
          ) : null}
        </div>
      </div>
      {!scenario.achievesTarget ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          目標まで {oku(scenario.gapJpy)}
        </p>
      ) : null}
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        配当・現金宝は現在ランレート一定、借入元本は返済しない前提の数学試算です。実現収益ではありません。
      </p>
    </div>
  );
}
