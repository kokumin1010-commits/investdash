import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { useBatchRun } from "@/hooks/useBatchRun";
import { SENTIMENT_STYLES, impactLabel, sentimentLabel, type Sentiment } from "@shared/investing";
import { ExternalLink, Newspaper, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

export default function News() {
  const utils = trpc.useUtils();
  const news = trpc.news.list.useQuery({ limit: 150 });
  const overview = trpc.portfolio.overview.useQuery();
  const [query, setQuery] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState<"ALL" | Sentiment>("ALL");
  const [symbolFilter, setSymbolFilter] = useState("ALL");
  const [minImpact, setMinImpact] = useState("0");

  // 本番の 180 秒制限を超えるため、nextOffset を辿って小分けに実行する
  const syncBatch = trpc.news.syncAll.useMutation();
  const syncRun = useBatchRun({
    runBatch: offset => syncBatch.mutateAsync({ offset, batchSize: 4 }),
    onDone: async results => {
      await utils.invalidate();
      const fetched = results.reduce((a, r) => a + r.fetched, 0);
      const analyzed = results.reduce((a, r) => a + r.analyzed, 0);
      toast.success(
        fetched > 0
          ? `${fetched} 件を取得し、${analyzed} 件を分析しました`
          : "新しいニュースはありませんでした"
      );
    },
    onError: e => toast.error(e instanceof Error ? e.message : "ニュースを取得できませんでした"),
  });

  const items = news.data ?? [];

  const symbolOptions = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach(i => map.set(i.symbol, i.companyName));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "ja"));
  }, [items]);

  const filtered = useMemo(() => {
    const min = Number(minImpact);
    return items.filter(i => {
      if (sentimentFilter !== "ALL" && i.sentiment !== sentimentFilter) return false;
      if (symbolFilter !== "ALL" && i.symbol !== symbolFilter) return false;
      if ((i.impactScore ?? 0) < min) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (
          !i.title.toLowerCase().includes(q) &&
          !i.companyName.toLowerCase().includes(q) &&
          !(i.summary ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [items, sentimentFilter, symbolFilter, minImpact, query]);

  const stats = useMemo(() => {
    const s = { POSITIVE: 0, NEGATIVE: 0, NEUTRAL: 0, unanalyzed: 0 };
    items.forEach(i => {
      if (!i.sentiment) s.unanalyzed += 1;
      else s[i.sentiment] += 1;
    });
    return s;
  }, [items]);

  const holdingIdBySymbol = useMemo(() => {
    const map = new Map<string, number>();
    // 複数口座で保有する銘柄は代表 1 件（評価額が最大の口座）へリンクする
    (overview.data?.groups ?? []).forEach(p => map.set(p.symbol, p.entries[0].id));
    return map;
  }, [overview.data]);

  if (news.isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">ニュースモニタリング</h1>
          <p className="text-sm text-muted-foreground">
            保有・ウォッチ銘柄に関する {items.length} 件
            {overview.data?.summary.lastNewsSyncAt
              ? ` ・ 最終取得 ${new Date(overview.data.summary.lastNewsSyncAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
              : ""}
          </p>
        </div>
        <Button
          size="sm"
          disabled={syncRun.progress.running}
          onClick={() => void syncRun.start()}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${syncRun.progress.running ? "animate-spin" : ""}`}
          />
          {syncRun.progress.running
            ? `取得中 ${syncRun.progress.processed}/${syncRun.progress.total || "…"} 銘柄`
            : "ニュースを取得・分析"}
        </Button>
      </header>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatChip label="ポジティブ" value={stats.POSITIVE} tone="text-gain" />
          <StatChip label="ネガティブ" value={stats.NEGATIVE} tone="text-loss" />
          <StatChip label="中立" value={stats.NEUTRAL} tone="text-muted-foreground" />
          <StatChip label="未分析" value={stats.unanalyzed} tone="text-muted-foreground" />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="キーワード検索"
            className="h-9 pl-8"
          />
        </div>
        <Select value={symbolFilter} onValueChange={setSymbolFilter}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">すべての銘柄</SelectItem>
            {symbolOptions.map(([sym, name]) => (
              <SelectItem key={sym} value={sym}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sentimentFilter} onValueChange={v => setSentimentFilter(v as typeof sentimentFilter)}>
          <SelectTrigger className="h-9 w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">すべての評価</SelectItem>
            <SelectItem value="POSITIVE">ポジティブ</SelectItem>
            <SelectItem value="NEGATIVE">ネガティブ</SelectItem>
            <SelectItem value="NEUTRAL">中立</SelectItem>
          </SelectContent>
        </Select>
        <Select value={minImpact} onValueChange={setMinImpact}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">影響度すべて</SelectItem>
            <SelectItem value="20">影響度 20 以上</SelectItem>
            <SelectItem value="50">影響度 50 以上</SelectItem>
            <SelectItem value="80">影響度 80 以上</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
              <Newspaper className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-1.5">
              <h2 className="font-semibold">ニュースがまだ取得されていません</h2>
              <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
                保有銘柄とウォッチリスト銘柄に関するニュースを取得し、AI が内容と影響度を判定します。
              </p>
            </div>
            <Button disabled={syncRun.progress.running} onClick={() => void syncRun.start()}>
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${syncRun.progress.running ? "animate-spin" : ""}`}
              />
              {syncRun.progress.running
                ? `取得中 ${syncRun.progress.processed}/${syncRun.progress.total || "…"} 銘柄`
                : "ニュースを取得"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(item => {
            const holdingId = holdingIdBySymbol.get(item.symbol);
            return (
              <Card key={item.id} className="transition-colors hover:bg-accent/30">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {holdingId ? (
                          <Link
                            href={`/holdings/${holdingId}`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            {item.companyName}
                          </Link>
                        ) : (
                          <span className="text-xs font-medium text-muted-foreground">
                            {item.companyName}
                          </span>
                        )}
                        <span className="tabular text-[11px] text-muted-foreground">{item.symbol}</span>
                      </div>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex items-start gap-1.5"
                      >
                        <span className="text-sm font-medium leading-snug group-hover:underline">
                          {item.title}
                        </span>
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                      </a>

                      {item.summary ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">{item.summary}</p>
                      ) : null}

                      {item.reasoning ? (
                        <p className="border-l-2 border-border pl-2.5 text-[11px] leading-relaxed text-muted-foreground">
                          <span className="font-medium">AI 判定理由: </span>
                          {item.reasoning}
                        </p>
                      ) : null}

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {item.source ? <span>{item.source}</span> : null}
                        {item.publishedAt ? (
                          <span>
                            {new Date(item.publishedAt).toLocaleString("ja-JP", {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {item.sentiment ? (
                        <Badge
                          variant="outline"
                          className={`text-[11px] ${SENTIMENT_STYLES[item.sentiment]}`}
                        >
                          {sentimentLabel(item.sentiment)}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-dashed text-[11px] text-muted-foreground">
                          未分析
                        </Badge>
                      )}
                      {item.impactScore !== null ? (
                        <div className="text-right">
                          <p className="tabular text-sm font-semibold">{item.impactScore}</p>
                          <p className="text-[10px] text-muted-foreground">
                            影響度{impactLabel(item.impactScore)}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                条件に一致するニュースがありません
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <DisclaimerNote />
    </div>
  );
}

function StatChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`tabular text-lg font-semibold ${tone}`}>{value}</span>
      </CardContent>
    </Card>
  );
}
