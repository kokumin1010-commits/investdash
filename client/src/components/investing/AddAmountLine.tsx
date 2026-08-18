import { ShoppingCart, AlertCircle } from "lucide-react";
import { MoneyText } from "@/components/investing/Figures";
import { lotSizeFor, lotSizeUncertain } from "@shared/addShares";
import { MAX_POSITION_SHARE_PCT } from "@shared/addSizing";
import type { Market } from "@shared/investing";

/**
 * ADD 判定の銘柄に「いくら買い増すか」を出す。
 *
 * 【なぜ金額と株数を並べるか】
 * ADD だけでは何をすればよいか決まらない。金額だけでも発注画面で
 * 割り算が必要になるため、そのまま入れられる株数も添える。
 *
 * 【上限に達している場合】
 * 金額を出さず理由を書く。0 円と出すだけでは「なぜ 0 なのか」が
 * 分からず、システムの不具合と誤解される。
 */
export type AddPlanView = {
  amountBase: number;
  amountLocal: number | null;
  shares: number | null;
  afterSharePct: number | null;
  atCap: boolean;
  roomToCapBase: number;
};

export function AddAmountLine({
  plan,
  currency,
  market,
  currentSharePct,
  compact = false,
}: {
  plan: AddPlanView;
  currency: string;
  market: Market;
  currentSharePct: number | null;
  compact?: boolean;
}) {
  if (plan.atCap) {
    return (
      <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          1 銘柄の上限（資産の {MAX_POSITION_SHARE_PCT}%）に達しているため買い増しは見送り。
          {currentSharePct !== null ? `現在 ${currentSharePct.toFixed(1)}%。` : ""}
          他の銘柄を検討してください。
        </span>
      </div>
    );
  }

  if (plan.shares === 0) {
    return (
      <div className="mt-2 flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          1 回分の金額（
          <MoneyText value={plan.amountBase} currency="JPY" className="font-medium" hideLocalHint />
          ）では最低売買単位（{lotSizeFor(market)} 株）に届きません。
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md bg-emerald-50 px-2 py-1.5 dark:bg-emerald-950/40">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          <ShoppingCart className="h-3 w-3" />
          買うなら
        </span>
        <span className="flex items-baseline gap-2">
          <MoneyText
            value={plan.amountLocal}
            currency={currency}
            baseValue={plan.amountBase}
            className="text-xs font-semibold text-emerald-700 dark:text-emerald-400"
          />
          {plan.shares !== null ? (
            <span className="tabular text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              {plan.shares.toLocaleString("ja-JP")} 株
            </span>
          ) : null}
        </span>
      </div>
      {!compact ? (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          買うと構成比は{" "}
          {currentSharePct !== null ? `${currentSharePct.toFixed(1)}% → ` : ""}
          {plan.afterSharePct !== null ? `${plan.afterSharePct.toFixed(1)}%` : "—"}
          {lotSizeUncertain(market)
            ? "。香港株は銘柄ごとに売買単位が違うため、株数は発注前に確認してください"
            : ""}
        </p>
      ) : null}
    </div>
  );
}
