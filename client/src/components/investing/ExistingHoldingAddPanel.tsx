import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowRight, CheckCircle2, Layers3, ShieldCheck } from "lucide-react";
import { Link } from "wouter";

type Candidate = {
  symbol: string;
  name: string;
  currency: string;
  currentPrice: number | null;
  action: string | null;
  currentBandReason: string | null;
  holdingQuantity: number | null;
  signalAction: string | null;
  signalConfidence: number | null;
  signalWouldBuyNowReason: string | null;
  cardConviction: number | null;
  reviewRank: number;
  priceBandRank: number;
  sizing: {
    amountBase: number;
    shares: number;
    afterWeightPct: number;
  };
};

type Summary = {
  policyVersion: string;
  rawAddZoneCount: number;
  rawAddMainCount: number;
  rawAddSmallCount: number;
  safetyGatePassedCount: number;
  reviewReadyCount: number;
  reviewReadyMainCount: number;
  reviewReadySmallCount: number;
  reviewOnlyCount: number;
  candidates: Candidate[];
};

function formatBaseAmount(jpy: number): string {
  if (jpy >= 100_000_000) return `${(jpy / 100_000_000).toFixed(2)}億円`;
  if (jpy >= 10_000) return `${Math.round(jpy / 10_000).toLocaleString("ja-JP")}万円`;
  return `${Math.round(jpy).toLocaleString("ja-JP")}円`;
}

function formatShares(value: number): string {
  return value.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

function formatLocalPrice(value: number | null, currency: string): string {
  if (value === null) return "未取得";
  return `${value.toLocaleString("ja-JP", {
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  })} ${currency}`;
}

function bandLabel(action: string | null): string {
  return action === "ADD_MAIN" ? "主力買い増し" : "小幅買い増し";
}

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const afterQuantity =
    candidate.holdingQuantity === null
      ? null
      : candidate.holdingQuantity + candidate.sizing.shares;

  return (
    <article
      className="rounded-2xl border border-emerald-200/80 bg-white/80 p-3 shadow-sm transition-transform duration-150 active:scale-[0.99] dark:border-emerald-900 dark:bg-background/70"
      data-testid={`existing-holding-add-candidate-${candidate.symbol}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-700 font-mono text-sm font-semibold text-white">
            {candidate.reviewRank}
          </span>
          <div className="min-w-0">
            <Link
              href={`/holdings?symbol=${encodeURIComponent(candidate.symbol)}`}
              className="block truncate text-sm font-semibold hover:underline"
            >
              {candidate.name}
            </Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{candidate.symbol}</span>
              <span>価格帯順位 #{candidate.priceBandRank}</span>
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={
            candidate.action === "ADD_MAIN"
              ? "shrink-0 border-emerald-400 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
              : "shrink-0 border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
          }
        >
          {bandLabel(candidate.action)}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-muted/55 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">現在値</p>
          <p className="mt-0.5 font-mono text-xs font-semibold">
            {formatLocalPrice(candidate.currentPrice, candidate.currency)}
          </p>
        </div>
        <div className="rounded-xl bg-muted/55 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">買い増し目安</p>
          <p className="mt-0.5 font-mono text-xs font-semibold">
            +{formatShares(candidate.sizing.shares)}株
          </p>
          <p className="text-[10px] text-muted-foreground">
            {formatBaseAmount(candidate.sizing.amountBase)}
          </p>
        </div>
        <div className="rounded-xl bg-muted/55 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">保有株数</p>
          <p className="mt-0.5 font-mono text-xs font-semibold">
            {candidate.holdingQuantity === null
              ? "—"
              : `${formatShares(candidate.holdingQuantity)}株`}
          </p>
          {afterQuantity !== null ? (
            <p className="text-[10px] text-muted-foreground">
              実行後 {formatShares(afterQuantity)}株
            </p>
          ) : null}
        </div>
        <div className="rounded-xl bg-muted/55 px-2.5 py-2">
          <p className="text-[10px] text-muted-foreground">実行後構成比</p>
          <p className="mt-0.5 font-mono text-xs font-semibold">
            {candidate.sizing.afterWeightPct.toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="mt-2.5 rounded-xl border border-emerald-100 bg-emerald-50/55 px-3 py-2 text-xs leading-5 text-emerald-950 dark:border-emerald-950 dark:bg-emerald-950/25 dark:text-emerald-100">
        <p>
          {candidate.currentBandReason ??
            "価格帯・数量・集中度・業種・借入の条件を確認済みです。"}
        </p>
        <p className="mt-1 text-[11px] text-emerald-900/70 dark:text-emerald-200/70">
          AI保有シグナル {candidate.signalAction ?? "未取得"}
          {candidate.signalConfidence === null
            ? ""
            : `（確信度 ${candidate.signalConfidence}）`}
          ・カード確信度 {candidate.cardConviction ?? "未設定"}/5
        </p>
      </div>
    </article>
  );
}

export function ExistingHoldingAddPanel({
  summary,
  compact = false,
}: {
  summary: Summary | null | undefined;
  compact?: boolean;
}) {
  if (!summary) return null;
  const visibleCandidates = compact
    ? summary.candidates.slice(0, 5)
    : summary.candidates;

  return (
    <Card
      className="overflow-hidden border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-background to-background dark:border-emerald-950 dark:from-emerald-950/25"
      data-testid="existing-holding-add-panel"
    >
      <CardHeader className="border-b border-emerald-100/80 pb-4 dark:border-emerald-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
              EXISTING HOLDINGS · CONFIRMATION ONLY
            </p>
            <CardTitle className="mt-1 flex items-center gap-2 text-lg">
              <Layers3 className="h-5 w-5 text-emerald-700" />
              既存保有・今月の買い増し検討順
            </CardTitle>
            <CardDescription className="mt-1 max-w-3xl text-xs leading-5">
              価格帯だけでなく、数量・単一銘柄5%上限・業種集中・IBKR借入・未照合・最新シグナル・資料品質・確認済み懸念を通過した候補です。
            </CardDescription>
          </div>
          <div className="shrink-0 rounded-2xl border border-emerald-200 bg-white/80 px-4 py-2.5 text-center dark:border-emerald-900 dark:bg-background/70">
            <p className="text-[10px] font-medium text-muted-foreground">今月レビュー</p>
            <p className="font-mono text-2xl font-semibold text-emerald-800 dark:text-emerald-200">
              {summary.reviewReadyCount}
              <span className="ml-1 text-xs font-normal">銘柄</span>
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              主力 {summary.reviewReadyMainCount} / 小幅 {summary.reviewReadySmallCount}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-3 gap-2" data-testid="existing-holding-add-funnel">
          <div className="rounded-xl border bg-background/75 p-2.5 text-center">
            <p className="text-[10px] text-muted-foreground">価格帯内</p>
            <p className="mt-0.5 font-mono text-base font-semibold">
              {summary.rawAddZoneCount}
            </p>
          </div>
          <div className="rounded-xl border bg-background/75 p-2.5 text-center">
            <p className="text-[10px] text-muted-foreground">安全ゲート通過</p>
            <p className="mt-0.5 font-mono text-base font-semibold">
              {summary.safetyGatePassedCount}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-100/60 p-2.5 text-center dark:border-emerald-900 dark:bg-emerald-950/45">
            <p className="text-[10px] text-emerald-800 dark:text-emerald-200">厳格確認済み</p>
            <p className="mt-0.5 font-mono text-base font-semibold text-emerald-900 dark:text-emerald-100">
              {summary.reviewReadyCount}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-xs leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>検討用の参考案であり、注文ではありません。</strong>
            実行前に決算・ニュース・口座余力を再確認し、必ず本人確認後に発注します。残り
            {summary.reviewOnlyCount}銘柄は条件不足または懸念ありのため保留です。
          </p>
        </div>

        {visibleCandidates.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleCandidates.map(candidate => (
              <CandidateRow key={candidate.symbol} candidate={candidate} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            現在、すべての厳格条件を通過した買い増し候補はありません。無理に買わず、価格・資料・リスク条件の更新を待ちます。
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-emerald-100 pt-3 text-xs dark:border-emerald-950 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-1.5 leading-5 text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            AI保有シグナルの HOLD は「現在の保有を維持」。価格帯に基づく買い増し検討とは別の判断軸です。
          </p>
          {compact ? (
            <Button asChild size="sm" variant="outline" className="bg-background">
              <Link href="/buy-plans">
                全候補と保留理由を見る
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {summary.policyVersion}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
