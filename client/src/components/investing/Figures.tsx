import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "@shared/investing";

/** 損益額・率を符号に応じて色付けして表示する */
export function PnlText({
  value,
  currency = "JPY",
  compact,
  className,
  showSign = true,
}: {
  value: number | null | undefined;
  currency?: string;
  compact?: boolean;
  className?: string;
  showSign?: boolean;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className={cn("text-muted-foreground tabular", className)}>—</span>;
  }
  const tone = value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-muted-foreground";
  const prefix = showSign && value > 0 ? "+" : "";
  return (
    <span className={cn("tabular font-medium", tone, className)}>
      {prefix}
      {formatMoney(value, currency, { compact })}
    </span>
  );
}

export function PctText({
  value,
  className,
  digits = 2,
}: {
  value: number | null | undefined;
  className?: string;
  digits?: number;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className={cn("text-muted-foreground tabular", className)}>—</span>;
  }
  const tone = value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-muted-foreground";
  return <span className={cn("tabular font-medium", tone, className)}>{formatPercent(value, digits)}</span>;
}

export function MoneyText({
  value,
  currency = "JPY",
  compact,
  className,
}: {
  value: number | null | undefined;
  currency?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("tabular", className)}>{formatMoney(value, currency, { compact })}</span>
  );
}
