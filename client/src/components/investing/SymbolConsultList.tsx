/**
 * 銘柄詳細に出す、その銘柄の相談履歴。
 *
 * 相談画面を開かないと過去に相談したか分からない状態だと
 * 「前に検討した」ことに気付けないため、銘柄の側からも辿れるようにする。
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Plus } from "lucide-react";
import { Link } from "wouter";

export type SymbolConsultRow = {
  id: number;
  title: string;
  messageCount: number;
  updatedAt: Date | string;
  lastAnswerHead: string | null;
};

export function SymbolConsultList({
  symbol,
  rows,
  isPending,
}: {
  symbol: string;
  rows: SymbolConsultRow[];
  isPending: boolean;
}) {
  if (isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            この銘柄についての相談はまだありません
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link href={`/consult?symbol=${encodeURIComponent(symbol)}`}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              この銘柄について相談する
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map(r => (
        <Link key={r.id} href={`/consult?id=${r.id}`}>
          <Card className="transition-colors hover:bg-accent/40">
            <CardContent className="py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm font-medium">{r.title}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {new Date(r.updatedAt).toLocaleDateString()}
                </span>
              </div>
              {r.lastAnswerHead ? (
                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                  {r.lastAnswerHead}
                </p>
              ) : null}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {r.messageCount} 件のやり取り
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
      <Button asChild variant="outline" size="sm" className="w-full">
        <Link href={`/consult?symbol=${encodeURIComponent(symbol)}`}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          新しく相談する
        </Link>
      </Button>
    </div>
  );
}
