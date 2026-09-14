import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { formatMoney } from "@shared/investing";
import {
  ArrowRight,
  BriefcaseBusiness,
  Eye,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const STATUS_LABELS = {
  HELD: "保有中",
  WATCHED: "ウォッチ中",
  UNREGISTERED: "未登録",
} as const;

export function GlobalStockSearch() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const search = trpc.portfolio.searchSecurities.useMutation({
    onError: error => toast.error(error.message),
  });
  const generateProposal = trpc.watchlist.generateProposal.useMutation({
    onError: error =>
      toast.warning("銘柄は追加済みです。AI提案はウォッチリストから再実行できます", {
        description: error.message,
      }),
  });
  const add = trpc.watchlist.add.useMutation({
    onSuccess: async result => {
      await utils.watchlist.invalidate();
      toast.success("ウォッチリストに追加しました。AI提案を作成します");
      generateProposal.mutate({ id: result.id });
      setLocation(`/watchlist?focus=${result.id}`);
    },
    onError: error => toast.error(error.message),
    onSettled: () => setPendingSymbol(null),
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const normalized = query.trim();
    if (!normalized || search.isPending) return;
    search.mutate({ query: normalized, limit: 8 });
  };

  const results = search.data ?? [];

  return (
    <div
      className="w-full scroll-mt-20 rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-emerald-50/80 via-white to-sky-50/70 p-3 shadow-sm dark:border-emerald-900/60 dark:from-emerald-950/30 dark:via-background dark:to-sky-950/20"
      data-testid="global-stock-search"
    >
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-700 text-white">
            <Search className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor="global-stock-query" className="sr-only">
              会社名または銘柄コードを検索
            </label>
            <Input
              id="global-stock-query"
              value={query}
              onChange={event => {
                setQuery(event.target.value);
                if (search.data || search.error) search.reset();
              }}
              placeholder="会社名・コードを検索（V03 / Venture / AAPL）"
              autoComplete="off"
              className="h-10 border-0 bg-white/90 shadow-none focus-visible:ring-emerald-600 dark:bg-slate-950/80"
            />
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          className="h-10 shrink-0 px-5"
          disabled={!query.trim() || search.isPending}
        >
          {search.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-1.5 h-4 w-4" />
          )}
          全市場を検索
        </Button>
      </form>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        日本・米国・シンガポール・香港・台湾・韓国に対応。SGXは V03 のような裸コードでも検索できます。
      </p>

      {search.isSuccess ? (
        <div className="mt-3 space-y-2" role="region" aria-label="株式検索結果">
          {results.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-white/70 px-4 py-3 text-sm text-muted-foreground dark:bg-slate-950/50">
              一致する相場情報が見つかりませんでした。会社名、完全な銘柄コード、または市場サフィックスを確認してください。
            </div>
          ) : (
            results.map(result => {
              const holding = result.existingHoldings[0] ?? null;
              const actionBusy = pendingSymbol === result.symbol && add.isPending;
              return (
                <div
                  key={result.symbol}
                  className="flex flex-col gap-3 rounded-xl border bg-white/85 p-3 dark:bg-slate-950/70 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`global-stock-result-${result.symbol}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground">{result.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {result.symbol}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {result.marketLabel}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          result.registrationStatus === "HELD"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                            : result.registrationStatus === "WATCHED"
                              ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
                              : "text-muted-foreground"
                        }
                      >
                        {STATUS_LABELS[result.registrationStatus]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {result.exchangeName ?? result.marketLabel} ・ 現在値 {formatMoney(result.price, result.currency ?? undefined)}
                      {result.priceAsOf
                        ? ` ・ ${new Date(result.priceAsOf).toLocaleDateString("ja-JP")}時点`
                        : ""}
                    </p>
                  </div>
                  {holding ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setLocation(`/holdings/${holding.id}`)}
                    >
                      <BriefcaseBusiness className="mr-1.5 h-4 w-4" />
                      保有詳細を見る
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  ) : result.existingWatch ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() =>
                        setLocation(`/watchlist?focus=${result.existingWatch!.id}`)
                      }
                    >
                      <Eye className="mr-1.5 h-4 w-4" />
                      ウォッチカードを見る
                      <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={add.isPending}
                      onClick={() => {
                        setPendingSymbol(result.symbol);
                        add.mutate({ code: result.symbol, name: result.name });
                      }}
                    >
                      {actionBusy ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-1.5 h-4 w-4" />
                      )}
                      ウォッチリストに追加
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
