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
import { Flag, Pencil, ShieldCheck, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  currentNetAssetsJpy: number | null | undefined;
  annualDividendJpy: number | null | undefined;
  annualInterestIncomeJpy: number | null | undefined;
  annualBorrowingInterestJpy: number | null | undefined;
};

const JPY_PER_OKU = 100_000_000;
const JPY_PER_MAN = 10_000;

function yen(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
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
                    <p className="text-xs text-muted-foreground">現在の純資産</p>
                    <p className="tabular mt-1 text-2xl font-semibold">
                      {oku(progress.currentNetAssetsJpy)}
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

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <IncomeBox label="現在の年間配当（税引前）" current={progress.annualDividend.currentJpy} target={progress.annualDividend.targetJpy} progressPct={progress.annualDividend.progressPct} />
              <IncomeBox label="年間利息（見込み）" current={progress.annualInterest.currentJpy} target={progress.annualInterest.targetJpy} progressPct={progress.annualInterest.progressPct} />
              <IncomeBox label="借入の年間利息" current={progress.annualBorrowingInterestJpy} target={null} negative />
              <IncomeBox label="年間純キャッシュ収入" current={progress.annualNetCash.currentJpy} target={progress.annualNetCash.targetJpy} progressPct={progress.annualNetCash.progressPct} emphasized />
            </div>

            <div className="rounded-xl border bg-background/75 p-4" data-testid="long-term-scenarios">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">2030年末の3つの達成情景</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    年間入金を12等分して毎月末に積み立て、名目年率で月次複利計算します。予測ではありません。
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
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {progress.scenarios.map(scenario => (
                  <ScenarioCard key={scenario.key} scenario={scenario} />
                ))}
              </div>
            </div>

            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              純キャッシュ収入は「税引前配当＋利息収入－借入利息」の概算です。税金・手数料・為替差損益は含みません。
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

function IncomeBox({
  label,
  current,
  target,
  negative = false,
  emphasized = false,
  progressPct = null,
}: {
  label: string;
  current: number | null;
  target: number | null;
  negative?: boolean;
  emphasized?: boolean;
  progressPct?: number | null;
}) {
  return (
    <div className={`rounded-lg border p-3 ${emphasized ? "bg-emerald-50/70 dark:bg-emerald-950/20" : "bg-background/70"}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`tabular mt-1 text-base font-semibold ${negative ? "text-loss" : emphasized ? "text-emerald-800 dark:text-emerald-200" : ""}`}>
        {negative && current !== null ? "−" : ""}{yen(current)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{targetLabel(target)}</p>
      {progressPct !== null ? (
        <p className="tabular mt-1 text-[11px] font-medium text-emerald-700">
          目標達成率 {progressPct.toFixed(1)}%
        </p>
      ) : null}
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: LongTermGoalScenario }) {
  const tone =
    scenario.key === "BASE"
      ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
      : "bg-background/80";
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{scenario.label}</p>
        <Badge variant="outline" className="tabular">
          年率仮定 {scenario.annualReturnPct.toFixed(1)}%
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
          <p className="text-muted-foreground">投資増減寄与</p>
          <p className="tabular mt-0.5 font-medium">{oku(scenario.investmentGrowthJpy)}</p>
        </div>
      </div>
      {!scenario.achievesTarget ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          目標まで {oku(scenario.gapJpy)}
        </p>
      ) : null}
    </div>
  );
}
