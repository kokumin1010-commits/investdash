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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import type {
  ActualIncomeMetric,
  CashIncomeOverview,
  CashIncomeStatus,
} from "@shared/cashIncome";
import { BROKERS, BROKER_LABELS, type Broker } from "@shared/investing";
import {
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ImagePlus,
  Landmark,
  PenLine,
  PiggyBank,
  ReceiptText,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type Props = {
  data: CashIncomeOverview;
  interestAssetsJpy: number | null | undefined;
  interestRatePct: number | null | undefined;
};

function yen(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "未取得";
  }
  const prefix = value < 0 ? "−" : "";
  return `${prefix}¥${Math.round(Math.abs(value)).toLocaleString("ja-JP")}`;
}

function dateText(value: string | null) {
  if (!value) return "日付未取得";
  const [year, month, day] = value.split("-");
  return `${year}/${Number(month)}/${Number(day)}`;
}

function statusText(status: CashIncomeStatus) {
  if (status === "AVAILABLE") return "実績";
  if (status === "PARTIAL") return "記録分";
  return "未連携";
}

function statusClass(status: CashIncomeStatus) {
  if (status === "AVAILABLE") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200";
  }
  if (status === "PARTIAL") {
    return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }
  return "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300";
}

function ActualBox({
  label,
  metric,
  helper,
  emphasize = false,
}: {
  label: string;
  metric: ActualIncomeMetric;
  helper?: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border p-3 ${
        emphasize
          ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20"
          : "bg-background/80"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <Badge variant="outline" className={`text-[10px] ${statusClass(metric.status)}`}>
          {statusText(metric.status)}
        </Badge>
      </div>
      <p className="tabular mt-1 text-lg font-semibold">
        {yen(metric.amountJpy)}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {metric.lastDate ? `${dateText(metric.lastDate)} 基準` : helper ?? metric.sourceLabel}
        {metric.recordedDays > 0 ? `・${metric.recordedDays}日分` : ""}
      </p>
    </div>
  );
}

function ForecastBox({
  label,
  value,
  basis,
  status = "AVAILABLE",
  negative = false,
  emphasize = false,
  unavailableLabel = "未取得",
}: {
  label: string;
  value: number | null;
  basis: string;
  status?: CashIncomeStatus;
  negative?: boolean;
  emphasize?: boolean;
  unavailableLabel?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border p-3 ${
        emphasize
          ? "border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20"
          : "bg-background/80"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <Badge
          variant="outline"
          className={`text-[10px] ${
            status === "AVAILABLE"
              ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
              : statusClass(status)
          }`}
        >
          {status === "AVAILABLE"
            ? "未来予想"
            : status === "PARTIAL"
              ? "一部取得"
              : "未取得"}
        </Badge>
      </div>
      <p className={`tabular mt-1 text-lg font-semibold ${negative ? "text-loss" : ""}`}>
        {value === null
          ? unavailableLabel
          : negative
            ? `−${yen(Math.abs(value))}`
            : yen(value)}
      </p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
        {basis}
      </p>
    </div>
  );
}

function actualMetric(
  amountJpy: number | null,
  status: CashIncomeStatus,
  sourceLabel: string,
  asOfDate: string
): ActualIncomeMetric {
  return {
    amountJpy,
    status,
    recordCount: 0,
    recordedDays: 0,
    lastDate: asOfDate,
    sourceLabel,
  };
}

export function CashIncomeCard({ data, interestAssetsJpy, interestRatePct }: Props) {
  const actual = data.actual;
  const forecast = data.forecast;
  const annualBorrowing = forecast.annualBorrowingInterestJpy;
  const annualNet = forecast.annualNetCashJpy;

  return (
    <Card data-testid="cash-income-actual-forecast" className="scroll-mt-20 overflow-hidden border-emerald-200/70 shadow-sm dark:border-emerald-900/60">
      <CardHeader className="gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
            REALIZED / FORECAST
          </p>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <CircleDollarSign className="h-5 w-5 text-emerald-700" />
            キャッシュ収入：実績と予想
          </CardTitle>
          <CardDescription className="max-w-3xl leading-relaxed">
            実際に付与・入金された金額と、現在残高／保有株数からの未来予想を分けています。
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild type="button" size="sm">
            <Link href="/import">
              <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
              スクショから自動計算
            </Link>
          </Button>
          <DividendIncomeDialog />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-3" aria-labelledby="actual-income-heading">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="actual-income-heading" className="flex items-center gap-1.5 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                実際に増えた金額
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                記録済みの利息付与と証券口座の配当入金のみ。未記録日は補いません。
              </p>
            </div>
            <Badge variant="secondary" className="tabular text-[10px]">
              {actual.asOfDate} 時点
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <ActualBox
              label="本年の実績収入（記録分）"
              emphasize
              metric={actualMetric(
                actual.recordedGrossIncomeYtdJpy,
                actual.recordedGrossIncomeYtdStatus,
                "日次利息＋入金済み配当",
                actual.asOfDate
              )}
            />
            <ActualBox label="最新記録の日次利息" metric={actual.latestDailyInterest} />
            <ActualBox
              label="本年の入金済み配当"
              metric={actual.dividendYtd}
              helper="証券口座の実際入金は未連携"
            />
            <ActualBox label="現金宝の累計利息" metric={actual.lifetimeInterest} />
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <ActualBox
              label="今月の現金宝利息"
              metric={actual.interestMtd}
              helper="今月の記録はありません"
            />
            <ActualBox
              label="今月の入金済み配当"
              metric={actual.dividendMtd}
              helper="証券口座の実際入金は未連携"
            />
            <ActualBox
              label="借入利息（月初来実績）"
              metric={actual.borrowingInterestMtd}
              helper="証券口座の実績は未取得"
            />
          </div>

          <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
            {actual.note} 現金宝の利息は最新残高に含まれるため、純資産へもう一度加算しません。
          </p>
        </section>

        <section className="space-y-3 border-t pt-5" aria-labelledby="forecast-income-heading">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="forecast-income-heading" className="flex items-center gap-1.5 text-sm font-semibold">
                <CalendarDays className="h-4 w-4 text-sky-700" />
                未来1年間の予想
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                目標比較用のランレートです。実際の入金や現在資産の増加ではありません。
              </p>
            </div>
            <Badge variant="outline" className="border-sky-200 text-[10px] text-sky-700 dark:border-sky-900 dark:text-sky-200">
              {forecast.asOfDate} 基準
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <ForecastBox
              label="年間配当予想（税引前）"
              value={forecast.annualDividendJpy}
              status={forecast.annualDividendStatus}
              basis={forecast.dividendBasis}
            />
            <ForecastBox
              label="現金宝の年間利息予想"
              value={forecast.annualInterestJpy}
              status={forecast.annualInterestStatus}
              basis={forecast.interestBasis}
            />
            <ForecastBox
              label="借入の年間利息予想"
              value={annualBorrowing}
              status={forecast.annualBorrowingInterestStatus}
              basis={forecast.borrowingBasis}
              negative
            />
            <ForecastBox
              label="年間純キャッシュ収入予想"
              value={annualNet}
              status={forecast.annualNetCashStatus}
              basis="配当予想＋現金宝利息予想−借入利息予想"
              emphasize
              unavailableLabel="算定不可"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-muted/35 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <PiggyBank className="h-3.5 w-3.5" />
              計息元本 {yen(interestAssetsJpy)}
            </span>
            <span className="tabular">
              記録年率 {interestRatePct === null || interestRatePct === undefined ? "未取得" : `${interestRatePct.toFixed(2)}%`}
            </span>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function DividendIncomeDialog() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [occurredOn, setOccurredOn] = useState("");
  const [broker, setBroker] = useState<Broker>("futu_hk");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [gross, setGross] = useState("");
  const [tax, setTax] = useState("0");
  const [fee, setFee] = useState("0");
  const [reference, setReference] = useState("");

  const netPreview = useMemo(() => {
    const grossValue = Number(gross);
    const taxValue = Number(tax || 0);
    const feeValue = Number(fee || 0);
    if (![grossValue, taxValue, feeValue].every(Number.isFinite)) return null;
    return grossValue - taxValue - feeValue;
  }, [fee, gross, tax]);

  const mutation = trpc.portfolio.recordDividendIncome.useMutation({
    onSuccess: async () => {
      await utils.portfolio.overview.invalidate();
      setOpen(false);
      setOccurredOn("");
      setSymbol("");
      setName("");
      setGross("");
      setTax("0");
      setFee("0");
      setReference("");
      toast.success("実際の配当入金を記録しました");
    },
    onError: error => toast.error(error.message),
  });

  const save = () => {
    const grossAmount = Number(gross);
    const taxAmount = Number(tax || 0);
    const feeAmount = Number(fee || 0);
    if (!occurredOn || !name.trim() || !Number.isFinite(grossAmount) || grossAmount <= 0) {
      toast.error("入金日・名称・配当総額を入力してください");
      return;
    }
    if (
      !Number.isFinite(taxAmount) ||
      !Number.isFinite(feeAmount) ||
      taxAmount < 0 ||
      feeAmount < 0 ||
      grossAmount - taxAmount - feeAmount < 0
    ) {
      toast.error("税・手数料を確認してください");
      return;
    }
    mutation.mutate({
      requestId: crypto.randomUUID(),
      occurredOn,
      broker,
      symbol: symbol.trim() || undefined,
      name: name.trim(),
      currency: currency.trim().toUpperCase(),
      grossAmount,
      taxAmount,
      feeAmount,
      sourceReference: reference.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="bg-background/90">
          <PenLine className="mr-1.5 h-3.5 w-3.5" />
          手入力
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5" />
            配当入金を手入力
          </DialogTitle>
          <DialogDescription>
            スクショで読み取れない場合だけ使う例外入力です。証券口座に実際に入金された金額だけを登録し、予想配当は登録しません。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="income-date">入金日</Label>
            <Input id="income-date" type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-broker">証券口座</Label>
            <Select value={broker} onValueChange={value => setBroker(value as Broker)}>
              <SelectTrigger id="income-broker">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BROKERS.map(value => (
                  <SelectItem key={value} value={value}>
                    {BROKER_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-symbol">銘柄コード（任意）</Label>
            <Input id="income-symbol" value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="例: TXN / 8058.T" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-name">銘柄・配当名</Label>
            <Input id="income-name" value={name} onChange={event => setName(event.target.value)} placeholder="例: Texas Instruments 配当" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-currency">通貨</Label>
            <Input id="income-currency" value={currency} maxLength={8} onChange={event => setCurrency(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-gross">配当総額（原通貨）</Label>
            <Input id="income-gross" type="number" inputMode="decimal" min="0" value={gross} onChange={event => setGross(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-tax">源泉税（原通貨）</Label>
            <Input id="income-tax" type="number" inputMode="decimal" min="0" value={tax} onChange={event => setTax(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="income-fee">手数料（原通貨）</Label>
            <Input id="income-fee" type="number" inputMode="decimal" min="0" value={fee} onChange={event => setFee(event.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="income-reference">券商明細の参照（任意）</Label>
            <Input id="income-reference" value={reference} onChange={event => setReference(event.target.value)} placeholder="取引明細ID・メモなど" />
          </div>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Landmark className="h-4 w-4" />
              税・手数料控除後
            </span>
            <strong className="tabular">
              {netPreview === null || netPreview < 0
                ? "算出不可"
                : `${currency.toUpperCase()} ${netPreview.toLocaleString(undefined, { maximumFractionDigits: 4 })}`}
            </strong>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            円換算は現在設定されている為替レートを入金記録へ固定保存します。
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            キャンセル
          </Button>
          <Button type="button" disabled={mutation.isPending} onClick={save}>
            {mutation.isPending ? "保存中…" : "実績として保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
