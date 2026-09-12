import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  CandidateCardInsight,
  CandidateFinancialMetric,
} from "@shared/candidateFinancialMetrics";
import { ChevronDown, ChevronUp, Info, ShieldCheck, WalletCards } from "lucide-react";
import { useState } from "react";

type Props = {
  insight: CandidateCardInsight | null | undefined;
  loading?: boolean;
  strictDecision?: "BUY_NOW" | "PRICE_WAIT" | "DATA_WAIT" | "SKIP" | null;
};

const CORE_METRICS: Array<{
  key:
    | "forecastDividendYieldPct"
    | "trailingPe"
    | "priceToBook"
    | "marketCap";
  label: string;
}> = [
  { key: "forecastDividendYieldPct", label: "予想配当利回り" },
  { key: "trailingPe", label: "PER" },
  { key: "priceToBook", label: "PBR" },
  { key: "marketCap", label: "時価総額" },
];

const DETAIL_METRICS: Array<{
  key:
    | "roePct"
    | "roicPct"
    | "operatingMarginPct"
    | "freeCashFlow"
    | "fcfYieldPct"
    | "netCash"
    | "revenueGrowthPct"
    | "epsGrowthPct"
    | "payoutRatioPct"
    | "dividendGrowthPct";
  label: string;
}> = [
  { key: "roePct", label: "ROE" },
  { key: "roicPct", label: "ROIC" },
  { key: "operatingMarginPct", label: "営業利益率" },
  { key: "freeCashFlow", label: "Free Cash Flow" },
  { key: "fcfYieldPct", label: "FCF利回り" },
  { key: "netCash", label: "Net cash / debt" },
  { key: "revenueGrowthPct", label: "売上成長" },
  { key: "epsGrowthPct", label: "EPS成長" },
  { key: "payoutRatioPct", label: "配当性向" },
  { key: "dividendGrowthPct", label: "配当成長" },
];

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("ja-JP", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function formatCurrencyCompact(value: number, currency: string | null): string {
  const magnitude = Math.abs(value);
  const units = [
    { size: 1_000_000_000_000, label: "兆" },
    { size: 100_000_000, label: "億" },
    { size: 10_000, label: "万" },
  ];
  const unit = units.find(item => magnitude >= item.size);
  const number = unit ? `${formatNumber(value / unit.size)}${unit.label}` : formatNumber(value);
  return `${number} ${currency ?? "通貨未取得"}`;
}

function metricText(metric: CandidateFinancialMetric): string {
  if (metric.status === "NOT_MEANINGFUL") return "算定対象外";
  if (metric.status === "UNAVAILABLE" || metric.value === null) return "未取得";
  if (metric.unit === "PERCENT") return `${formatNumber(metric.value)}%`;
  if (metric.unit === "RATIO") return `${formatNumber(metric.value)}倍`;
  return formatCurrencyCompact(metric.value, metric.currency);
}

function metricTone(metric: CandidateFinancialMetric): string {
  if (metric.status === "AVAILABLE") return "text-foreground";
  if (metric.status === "NOT_MEANINGFUL") return "text-amber-700 dark:text-amber-300";
  return "text-muted-foreground";
}

function strictSizingMessage(decision: Props["strictDecision"]): string | null {
  if (!decision || decision === "BUY_NOW") return null;
  if (decision === "PRICE_WAIT") return "価格条件未達のため暫定計算不可";
  if (decision === "DATA_WAIT") return "財務・資料確認前のため暫定計算不可";
  return "今回は見送りのため購入量を提案しません";
}

export function CandidateMetricsAndSizing({
  insight,
  loading = false,
  strictDecision = null,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const strictMessage = strictSizingMessage(strictDecision);

  if (loading && !insight) {
    return (
      <section className="space-y-3" aria-label="財務指標を読み込み中">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CORE_METRICS.map(metric => (
            <Skeleton key={metric.key} className="h-[74px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-28 rounded-xl" />
      </section>
    );
  }

  if (!insight) {
    return (
      <section className="space-y-3" data-testid="candidate-metrics-unavailable">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CORE_METRICS.map(metric => (
            <div key={metric.key} className="min-w-0 rounded-xl border bg-muted/20 p-3">
              <p className="text-[11px] text-muted-foreground">{metric.label}</p>
              <p className="mt-1 text-sm font-semibold text-muted-foreground">未取得</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          財務指標またはportfolio入力を取得できないため、初回購入量は暫定計算不可です。
        </div>
      </section>
    );
  }

  const { financials, sizing } = insight;
  const showSizing =
    !strictMessage &&
    sizing.recommendedShares !== null &&
    sizing.recommendedAmountBase !== null &&
    sizing.afterWeightPct !== null;
  const sizingStatusLabel = strictMessage
    ? "暫定計算不可"
    : sizing.status === "PRICE_WAIT"
      ? "価格待ち・参考量"
      : sizing.status === "RESEARCH_ONLY"
        ? "調査段階・参考量"
        : sizing.status === "HELD"
          ? "保有中"
          : "暫定計算不可";

  return (
    <section
      className="space-y-3"
      data-testid={`candidate-metrics-${insight.symbol}`}
      aria-label={`${insight.symbol} の財務指標と初回購入目安`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <ShieldCheck className="size-4 text-emerald-600" />
          評価・財務の透明性
        </div>
        <Badge variant="outline" className="text-[10px]">
          {financials.dataQuality === "COMPLETE"
            ? "必須4指標取得"
            : financials.dataQuality === "PARTIAL"
              ? "一部未取得"
              : "未取得"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CORE_METRICS.map(item => {
          const metric = financials.metrics[item.key];
          return (
            <div key={item.key} className="min-w-0 rounded-xl border bg-background/75 p-3">
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
              <p className={`mt-1 break-words font-mono text-sm font-semibold ${metricTone(metric)}`}>
                {metricText(metric)}
              </p>
              <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                {metric.period ?? "期間未取得"}
              </p>
            </div>
          );
        })}
      </div>

      <p className="break-words text-[10px] leading-4 text-muted-foreground">
        市場基準 {financials.marketAsOfDate ?? "未取得"}・会計期末 {financials.fiscalPeriodEnd ?? "未取得"}・{financials.source}
      </p>

      <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3 dark:border-sky-900 dark:bg-sky-950/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <WalletCards className="size-4 text-sky-700 dark:text-sky-300" />
            初回購入の目安
          </div>
          <Badge variant="outline" className="bg-background/70 text-[10px]">
            {sizingStatusLabel}
          </Badge>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="min-w-0 rounded-lg bg-background/75 p-2.5">
            <p className="text-[10px] text-muted-foreground">現在保有</p>
            <p className="mt-1 font-mono text-sm font-semibold">
              {formatNumber(sizing.currentQuantity, 4)} 株
            </p>
          </div>
          <div className="min-w-0 rounded-lg bg-background/75 p-2.5">
            <p className="text-[10px] text-muted-foreground">初回株数・金額</p>
            <p className="mt-1 font-mono text-sm font-semibold">
              {showSizing ? `${formatNumber(sizing.recommendedShares ?? 0, 4)} 株` : "暫定計算不可"}
            </p>
            <p className="break-words text-[10px] text-muted-foreground">
              {showSizing && sizing.recommendedAmountBase !== null
                ? `${formatCurrencyCompact(sizing.recommendedAmountBase, "JPY")}／${formatCurrencyCompact(sizing.recommendedAmountLocal ?? 0, sizing.currency)}`
                : strictMessage ?? "必要入力または制約を確認"}
            </p>
          </div>
          <div className="min-w-0 rounded-lg bg-background/75 p-2.5">
            <p className="text-[10px] text-muted-foreground">購入後構成比</p>
            <p className="mt-1 font-mono text-sm font-semibold">
              {showSizing && sizing.afterWeightPct !== null
                ? `${formatNumber(sizing.afterWeightPct)}%`
                : "—"}
            </p>
          </div>
          <div className="min-w-0 rounded-lg bg-background/75 p-2.5">
            <p className="text-[10px] text-muted-foreground">分割</p>
            <p className="mt-1 text-xs font-semibold leading-5">
              {showSizing
                ? `${sizing.trancheCount ?? "—"}回想定・${sizing.trancheLabel}`
                : "条件通過後に再計算"}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          次回: {sizing.nextTrancheCondition}
        </p>
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-between rounded-lg border px-3 py-2 text-xs"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <Info className="size-4" />
          品質・財務余力・算定根拠
        </span>
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </Button>

      {expanded ? (
        <div className="space-y-3 rounded-xl border bg-muted/15 p-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            {DETAIL_METRICS.map(item => {
              const metric = financials.metrics[item.key];
              return (
                <div key={item.key} className="min-w-0 border-b pb-2 last:border-b-0">
                  <p className="text-[10px] text-muted-foreground">{item.label}</p>
                  <p className={`mt-0.5 break-words font-mono text-xs font-semibold ${metricTone(metric)}`}>
                    {metricText(metric)}
                  </p>
                  <p className="mt-0.5 break-words text-[9px] leading-4 text-muted-foreground">
                    {metric.basis}
                  </p>
                </div>
              );
            })}
          </div>
          {(financials.notes.length > 0 || sizing.constraints.length > 0) && (
            <div className="space-y-2 border-t pt-3 text-[11px] leading-5 text-muted-foreground">
              {financials.notes.map(note => (
                <p key={note}>・{note}</p>
              ))}
              {sizing.constraints.map(reason => (
                <p key={reason}>・{reason}</p>
              ))}
              <p>・{sizing.basis}</p>
            </div>
          )}
          <p className="border-t pt-3 text-[10px] leading-4 text-muted-foreground">
            本表示は調査・分析用で、個別の投資助言または自動注文ではありません。
          </p>
        </div>
      ) : null}
    </section>
  );
}
