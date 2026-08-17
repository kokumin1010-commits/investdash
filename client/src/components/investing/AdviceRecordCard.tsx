/**
 * 相談で出た提案の履歴と実績。
 *
 * AI に結論を断定させる方針にしたので、その結論が当たっているかを
 * 自分でも確かめられるようにする。当否は株価の推移から機械的に
 * 決まるため、AI の自己評価ではない。
 */
import { CheckCircle2, Circle, HelpCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";

const STANCE_LABEL: Record<string, string> = {
  BUY: "買い",
  HOLD: "見送り",
  REDUCE: "売却",
  REPAY: "返済",
};

const STANCE_CLASS: Record<string, string> = {
  BUY: "bg-emerald-50 text-emerald-700 border-emerald-200",
  HOLD: "bg-blue-50 text-blue-700 border-blue-200",
  REDUCE: "bg-red-50 text-red-700 border-red-200",
  REPAY: "bg-purple-50 text-purple-700 border-purple-200",
};

function VerdictIcon({ verdict }: { verdict: string | null }) {
  if (verdict === "CORRECT")
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />;
  if (verdict === "WRONG") return <XCircle className="size-4 shrink-0 text-red-600" aria-hidden />;
  return <HelpCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />;
}

function verdictText(verdict: string | null): string {
  if (verdict === "CORRECT") return "結果は正しかった";
  if (verdict === "WRONG") return "結果は外れた";
  return "判定待ち";
}

export function AdviceRecordCard({ symbol }: { symbol?: string | null }) {
  const { data, isPending, isError } = trpc.consult.outcomes.useQuery(
    { symbol: symbol ?? null },
    { staleTime: 60_000 }
  );

  if (isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">提案の実績</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">提案の実績</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          読み込みに失敗しました。時間をおいて開き直してください。
        </CardContent>
      </Card>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) return null;

  /*
   * 勝敗は判定済みだけで数える。判定待ちを混ぜると、経過日数が
   * 足りないものが「引き分け」のように見えてしまう。
   */
  const correct = rows.filter(r => r.verdict === "CORRECT").length;
  const wrong = rows.filter(r => r.verdict === "WRONG").length;
  const judged = correct + wrong;
  const executed = rows.filter(r => r.executed === true).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">AI の提案とその後</CardTitle>
        <p className="text-xs text-muted-foreground">
          当否は提案時からの株価で機械的に判定します（30 日以上経過・変動 5% 以上）。
          実行したかは保有株数の変化から自動で分かります。
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            提案 <span className="font-semibold tabular-nums">{rows.length}</span> 件
          </span>
          <span>
            実行 <span className="font-semibold tabular-nums">{executed}</span> 件
          </span>
          {judged > 0 ? (
            <span>
              判定済み{" "}
              <span className="font-semibold tabular-nums text-emerald-700">{correct}</span> 勝{" "}
              <span className="font-semibold tabular-nums text-red-700">{wrong}</span> 敗
            </span>
          ) : (
            <span className="text-muted-foreground">まだ判定できる提案がありません</span>
          )}
        </div>

        <ul className="space-y-2">
          {rows.slice(0, 12).map(row => (
            <li key={row.id} className="rounded-md border p-2.5">
              {/* スマホでは横並びにすると銘柄名が省略されるため縦積み */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={STANCE_CLASS[row.stance] ?? ""}>
                  {STANCE_LABEL[row.stance] ?? row.stance}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">{row.symbol}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(row.createdAt).toLocaleDateString("ja-JP", {
                    month: "numeric",
                    day: "numeric",
                  })}
                </span>
                <span className="inline-flex items-center gap-1 text-xs">
                  {row.executed === true ? (
                    <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden />
                  ) : row.executed === false ? (
                    <Circle className="size-3.5 text-muted-foreground" aria-hidden />
                  ) : null}
                  {row.executed === true
                    ? "実行済み"
                    : row.executed === false
                      ? "未実行"
                      : "実行の判定前"}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">{row.conclusion}</p>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <VerdictIcon verdict={row.verdict} />
                <span>{verdictText(row.verdict)}</span>
                {row.priceAtAdvice !== null ? (
                  <span>
                    ・提案時 {row.priceAtAdvice.toLocaleString()}
                    {row.priceAtVerdict !== null
                      ? ` → ${row.priceAtVerdict.toLocaleString()}`
                      : ""}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
