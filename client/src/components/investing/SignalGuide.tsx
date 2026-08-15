import { Brain, ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SIGNAL_ACTIONS, SIGNAL_LABELS, type SignalAction } from "@shared/investing";
import { SignalBadge } from "./SignalBadge";

/** 各シグナルが何を意味するか。判断材料まで書かないと「押しても意味ない」と受け取られる */
const SIGNAL_DESCRIPTIONS: Record<SignalAction, string> = {
  ADD: "好材料が優勢で、投資カードに書いた前提も維持されている状態。買い増しを検討する余地があると判断されたもの。",
  HOLD: "前提が崩れておらず、特段の対応が不要と判断された状態。そのまま保有を続ける。",
  WATCH: "判断を下すには材料が足りない、または状況が変化しつつある状態。決算やニュースを注視する。",
  REDUCE: "悪材料や前提の崩れが見られる、あるいは1銘柄への集中が大きい状態。一部売却を検討する余地がある。",
  EXIT: "投資カードに書いた撤退条件に触れている、または前提が明確に崩れた状態。売却を検討する余地がある。",
};

/**
 * シグナルの読み方を説明するパネル。
 *
 * 用語だけ並べても意味が伝わらないため、
 * 「何を見て判断しているか」「未生成とは何か」も併記する。
 */
export function SignalGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-muted/30">
      <Button
        variant="ghost"
        className="flex h-auto w-full items-center justify-between px-3 py-2.5 text-left hover:bg-muted/50"
        onClick={() => setOpen(v => !v)}
      >
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Info className="h-4 w-4 shrink-0" />
          AI シグナルの読み方
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
        />
      </Button>

      {open ? (
        <div className="space-y-3 border-t px-3 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            各銘柄について、①関連ニュースの内容 ②株価の動き（取得単価からの乖離・52週レンジ内の位置）
            ③あなたが投資カードに記録した買付理由・前提・撤退条件 の3点を AI が読み、
            5段階の目安とその根拠を出します。
          </p>

          <div className="space-y-2">
            {SIGNAL_ACTIONS.map(action => (
              <div key={action} className="flex gap-2.5">
                <div className="w-[104px] shrink-0 pt-0.5">
                  <SignalBadge action={action} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{SIGNAL_LABELS[action]}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {SIGNAL_DESCRIPTIONS[action]}
                  </p>
                </div>
              </div>
            ))}

            <div className="flex gap-2.5 border-t pt-2">
              <div className="w-[104px] shrink-0 pt-0.5">
                <span className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
                  未生成
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">まだ分析していない</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  この銘柄はまだ一度も AI 分析を実行していません。各銘柄の
                  <span className="mx-1 inline-flex items-center gap-0.5 align-middle">
                    <Brain className="inline h-3 w-3" />
                    AI分析
                  </span>
                  を押すか、ダッシュボードの「全銘柄をAI分析」でまとめて生成できます。
                </p>
              </div>
            </div>
          </div>

          <p className="border-t pt-2.5 text-[11px] leading-relaxed text-muted-foreground">
            これらは公開情報を自動整理した情報提供であり、投資助言ではありません。
            売買の最終判断はご自身の責任で行ってください。
          </p>
        </div>
      ) : null}
    </div>
  );
}
