import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type LongTermChartSpan = "10Y" | "20Y" | "MAX";

type LongTermAnnualChartProps = {
  symbol: string;
  targetPrice?: number | null;
  targetLabel?: string;
  defaultOpen?: boolean;
  defaultSpan?: LongTermChartSpan;
  className?: string;
};

/**
 * 候補・ウォッチリストで共用する長期年足。
 *
 * デフォルトは上場来を開いた状態にするが、画面外のカードは Yahoo へ
 * 一斉リクエストしない。カードが表示領域の近くへ来た時点で初めて取得する。
 */
export function LongTermAnnualChart({
  symbol,
  targetPrice = null,
  targetLabel = "目標価格",
  defaultOpen = true,
  defaultSpan = "MAX",
  className = "",
}: LongTermAnnualChartProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [span, setSpan] = useState<LongTermChartSpan>(defaultSpan);
  const [hasBeenVisible, setHasBeenVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || hasBeenVisible) return;
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setHasBeenVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setHasBeenVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "480px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasBeenVisible, open]);

  const query = trpc.portfolio.longTermChart.useQuery(
    { symbol, span },
    { enabled: open && hasBeenVisible, staleTime: 30 * 60 * 1000 }
  );
  const gradientId = `annual-gradient-${symbol.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div
      ref={containerRef}
      className={`space-y-2 ${className}`.trim()}
      data-testid={`long-term-chart-shell-${symbol}`}
      data-default-span={defaultSpan}
    >
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between bg-background"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <BarChart3 className="size-4" /> 長期年足を見る
        </span>
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </Button>

      {open ? (
        <div
          className="space-y-3 rounded-xl border bg-background p-3"
          data-testid={`long-term-chart-${symbol}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">長期年足</p>
              <p className="text-[11px] leading-5 text-muted-foreground">
                株式分割調整済み価格。配当再投資を含まず、短期指標は購入判断に使いません。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {([
                ["10Y", "10年"],
                ["20Y", "20年"],
                ["MAX", "上場来"],
              ] as const).map(([key, label]) => (
                <Button
                  key={key}
                  type="button"
                  size="sm"
                  variant={span === key ? "default" : "outline"}
                  className={span === key ? "h-8" : "h-8 bg-background"}
                  onClick={() => setSpan(key)}
                  aria-pressed={span === key}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {!hasBeenVisible || query.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : query.error ? (
            <p className="py-8 text-center text-sm text-rose-700">年足を取得できませんでした</p>
          ) : (query.data?.bars.length ?? 0) < 2 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              この期間の年足データは不足しています
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ChartMetric
                  label="現在値"
                  value={formatChartPrice(query.data?.currentPrice, query.data?.currency)}
                />
                <ChartMetric
                  label="年足最新"
                  value={formatChartPrice(query.data?.summary.latestClose, query.data?.currency)}
                />
                <ChartMetric
                  label="高値から"
                  value={
                    query.data?.summary.drawdownFromPeakPct == null
                      ? "—"
                      : `${query.data.summary.drawdownFromPeakPct.toFixed(1)}%`
                  }
                />
                <ChartMetric
                  label="表示期間"
                  value={`${query.data?.summary.startYear ?? "—"}〜${query.data?.summary.endYear ?? "—"}`}
                />
              </div>
              <div className="h-64 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={query.data?.bars ?? []}
                    margin={{ top: 12, right: 8, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#7c3aed" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} minTickGap={22} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={value => compactNumber(Number(value))}
                      width={56}
                    />
                    <Tooltip
                      formatter={value => [
                        formatChartPrice(Number(value), query.data?.currency),
                        "年末調整済み価格",
                      ]}
                      labelFormatter={label => `${label}年`}
                    />
                    {targetPrice !== null ? (
                      <ReferenceLine
                        y={targetPrice}
                        stroke="#d97706"
                        strokeDasharray="5 4"
                        label={{ value: targetLabel, position: "insideTopRight", fontSize: 10 }}
                      />
                    ) : null}
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke="#6d28d9"
                      strokeWidth={2}
                      isAnimationActive={false}
                      fill={`url(#${gradientId})`}
                      dot={{ r: 2, fill: "#6d28d9" }}
                      activeDot={{ r: 4 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ChartMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/45 px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-mono text-xs font-semibold">{value}</p>
    </div>
  );
}

function formatChartPrice(
  value: number | null | undefined,
  currency: string | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}
