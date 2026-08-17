import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Sparkles, Check, Clock, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

/**
 * AI の買い増し提案。
 *
 * 買い増しプランは「どの価格帯で何をするか」を示すが、それを見て
 * 「今この銘柄を買うべきか」を決めるのは自分でやることになっていた。
 * その最後の一歩を AI が結論付ける。
 *
 * 一覧の上に置くのは、月 1 回開いたときに最初に見るべきものが
 * 「結論」だから。112 行の表から探させるのでは判断が始まらない。
 */

/** 結論ごとの見せ方。買うものが埋もれないよう色で差を付ける */
const STANCE: Record<string, { label: string; className: string; icon: typeof Check }> = {
  BUY: {
    label: "買う",
    className:
      "border-emerald-300 bg-emerald-100/70 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    icon: Check,
  },
  WAIT: {
    label: "待つ",
    className:
      "border-amber-300 bg-amber-100/60 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    icon: Clock,
  },
  SKIP: {
    label: "見送る",
    className: "border-border bg-muted text-muted-foreground",
    icon: XCircle,
  },
};

function manYen(jpy: number): string {
  if (jpy >= 100_000_000) return `${(jpy / 100_000_000).toFixed(2)} 億円`;
  return `${Math.round(jpy / 10_000).toLocaleString("ja-JP")} 万円`;
}

function fmtPrice(v: number, currency: string): string {
  const digits = currency === "JPY" ? 0 : 2;
  const n = v.toLocaleString("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (currency === "JPY") return `￥${n}`;
  if (currency === "USD") return `$${n}`;
  // SGD / HKD は記号を省くと単位が分からなくなるため通貨コードを前に置く
  return `${currency} ${n}`;
}

export function AddProposalCard() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.portfolio.addProposals.useQuery();
  const [busy, setBusy] = useState(false);

  const generate = trpc.portfolio.generateAddProposalBatch.useMutation({
    onSuccess: res => {
      setBusy(false);
      void utils.portfolio.addProposals.invalidate();
      if (res.generated === 0 && res.skipped > 0) {
        // 何も起きなかったように見えるのを防ぐ。理由を伝える
        toast.info("直近 3 日以内に提案済みの銘柄のみでした", {
          description: "判断が必要な銘柄は既に提案が出ています",
        });
        return;
      }
      if (res.generated === 0) {
        toast.info("今すぐ判断が必要な銘柄はありませんでした");
        return;
      }
      toast.success(`${res.generated} 銘柄の提案を作りました`, {
        description:
          res.failed > 0 ? `${res.failed} 銘柄は失敗しました` : "買う・待つ・見送るで結論が出ています",
      });
    },
    onError: err => {
      setBusy(false);
      toast.error("提案の生成に失敗しました", { description: err.message });
    },
  });

  const proposals = data ?? [];
  const buyCount = proposals.filter(p => p.stance === "BUY").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              AI の買い増し提案
            </CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              資産全体・借入・業種の偏りを見て、買う・待つ・見送るを結論付けます。
              金額は現金性資産から算出した範囲に収めています。
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="bg-background"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              generate.mutate({ limit: 6 });
            }}
          >
            <Sparkles className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-pulse" : ""}`} />
            {busy ? "AI が判断中..." : "判断が必要な銘柄を提案させる"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {isLoading ? (
          <p className="text-muted-foreground text-sm">読み込み中...</p>
        ) : proposals.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            まだ提案がありません。上のボタンを押すと、買い増しの段にいる銘柄・
            懸念が記録されている銘柄・次の段が近い銘柄について結論を出します。
          </p>
        ) : (
          <>
            {buyCount > 0 ? (
              <p className="text-sm">
                <span className="font-medium text-gain">{buyCount} 銘柄</span>
                <span className="text-muted-foreground"> に買いの結論が出ています</span>
              </p>
            ) : null}
            {proposals.map(p => {
              const s = STANCE[p.stance] ?? STANCE.WAIT;
              const Icon = s.icon;
              return (
                <div key={p.id} className="bg-muted/40 space-y-2 rounded-lg px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant="outline" className={`text-[10px] ${s.className}`}>
                      <Icon className="mr-1 h-3 w-3" />
                      {s.label}
                    </Badge>
                    <Link
                      href={p.held ? `/holdings?symbol=${p.symbol}` : "/watchlist"}
                      className="font-medium hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="tabular text-xs text-muted-foreground">{p.symbol}</span>
                    {!p.held ? (
                      <Badge
                        variant="outline"
                        className="border-sky-300 bg-sky-100/60 text-[10px] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                      >
                        未保有
                      </Badge>
                    ) : null}
                  </div>

                  <p className="text-sm leading-relaxed">{p.conclusion}</p>

                  {/* 金額と指値。BUY のときだけ出す（待つ・見送るでは意味がない） */}
                  {p.stance === "BUY" && p.amountBase !== null ? (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span>
                        <span className="text-muted-foreground">目安額 </span>
                        <span className="tabular font-medium">{manYen(p.amountBase)}</span>
                      </span>
                      {p.limitPrice !== null ? (
                        <span>
                          <span className="text-muted-foreground">指値 </span>
                          <span className="tabular font-medium">
                            {fmtPrice(p.limitPrice, p.currency)}
                          </span>
                        </span>
                      ) : null}
                      {p.sharePctAtProposal !== null ? (
                        <span className="text-muted-foreground tabular">
                          今の構成比 {p.sharePctAtProposal.toFixed(2)}%
                        </span>
                      ) : null}
                    </div>
                  ) : p.limitPrice !== null ? (
                    <p className="tabular text-xs text-muted-foreground">
                      待つ価格 {fmtPrice(p.limitPrice, p.currency)}
                    </p>
                  ) : null}

                  <p className="text-muted-foreground text-xs leading-relaxed">{p.rationale}</p>

                  {p.invalidation ? (
                    <p className="text-xs leading-relaxed">
                      <span className="text-muted-foreground">覆す条件: </span>
                      {p.invalidation}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{new Date(p.createdAt).toLocaleDateString("ja-JP")}</span>
                    {/*
                      提案時から株価が動いていると結論が古びている可能性がある。
                      日付だけでは「まだ有効か」が判断できない。
                    */}
                    {p.priceChangePct !== null && Math.abs(p.priceChangePct) >= 1 ? (
                      <span className="tabular">
                        提案時から {p.priceChangePct > 0 ? "+" : ""}
                        {p.priceChangePct.toFixed(1)}%
                      </span>
                    ) : null}
                    <Link href="/consult" className="hover:underline">
                      この件を相談する
                    </Link>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}
