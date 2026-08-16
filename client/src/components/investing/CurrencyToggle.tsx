import { useDisplayCurrency } from "@/contexts/DisplayCurrencyContext";
import {
  DISPLAY_CURRENCIES,
  DISPLAY_CURRENCY_LABELS,
  DISPLAY_CURRENCY_SHORT,
} from "@shared/displayCurrency";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * 金額の表示通貨を切り替える。
 *
 * 銘柄ごとに現地通貨で表示すると、保有一覧に円と USD が混ざって
 * 大小を目で比較できない。世界の株を横並びで見るには通貨を揃える必要がある。
 *
 * 「現地」は換算せず元の通貨で見るための選択肢として残す。
 * 株そのものの値動きを現地通貨で確認したい場面があるため。
 */
export function CurrencyToggle({ className }: { className?: string }) {
  const { currency, setCurrency, fx } = useDisplayCurrency();

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5 ${className ?? ""}`}
      role="group"
      aria-label="表示通貨"
    >
      {DISPLAY_CURRENCIES.map(c => {
        /*
         * 為替レートが取れていない通貨は選ばせない。
         * 選べてしまうと金額が「—」になり、壊れて見えるため。
         */
        const unavailable =
          (c === "USD" && !(fx.usdJpy > 0)) || (c === "SGD" && !(fx.sgdJpy > 0));
        const active = currency === c;
        return (
          <Tooltip key={c}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={active ? "secondary" : "ghost"}
                disabled={unavailable}
                className={`h-7 px-2 text-xs ${active ? "shadow-sm" : "text-muted-foreground"}`}
                onClick={() => setCurrency(c)}
                data-testid={`currency-${c}`}
              >
                {DISPLAY_CURRENCY_SHORT[c]}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {DISPLAY_CURRENCY_LABELS[c]}
                {unavailable ? "（レート未取得のため選べません）" : ""}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

