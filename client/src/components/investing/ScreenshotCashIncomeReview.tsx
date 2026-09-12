import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ScreenshotDividendDraft,
  ScreenshotDraftMode,
  ScreenshotInterestDraft,
} from "@shared/screenshotCashIncome";
import { CalendarDays, CircleDollarSign, Landmark, PiggyBank } from "lucide-react";
import * as React from "react";

type Props = {
  interestAssets: ScreenshotInterestDraft[];
  dividendIncomes: ScreenshotDividendDraft[];
  onInterestChange: (index: number, patch: Partial<ScreenshotInterestDraft>) => void;
  onDividendChange: (index: number, patch: Partial<ScreenshotDividendDraft>) => void;
};

function numberValue(value: number | null) {
  return value === null ? "" : String(value);
}

function parseNumber(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAmount(currency: string | null, value: number | null) {
  if (!currency || value === null || !Number.isFinite(value)) return "算定不可";
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function ModeSelect({
  value,
  onChange,
}: {
  value: ScreenshotDraftMode;
  onChange: (value: ScreenshotDraftMode) => void;
}) {
  return (
    <Select value={value} onValueChange={value => onChange(value as ScreenshotDraftMode)}>
      <SelectTrigger className="h-9 w-full sm:w-[150px]" aria-label="保存方法">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="APPLY">確認して保存</SelectItem>
        <SelectItem value="SKIP">今回は保存しない</SelectItem>
      </SelectContent>
    </Select>
  );
}

function confidenceClass(value: number) {
  if (value >= 90) return "border-emerald-300 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300";
  if (value >= 60) return "border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-300";
  return "border-rose-300 text-rose-700 dark:border-rose-900 dark:text-rose-300";
}

function InterestCard({
  item,
  index,
  onChange,
}: {
  item: ScreenshotInterestDraft;
  index: number;
  onChange: Props["onInterestChange"];
}) {
  const recalculatedDelta =
    item.cumulativeIncome !== null &&
    item.previousCumulativeIncome !== null &&
    item.previousAsOfDate !== null &&
    item.asOfDate > item.previousAsOfDate &&
    item.cumulativeIncome >= item.previousCumulativeIncome
      ? item.cumulativeIncome - item.previousCumulativeIncome
      : null;
  const deltaLabel =
    item.previousCumulativeIncome === null
      ? "初回基準として保存（前回差額なし）"
      : recalculatedDelta === null
        ? "算定不可：日付または累計値を確認"
        : formatAmount(item.currency, recalculatedDelta);

  return (
    <Card
      data-testid={`screenshot-interest-${index}`}
      className={item.mode === "SKIP" ? "opacity-60" : "border-emerald-200 dark:border-emerald-900"}
    >
      <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <PiggyBank className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="truncate">{item.name}</span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">現金宝・貨幣基金</Badge>
            <Badge variant="outline" className={confidenceClass(item.confidence)}>
              読取 {item.confidence}%
            </Badge>
            {item.dateSource === "UPLOAD_DATE" ? (
              <Badge variant="outline" className="border-amber-300 text-amber-700">
                日付要確認
              </Badge>
            ) : null}
          </div>
        </div>
        <ModeSelect value={item.mode} onChange={mode => onChange(index, { mode })} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor={`interest-name-${index}`}>商品名</Label>
            <Input id={`interest-name-${index}`} value={item.name} onChange={event => onChange(index, { name: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`interest-currency-${index}`}>通貨</Label>
            <Input id={`interest-currency-${index}`} value={item.currency ?? ""} maxLength={8} onChange={event => onChange(index, { currency: event.target.value.toUpperCase() || null })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`interest-date-${index}`}>スクショ基準日</Label>
            <Input id={`interest-date-${index}`} type="date" value={item.asOfDate} onChange={event => onChange(index, { asOfDate: event.target.value, dateSource: "SCREEN" })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`interest-amount-${index}`}>現在残高（原通貨）</Label>
            <Input id={`interest-amount-${index}`} type="number" inputMode="decimal" min="0" value={numberValue(item.amount)} onChange={event => onChange(index, { amount: parseNumber(event.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`interest-rate-${index}`}>表示年率（%）</Label>
            <Input id={`interest-rate-${index}`} type="number" inputMode="decimal" min="0" value={numberValue(item.annualRatePct)} onChange={event => onChange(index, { annualRatePct: parseNumber(event.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`interest-daily-${index}`}>最新日次利息</Label>
            <Input id={`interest-daily-${index}`} type="number" inputMode="decimal" value={numberValue(item.dailyIncome)} onChange={event => onChange(index, { dailyIncome: parseNumber(event.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`interest-cumulative-${index}`}>現在の累計収益</Label>
            <Input id={`interest-cumulative-${index}`} type="number" inputMode="decimal" value={numberValue(item.cumulativeIncome)} onChange={event => onChange(index, { cumulativeIncome: parseNumber(event.target.value) })} />
          </div>
          <div className="space-y-1.5">
            <Label>前回の累計収益</Label>
            <div className="tabular rounded-md border bg-muted/30 px-3 py-2 text-sm">
              {formatAmount(item.currency, item.previousCumulativeIncome)}
              <span className="ml-1 text-[11px] text-muted-foreground">
                {item.previousAsOfDate ?? "前回なし"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CircleDollarSign className="h-4 w-4" />
              前回スクショ以降の実際利息
            </span>
            <strong className="tabular text-base text-emerald-800 dark:text-emerald-200">
              {deltaLabel}
            </strong>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            累計収益の差額だけを実績にします。最新日次利息は重ねて加算しません。
          </p>
        </div>

        {item.issues.length > 0 ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            {item.issues.join(" / ")}
          </div>
        ) : null}
        {item.evidence ? <p className="text-[11px] text-muted-foreground">読取根拠: {item.evidence}</p> : null}
      </CardContent>
    </Card>
  );
}

function DividendCard({
  item,
  index,
  onChange,
}: {
  item: ScreenshotDividendDraft;
  index: number;
  onChange: Props["onDividendChange"];
}) {
  const input = (
    key: "grossAmount" | "taxAmount" | "feeAmount" | "netAmount",
    label: string
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`dividend-${key}-${index}`}>{label}</Label>
      <Input
        id={`dividend-${key}-${index}`}
        type="number"
        inputMode="decimal"
        min="0"
        value={numberValue(item[key])}
        onChange={event => onChange(index, { [key]: parseNumber(event.target.value) })}
      />
    </div>
  );
  return (
    <Card
      data-testid={`screenshot-dividend-${index}`}
      className={item.mode === "SKIP" ? "opacity-60" : "border-sky-200 dark:border-sky-900"}
    >
      <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex min-w-0 items-center gap-2 text-base">
            <Landmark className="h-4 w-4 shrink-0 text-sky-700" />
            <span className="truncate">{item.name}</span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">入金済み配当</Badge>
            <Badge variant="outline" className={confidenceClass(item.confidence)}>
              読取 {item.confidence}%
            </Badge>
            {item.grossAmount === null ? <Badge variant="outline">ネット入金のみ取得</Badge> : null}
          </div>
        </div>
        <ModeSelect value={item.mode} onChange={mode => onChange(index, { mode })} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor={`dividend-name-${index}`}>銘柄・配当名</Label>
            <Input id={`dividend-name-${index}`} value={item.name} onChange={event => onChange(index, { name: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`dividend-symbol-${index}`}>コード（任意）</Label>
            <Input id={`dividend-symbol-${index}`} value={item.symbol ?? ""} onChange={event => onChange(index, { symbol: event.target.value || null })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`dividend-date-${index}`}>実際の入金日</Label>
            <Input id={`dividend-date-${index}`} type="date" value={item.occurredOn ?? ""} onChange={event => onChange(index, { occurredOn: event.target.value || null })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`dividend-currency-${index}`}>通貨</Label>
            <Input id={`dividend-currency-${index}`} value={item.currency ?? ""} maxLength={8} onChange={event => onChange(index, { currency: event.target.value.toUpperCase() || null })} />
          </div>
          {input("grossAmount", "税前額（表示時のみ）")}
          {input("taxAmount", "源泉税（表示時のみ）")}
          {input("feeAmount", "手数料（表示時のみ）")}
          {input("netAmount", "実際の入金額")}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900 dark:bg-sky-950/20">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            実績として保存するネット入金
          </span>
          <strong className="tabular text-base text-sky-800 dark:text-sky-200">
            {formatAmount(item.currency, item.netAmount)}
          </strong>
        </div>
        {item.issues.length > 0 ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            {item.issues.join(" / ")}
          </div>
        ) : null}
        {item.evidence ? <p className="text-[11px] text-muted-foreground">読取根拠: {item.evidence}</p> : null}
      </CardContent>
    </Card>
  );
}

export function ScreenshotCashIncomeReview({
  interestAssets,
  dividendIncomes,
  onInterestChange,
  onDividendChange,
}: Props) {
  if (interestAssets.length === 0 && dividendIncomes.length === 0) return null;
  return (
    <section data-testid="screenshot-cash-income-review" className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">キャッシュ収入の自動計算</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          スクショの実数だけを草稿にしました。確認して保存するまで実績には反映されません。
        </p>
      </div>
      {interestAssets.map((item, index) => (
        <InterestCard key={item.draftKey} item={item} index={index} onChange={onInterestChange} />
      ))}
      {dividendIncomes.map((item, index) => (
        <DividendCard key={item.draftKey} item={item} index={index} onChange={onDividendChange} />
      ))}
    </section>
  );
}
