import { Badge } from "@/components/ui/badge";
import type { CashBalanceTracking } from "@shared/cashBalanceTracking";
import { BROKER_LABELS } from "@shared/investing";
import { Clock3, WalletCards } from "lucide-react";
import * as React from "react";

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

function originalAmount(currency: string, value: number | null) {
  if (value === null || !Number.isFinite(value)) return "未取得";
  return `${currency} ${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })}`;
}

export function CashBalanceTrackingSection({
  data,
  annualDividendJpy,
}: {
  data: CashBalanceTracking | undefined;
  annualDividendJpy: number | null;
}) {
  if (!data) return null;
  const legacyOnly = data.status === "LEGACY_TOTAL_ONLY";
  const unavailable = data.status === "UNAVAILABLE";

  return (
    <section
      data-testid="cash-balance-tracking"
      className="space-y-3"
      aria-labelledby="cash-balance-tracking-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3
            id="cash-balance-tracking-heading"
            className="flex items-center gap-1.5 text-sm font-semibold"
          >
            <WalletCards className="h-4 w-4 text-teal-700" />
            現金残高：スクショ確定＋暫定更新
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            月次スクショを確定基準にし、その後の確認済み配当だけを暫定加算します。予想配当は残高に入れません。
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-teal-200 text-[10px] text-teal-700 dark:border-teal-900 dark:text-teal-200"
        >
          {data.status === "SCREENSHOT_PROVISIONAL"
            ? `暫定・${data.confirmedAccountCount}口座`
            : legacyOnly
              ? "旧全体値・口座未分類"
              : "基準未取得"}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div className="min-w-0 rounded-xl border border-teal-200 bg-teal-50/50 p-3 dark:border-teal-900 dark:bg-teal-950/20">
          <p className="text-[11px] text-muted-foreground">最新スクショ確定残高</p>
          <p className="tabular mt-1 text-lg font-semibold">
            {legacyOnly
              ? yen(data.legacyTotalJpy)
              : yen(data.confirmedAccountTotalJpy)}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            {legacyOnly
              ? "既存全体値・口座／基準日未分類"
              : unavailable
                ? "次回スクショから開始"
                : "口座別スクショ確認済みの合計"}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border bg-background/80 p-3">
          <p className="text-[11px] text-muted-foreground">基準後の入金済み配当</p>
          <p className="tabular mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-300">
            {yen(data.settledDividendAfterAnchorJpy)}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            同口座・同通貨の確定記録のみ
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900 dark:bg-sky-950/20">
          <p className="text-[11px] text-muted-foreground">暫定現在残高</p>
          <p className="tabular mt-1 text-lg font-semibold">
            {yen(data.provisionalAccountTotalJpy)}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            スクショ確定値＋確認済み配当
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
          <p className="text-[11px] text-muted-foreground">入金確認待ちの配当予想</p>
          <p className="tabular mt-1 text-lg font-semibold text-amber-800 dark:text-amber-200">
            {yen(annualDividendJpy)}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
            年間予想・未確定・暫定残高に未算入
          </p>
        </div>
      </div>

      {data.accounts.length > 0 ? (
        <div className="grid gap-2 lg:grid-cols-2">
          {data.accounts.map(account => (
            <div
              key={`${account.broker}-${account.currency}`}
              className="rounded-xl border bg-background/80 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {BROKER_LABELS[account.broker]}・{account.currency}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    最終確定 {dateText(account.confirmedAsOfDate)}
                  </p>
                </div>
                <Badge variant="secondary" className="text-[10px]">
                  {account.reconciliationStatus === "READY"
                    ? "前回差額を照合済み"
                    : "初回基準"}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground">確定残高</p>
                  <p className="tabular mt-1 break-words font-semibold">
                    {originalAmount(account.currency, account.confirmedBalance)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground">確定後配当</p>
                  <p className="tabular mt-1 break-words font-semibold text-emerald-700 dark:text-emerald-300">
                    {originalAmount(
                      account.currency,
                      account.settledDividendAfterAnchor
                    )}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground">暫定残高</p>
                  <p className="tabular mt-1 break-words font-semibold">
                    {originalAmount(account.currency, account.provisionalBalance)}
                  </p>
                </div>
              </div>
              {account.reconciliationStatus === "READY" ? (
                <p className="mt-3 rounded-lg bg-amber-50/70 px-2.5 py-2 text-[10px] leading-relaxed text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                  前回 {dateText(account.previousAsOfDate)} → 今回の未識別差額：
                  <strong className="tabular ml-1">
                    {originalAmount(
                      account.currency,
                      account.unidentifiedDifference
                    )}
                  </strong>
                  。売買・税・手数料・入出金などを自動推測しません。
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {data.missingBrokers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          <span>次回スクショ待ち：</span>
          {data.missingBrokers.map(broker => (
            <Badge key={broker} variant="outline" className="text-[10px]">
              {BROKER_LABELS[broker]}
            </Badge>
          ))}
        </div>
      ) : null}

      <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
        {data.note}
      </p>
    </section>
  );
}
