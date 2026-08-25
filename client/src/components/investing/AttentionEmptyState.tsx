import { Link } from "wouter";

export function AttentionEmptyState({ unjudgedSignalCount }: { unjudgedSignalCount: number }) {
  if (unjudgedSignalCount > 0) {
    return (
      <div className="space-y-2 py-7 text-center">
        <p className="text-sm font-medium">まだ全銘柄の判断が完了していません</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {unjudgedSignalCount} 銘柄の判断を小分けで生成中です。ここが空でも、
          リスクがないことを意味しません。
        </p>
        <Link
          href="/holdings"
          className="inline-flex text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          保有一覧で全銘柄を見る
        </Link>
      </div>
    );
  }

  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      全銘柄の判定済みシグナルに、現在 EXIT / REDUCE / WATCH はありません
    </p>
  );
}
