/**
 * AI レポートの一覧と本文。
 *
 * 画面を月 1 回しか開かない使い方のため、見に行かなくても
 * 「何が起きたか」が残っている状態にする。
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { ArrowLeft, FileText, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

const KIND_LABEL: Record<string, string> = {
  WEEKLY: "定期",
  EARNINGS: "決算",
  NEWS: "重要ニュース",
};

function formatDateTime(d: Date | string) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 本文の Markdown を最小限だけ整形して表示する。
 *
 * ライブラリを足さずに ## の節と段落だけ扱う。レポートは AI が
 * 生成した平文に近く、表や画像は出てこないため。
 */
/**
 * AI の本文を表示できる形に整える。
 *
 * 実測した本文は改行がほとんど無く「## 判断・確認が必要な銘柄  ### 買い増し
 * 候補の検討（5銘柄）  現在、伊藤忠商事…」のように全部が 1 行に繋がっていた。
 * 空行だけで区切ると見出しの中に本文が丸ごと入り、見出しが数百文字になる。
 *
 * そこで、見出し記号の前で割るだけでなく、見出し行そのものを
 * 「見出し」と「その後に続く本文」に切り分ける。見出しは通常 1 行で終わるため、
 * 2 個以上の空白または改行までを見出しとして扱う。
 */
export type ReportBlock =
  | { kind: "h3"; text: string }
  | { kind: "h4"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "p"; text: string };

export function parseReportBody(body: string): ReportBlock[] {
  // 見出し記号の直前で必ず改行を入れる
  const withBreaks = body.replace(/([^\n])\s*(#{2,4}\s)/g, "$1\n\n$2");
  const blocks: ReportBlock[] = [];

  for (const raw of withBreaks.split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;

    // s フラグは対象環境で使えないため [\s\S] で代替する
    const heading = chunk.match(/^(#{2,4})\s*([\s\S]*)$/);
    if (heading) {
      const level = heading[1].length;
      const rest = heading[2];
      /*
       * 見出しの後ろに本文が続いている場合を切り離す。
       * 2 個以上の空白、または改行が境目になる。
       */
      const split = rest.match(/^(.*?)(?:\s{2,}|\n)([\s\S]+)$/);
      const title = (split ? split[1] : rest).trim();
      if (title) blocks.push({ kind: level >= 3 ? "h4" : "h3", text: title });
      const tail = split?.[2]?.trim();
      if (tail) blocks.push(...parseReportBody(tail));
      continue;
    }

    if (/^[-*]\s/m.test(chunk)) {
      const items = chunk
        .split("\n")
        .filter(l => /^[-*]\s/.test(l.trim()))
        .map(l => l.trim().replace(/^[-*]\s*/, ""));
      if (items.length > 0) {
        blocks.push({ kind: "list", items });
        continue;
      }
    }

    blocks.push({ kind: "p", text: chunk });
  }

  return blocks;
}

function ReportBody({ body }: { body: string }) {
  const blocks = parseReportBody(body);

  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.kind === "h3") {
          return (
            <h3 key={i} className="border-b pt-2 pb-1 text-base font-semibold">
              {block.text}
            </h3>
          );
        }
        if (block.kind === "h4") {
          return (
            <h4 key={i} className="pt-1 text-sm font-semibold">
              {block.text}
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {block.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function ReportDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, isPending, isError, error } = trpc.portfolio.report.useQuery({ id });

  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" className="bg-background" onClick={onBack}>
        <ArrowLeft className="mr-1 h-3.5 w-3.5" />
        一覧へ戻る
      </Button>

      {isPending ? (
        <Card>
          <CardContent className="space-y-2 py-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-rose-600">
            レポートを読み込めませんでした: {error.message}
          </CardContent>
        </Card>
      ) : !data ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            レポートが見つかりませんでした
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{KIND_LABEL[data.kind] ?? data.kind}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(data.createdAt)}
              </span>
              {data.actionCount > 0 ? (
                <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  判断 {data.actionCount} 件
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  動く必要なし
                </Badge>
              )}
            </div>
            <CardTitle className="pt-2 text-base leading-relaxed">{data.headline}</CardTitle>
          </CardHeader>
          <CardContent>
            <ReportBody body={data.body} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function Reports() {
  const [openId, setOpenId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const { data, isPending, isError, error } = trpc.portfolio.reports.useQuery({ limit: 50 });
  const generate = trpc.portfolio.generateWeeklyReport.useMutation({
    onSuccess: () => {
      utils.portfolio.reports.invalidate();
      utils.portfolio.unreadReportCount.invalidate();
    },
  });

  if (openId !== null) {
    return <ReportDetail id={openId} onBack={() => setOpenId(null)} />;
  }

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">レポート</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI が定期的に状況をまとめます。判断が必要なものがあるかを先に出します。
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="bg-background"
          disabled={generate.isPending}
          onClick={() => generate.mutate({ days: 7 })}
        >
          {generate.isPending ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              作成中（20 秒ほど）
            </>
          ) : (
            <>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              今すぐ作る
            </>
          )}
        </Button>
      </div>

      {generate.isError ? (
        <Card>
          <CardContent className="py-4 text-sm text-rose-600">
            作成に失敗しました: {generate.error.message}
          </CardContent>
        </Card>
      ) : null}

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-rose-600">
            一覧を読み込めませんでした: {error.message}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">レポートはまだありません</CardTitle>
            <CardDescription>
              毎週日曜の朝に自動で作られます。今すぐ内容を見たい場合は「今すぐ作る」を押してください。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <Card
              key={r.id}
              className="cursor-pointer transition-colors hover:border-primary/40"
              onClick={() => setOpenId(r.id)}
            >
              <CardContent className="py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </Badge>
                  {r.actionCount > 0 ? (
                    <Badge className="h-5 border-emerald-300 bg-emerald-50 px-1.5 text-[10px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                      判断 {r.actionCount} 件
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                      動く必要なし
                    </Badge>
                  )}
                  {r.readAt === null ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" title="未読" />
                  ) : null}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-medium leading-relaxed">{r.headline}</p>
                {r.symbols && r.symbols.length > 0 ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <FileText className="h-3 w-3 shrink-0" />
                    {r.symbols.length} 銘柄について記載
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
