import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Brain, CheckCircle2, Clock3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export type WatchProposalDraftView = {
  id: number;
  watchItemId: number;
  symbol: string;
  stance: "BUY" | "WAIT" | "SKIP";
  conclusion: string;
  rationale: string;
  amountBase: number | null;
  limitPrice: number | null;
  priceAtProposal: number | null;
  buyConditions: string;
  invalidation: string | null;
  confidence: number;
  evidence: {
    generatedAt: string;
    price: number | null;
    priceUpdatedAt: string | null;
    rangeLow6m: number | null;
    rangeHigh6m: number | null;
    annualDividend: number | null;
    dividendCurrency: string | null;
    sector: string | null;
    industry: string | null;
    newsCount: number;
    latestNewsAt: string | null;
    fetchedNews: number;
    analyzedNews: number;
  } | null;
  model: string | null;
  createdAt: Date | string;
};

const STANCE_LABELS = {
  BUY: "今買う",
  WAIT: "価格を待つ",
  SKIP: "今回は見送る",
} as const;

const STANCE_STYLES = {
  BUY: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  WAIT: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  SKIP: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300",
} as const;

function asNumber(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function WatchProposalReviewDialog({
  proposal,
  open,
  onOpenChange,
}: {
  proposal: WatchProposalDraftView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const [targetPrice, setTargetPrice] = useState("");
  const [plannedAmount, setPlannedAmount] = useState("");
  const [watchReason, setWatchReason] = useState("");
  const [buyConditions, setBuyConditions] = useState("");

  const defaultConditions = useMemo(() => {
    if (!proposal) return "";
    return [
      proposal.buyConditions,
      proposal.invalidation ? `判断を見直す条件: ${proposal.invalidation}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  }, [proposal]);

  useEffect(() => {
    if (!proposal || !open) return;
    setTargetPrice(proposal.limitPrice === null ? "" : String(proposal.limitPrice));
    setPlannedAmount(proposal.amountBase === null ? "" : String(proposal.amountBase));
    setWatchReason(proposal.rationale);
    setBuyConditions(defaultConditions);
  }, [defaultConditions, open, proposal]);

  const review = trpc.watchlist.reviewProposal.useMutation({
    onSuccess: async result => {
      await utils.watchlist.invalidate();
      toast.success(
        result.status === "REJECTED"
          ? "AI 提案を見送りました"
          : result.status === "EDITED"
            ? "修正した内容で保存しました"
            : "AI 提案を確認して保存しました"
      );
      onOpenChange(false);
    },
    onError: error => toast.error(error.message),
  });

  if (!proposal) return null;

  const currentTarget = asNumber(targetPrice);
  const currentAmount = asNumber(plannedAmount);
  const currentPrice = proposal.evidence?.price ?? proposal.priceAtProposal;
  const edited =
    currentTarget !== proposal.limitPrice ||
    currentAmount !== proposal.amountBase ||
    watchReason.trim() !== proposal.rationale ||
    buyConditions.trim() !== defaultConditions;
  const gap =
    currentPrice !== null && proposal.limitPrice !== null && currentPrice > 0
      ? ((proposal.limitPrice - currentPrice) / currentPrice) * 100
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>AI 買付提案を確認</DialogTitle>
            <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-700">
              AI提案・要確認
            </Badge>
          </div>
          <DialogDescription>
            数字は自動で確定しません。根拠を読み、採用・修正・見送りを選んでください。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{proposal.symbol}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Gemini 3 Flash による下書き</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={STANCE_STYLES[proposal.stance]}>
                  {STANCE_LABELS[proposal.stance]}
                </Badge>
                <span className="tabular text-xs text-muted-foreground">確信度 {proposal.confidence}</span>
              </div>
            </div>
            <p className="mt-3 text-sm font-medium leading-relaxed">{proposal.conclusion}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{proposal.rationale}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-xl border bg-background p-3 text-center">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">現在値</p>
              <p className="mt-1 tabular text-sm font-semibold">
                {currentPrice?.toLocaleString("ja-JP") ?? "—"}
              </p>
            </div>
            <div className="border-x px-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">AI目標</p>
              <p className="mt-1 tabular text-sm font-semibold">
                {proposal.limitPrice?.toLocaleString("ja-JP") ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">値幅</p>
              <p className={`mt-1 tabular text-sm font-semibold ${gap !== null && gap < 0 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                {gap === null ? "—" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`}
              </p>
            </div>
            <p className="col-span-3 border-t pt-2 text-[10px] text-muted-foreground">
              株価取得 {proposal.evidence?.priceUpdatedAt
                ? new Date(proposal.evidence.priceUpdatedAt).toLocaleString("ja-JP")
                : "時刻未取得"}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="proposal-target">目標買付価格（現地通貨）</Label>
              <Input
                id="proposal-target"
                type="number"
                inputMode="decimal"
                value={targetPrice}
                onChange={event => setTargetPrice(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                現在値から {gap === null ? "比較できません" : `${Math.abs(gap).toFixed(1)}% ${gap < 0 ? "下" : "上"}`}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-amount">投資予定額（円）</Label>
              <Input
                id="proposal-amount"
                type="number"
                inputMode="decimal"
                value={plannedAmount}
                onChange={event => setPlannedAmount(event.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">借入を増やさず、構成比上限内で算定</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="proposal-reason">注目理由・提案根拠</Label>
            <Textarea
              id="proposal-reason"
              rows={4}
              value={watchReason}
              onChange={event => setWatchReason(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proposal-conditions">買付条件</Label>
            <Textarea
              id="proposal-conditions"
              rows={4}
              value={buyConditions}
              onChange={event => setBuyConditions(event.target.value)}
            />
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/20">
            <div className="flex items-center gap-2 font-medium">
              <Brain className="h-4 w-4" />
              判断に使った材料
            </div>
            <div className="mt-2 grid gap-1.5 text-muted-foreground sm:grid-cols-2">
              <span>ニュース {proposal.evidence?.newsCount ?? 0} 件</span>
              <span>今回取得 {proposal.evidence?.fetchedNews ?? 0} 件</span>
              <span>
                6か月レンジ {proposal.evidence?.rangeLow6m?.toLocaleString("ja-JP") ?? "—"}〜
                {proposal.evidence?.rangeHigh6m?.toLocaleString("ja-JP") ?? "—"}
              </span>
              <span>
                年間配当 {proposal.evidence?.annualDividend?.toLocaleString("ja-JP") ?? "未取得"}
              </span>
            </div>
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                生成 {new Date(proposal.createdAt).toLocaleString("ja-JP")}。価格やニュースが変わったら再確認してください。
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>目標価格は将来価値の保証ではありません。注文前に最新の株価・決算・為替を確認してください。</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:flex-wrap">
          <Button variant="ghost" disabled={review.isPending} onClick={() => onOpenChange(false)}>
            あとで確認
          </Button>
          <Button
            variant="outline"
            disabled={review.isPending}
            onClick={() => review.mutate({ proposalId: proposal.id, decision: "REJECT" })}
          >
            今回は見送る
          </Button>
          <Button
            disabled={review.isPending}
            onClick={() =>
              review.mutate(
                edited
                  ? {
                      proposalId: proposal.id,
                      decision: "EDIT",
                      targetPrice: currentTarget,
                      plannedAmount: currentAmount,
                      watchReason,
                      buyConditions,
                    }
                  : { proposalId: proposal.id, decision: "ACCEPT" }
              )
            }
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            {review.isPending ? "保存中..." : edited ? "修正して保存" : "提案を採用して保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
