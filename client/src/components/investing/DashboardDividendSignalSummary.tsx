import { SignalBadge } from "./SignalBadge";
import { SIGNAL_ACTIONS, type SignalAction } from "@shared/investing";

export function DashboardDividendSummary({
  annualIncomeBase,
  unknownCount,
  totalSymbols,
  formatMoney,
}: {
  annualIncomeBase: number;
  unknownCount: number;
  totalSymbols: number;
  formatMoney: (value: number) => string;
}) {
  const hasCoverage = unknownCount < totalSymbols;
  return (
    <span className="whitespace-nowrap text-2xl font-semibold text-gain">
      {hasCoverage ? formatMoney(annualIncomeBase) : "—"}
      <span className="sr-only">
        {hasCoverage ? `配当データ取得済み ${totalSymbols - unknownCount}/${totalSymbols}` : "配当データ未取得"}
      </span>
    </span>
  );
}

export type DashboardSignalStats = {
  total: number;
  judged: number;
  stale: number;
  averageConfidence: number | null;
  strong: number;
  moderate: number;
  limited: number;
};

export function DashboardSignalStatsStrip({ stats }: { stats: DashboardSignalStats }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span>判定済み {stats.judged}/{stats.total}</span>
      <span>平均確信度 {stats.averageConfidence !== null ? stats.averageConfidence.toFixed(0) : "—"}</span>
      <span className={stats.stale > 0 ? "font-medium text-amber-700" : "text-emerald-700"}>
        {stats.stale > 0 ? `再分析待ち ${stats.stale}` : "全件 最新"}
      </span>
      <span>材料充足 {stats.strong} / 材料あり {stats.moderate} / 限定 {stats.limited}</span>
    </div>
  );
}

export function DashboardSignalActionSelector({
  counts,
  active,
  onSelect,
}: {
  counts: Map<SignalAction, number>;
  active: SignalAction | null;
  onSelect: (action: SignalAction) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SIGNAL_ACTIONS.map(action => {
        const count = counts.get(action) ?? 0;
        return (
          <button
            key={action}
            type="button"
            onClick={() => count > 0 && onSelect(action)}
            disabled={count === 0}
            aria-pressed={active === action}
            className={`flex min-h-7 items-center gap-1 rounded-md px-1.5 py-0.5 transition-all duration-150 active:scale-[0.97] ${
              active === action
                ? "bg-accent ring-1 ring-border"
                : count === 0
                  ? "cursor-default opacity-40"
                  : "hover:bg-accent/50"
            }`}
          >
            <SignalBadge action={action} />
            <span className="tabular text-sm font-medium">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
