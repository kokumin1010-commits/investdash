import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "@shared/investing";
import { useDisplayCurrency } from "@/contexts/DisplayCurrencyContext";

/**
 * 金額を表示通貨に合わせて描画するための共通処理。
 *
 * 呼び出し側は「現地通貨の値」と「円換算した値」の両方を渡せる。
 * 表示通貨が選ばれていて円換算値があればそれを換算して主役にし、
 * 現地通貨の値は括弧内に補助として添える。
 *
 * 円換算値が渡されない箇所（例: 取得単価のような単価表示）は
 * 従来どおり現地通貨のまま出す。単価は換算すると意味が薄れるため。
 */
function useMoneyParts({
  value,
  currency,
  baseValue,
  compact,
}: {
  value: number | null | undefined;
  currency: string;
  baseValue?: number | null;
  compact?: boolean;
}) {
  const { currency: target, convert, codeFor, showLocalHint } = useDisplayCurrency();
  const converted = baseValue === undefined ? null : convert(baseValue);

  if (converted === null) {
    return {
      main: formatMoney(value, currency, { compact }),
      hint: null as string | null,
      mainValue: value ?? null,
    };
  }
  const showHint = showLocalHint(currency) && value !== null && value !== undefined;
  return {
    main: formatMoney(converted, codeFor(currency), { compact }),
    hint: showHint ? formatMoney(value, currency, { compact }) : null,
    mainValue: converted,
  };
}

/** 損益額・率を符号に応じて色付けして表示する */
export function PnlText({
  value,
  currency = "JPY",
  baseValue,
  compact,
  className,
  showSign = true,
  hideLocalHint,
}: {
  value: number | null | undefined;
  currency?: string;
  /** 円換算した値。渡すと表示通貨に追随する */
  baseValue?: number | null;
  compact?: boolean;
  className?: string;
  showSign?: boolean;
  /** 併記が邪魔になる狭い場所では補助表示を省く */
  hideLocalHint?: boolean;
}) {
  const { main, hint, mainValue } = useMoneyParts({ value, currency, baseValue, compact });
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className={cn("text-muted-foreground tabular", className)}>—</span>;
  }
  /*
   * 色と符号は換算前の値で判断する。
   * 換算しても損益の向きは変わらないが、レート未取得時に
   * mainValue が null になる場合でも向きを正しく出すため。
   */
  const tone = value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-muted-foreground";
  const prefix = showSign && (mainValue ?? value) > 0 ? "+" : "";
  return (
    <span className={cn("tabular font-medium", tone, className)}>
      {prefix}
      {main}
      {hint && !hideLocalHint ? (
        <span className="ml-1 text-[11px] font-normal opacity-60">({hint})</span>
      ) : null}
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
  baseValue,
  compact,
  className,
  hideLocalHint,
}: {
  value: number | null | undefined;
  currency?: string;
  /** 円換算した値。渡すと表示通貨に追随する */
  baseValue?: number | null;
  compact?: boolean;
  className?: string;
  /** 併記が邪魔になる狭い場所では補助表示を省く */
  hideLocalHint?: boolean;
}) {
  const { main, hint } = useMoneyParts({ value, currency, baseValue, compact });
  return (
    <span className={cn("tabular", className)}>
      {main}
      {hint && !hideLocalHint ? (
        <span className="ml-1 text-[11px] opacity-60">({hint})</span>
      ) : null}
    </span>
  );
}
