import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  BAND_ACTION_LABELS,
  BAND_ACTION_STYLES,
  type BandAction,
} from "@shared/priceBands";
import { AlertTriangle, ArrowDown, Search, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { TransitionHistoryCard } from "@/components/investing/TransitionHistoryCard";

/**
 * 買い増しプランの一覧。
 *
 * 112 銘柄を 1 つずつ開いて確認するのは現実的でないため、
 * 「今どの段にいるか」を横断で見て、買い増し圏に入っている銘柄と
 * 確認が必要な銘柄だけを拾えるようにする。
 */

type Filter = "ALL" | "BUY" | "VERIFY" | "OUTSIDE";

const FILTERS: Array<{ key: Filter; label: string; hint: string }> = [
  { key: "BUY", label: "買い増し圏", hint: "打診買い・主力買い増しの段にいる銘柄" },
  { key: "VERIFY", label: "確認が必要", hint: "下落要因を確かめる段にいる銘柄" },
  { key: "OUTSIDE", label: "価格帯の外", hint: "登録した段より上か下にいる銘柄" },
  { key: "ALL", label: "すべて", hint: "プランがある全銘柄" },
];

export default function BuyPlans() {
  const [filter, setFilter] = useState<Filter>("BUY");
  const [keyword, setKeyword] = useState("");

  const { data, isLoading, error } = trpc.portfolio.priceBandOverview.useQuery();

  const rows = useMemo(() => {
    if (!data) return [];
    const kw = keyword.trim().toLowerCase();
    return data
      .filter(r => {
        if (kw && !r.name.toLowerCase().includes(kw) && !r.symbol.toLowerCase().includes(kw)) {
          return false;
        }
        switch (filter) {
          case "BUY":
            return r.action === "ADD_SMALL" || r.action === "ADD_MAIN";
          case "VERIFY":
            return r.action === "VERIFY";
          case "OUTSIDE":
            return r.outsideDirection !== null;
          default:
            return true;
        }
      })
      .sort((a, b) => {
        /*
         * 買う量が多い段を上に出す。同じ段なら「次の段まで近い」順。
         * 迷ったときに上から見れば良い並びにする。
         */
        const rank = (x: typeof a) =>
          x.action === "ADD_MAIN"
            ? 0
            : x.action === "ADD_SMALL"
              ? 1
              : x.action === "VERIFY"
                ? 2
                : x.action === "REDUCE"
                  ? 3
                  : 4;
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        const ag = a.nextGapPct === null ? -Infinity : a.nextGapPct;
        const bg = b.nextGapPct === null ? -Infinity : b.nextGapPct;
        return bg - ag;
      });
  }, [data, filter, keyword]);

  const counts = useMemo(() => {
    const c = { BUY: 0, VERIFY: 0, OUTSIDE: 0, ALL: 0 };
    for (const r of data ?? []) {
      c.ALL += 1;
      if (r.action === "ADD_SMALL" || r.action === "ADD_MAIN") c.BUY += 1;
      if (r.action === "VERIFY") c.VERIFY += 1;
      if (r.outsideDirection !== null) c.OUTSIDE += 1;
    }
    return c;
  }, [data]);

  const needsCheckCount = (data ?? []).filter(r => r.needsCheck).length;
  const concernCount = (data ?? []).filter(r => r.concernCount > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">買い増しプラン</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            AI が銘柄ごとに価格帯と行動を作ります。今どの段にいるかで判断してください。
          </p>
        </div>
      </div>

      {/* 今すぐ見るべきものがあるかを最初に出す */}
      {(counts.BUY > 0 || needsCheckCount > 0) && (
        <Card className="border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
            {counts.BUY > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="size-4 text-emerald-600" />
                <span className="font-medium">{counts.BUY} 銘柄</span>
                <span className="text-muted-foreground">が買い増しの価格帯に入っています</span>
              </div>
            )}
            {needsCheckCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 text-amber-600" />
                <span className="font-medium">{needsCheckCount} 銘柄</span>
                <span className="text-muted-foreground">が未照合の確認項目を持っています</span>
              </div>
            )}
            {concernCount > 0 && (
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 text-rose-600" />
                <span className="font-medium">{concernCount} 銘柄</span>
                <span className="text-muted-foreground">に懸念材料が見つかっています</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <Button
            key={f.key}
            size="sm"
            variant={filter === f.key ? "default" : "outline"}
            className={filter === f.key ? "" : "bg-background"}
            onClick={() => setFilter(f.key)}
            title={f.hint}
          >
            {f.label}
            <span className="ml-1.5 opacity-70">{counts[f.key]}</span>
          </Button>
        ))}
        <div className="relative ml-auto w-full sm:w-56">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            placeholder="銘柄名・ティッカー"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-rose-600">
            一覧を読み込めませんでした: {error.message}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && rows.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">該当する銘柄はありません</CardTitle>
            <CardDescription>
              {filter === "BUY"
                ? "今は買い増しの価格帯に入っている銘柄がありません。価格が下がるとここに出ます。"
                : filter === "VERIFY"
                  ? "下落要因を確認すべき段にいる銘柄はありません。"
                  : "条件を変えて試してください。"}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="space-y-2">
        {rows.map(r => (
          <PlanRow key={r.symbol} row={r} />
        ))}
      </div>

      {/*
        判定変化の履歴は一覧の下に置く。
        今の判定（何をすべきか）が先に来るべきで、履歴は
        「見逃していないか」を後から確かめるためのものだから。
      */}
      <TransitionHistoryCard />
    </div>
  );
}

type Row = {
  symbol: string;
  name: string;
  currency: string;
  currentPrice: number | null;
  action: BandAction | null;
  actionLabel: string | null;
  outsideDirection: "ABOVE" | "BELOW" | null;
  nextGapPct: number | null;
  nextActionLabel: string | null;
  needsCheck: boolean;
  concernCount: number;
};

function PlanRow({ row }: { row: Row }) {
  const price =
    row.currentPrice === null
      ? "株価未取得"
      : `${row.currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${row.currency}`;

  return (
    <Link href={`/holdings?symbol=${encodeURIComponent(row.symbol)}`}>
      <Card className="hover:border-primary/40 cursor-pointer transition-colors">
        {/*
         * スマホでは横並びにすると銘柄名が「リ...」まで省略されて読めなくなるため
         * 縦に積む。PC では横並びにして一覧性を保つ。
         */}
        <CardContent className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium break-words">{row.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs">{row.symbol}</span>
            </div>
            <div className="text-muted-foreground mt-0.5 text-sm">{price}</div>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
            {row.action ? (
              <Badge variant="outline" className={BAND_ACTION_STYLES[row.action]}>
                {row.actionLabel ?? BAND_ACTION_LABELS[row.action]}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-900/40"
              >
                {row.outsideDirection === "ABOVE"
                  ? "価格帯より上（対象外）"
                  : row.outsideDirection === "BELOW"
                    ? "価格帯より下（想定外の下落）"
                    : "判定できません"}
              </Badge>
            )}

            {/* 次の段までの距離。買い場がどれだけ近いかが一番知りたい情報 */}
            {row.nextGapPct !== null && row.nextActionLabel && (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <ArrowDown className="size-3" />
                {row.nextGapPct.toFixed(1)}% で「{row.nextActionLabel}」
              </div>
            )}

            {row.concernCount > 0 && (
              <span className="text-xs text-rose-600">懸念 {row.concernCount} 件</span>
            )}
            {row.needsCheck && row.concernCount === 0 && (
              <span className="text-xs text-amber-600">確認項目が未照合</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
