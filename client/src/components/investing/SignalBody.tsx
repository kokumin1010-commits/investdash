/**
 * AI が出した判定の本文を、いつの判定かが分かる形で画面に常設する。
 *
 * 【なぜ必要か】
 * これまで判定の本文は 2 か所にしか出ていなかった。
 * 1 つは分析を押した直後のトースト（120 字で切られ、数秒で消える）、
 * もう 1 つは表形式のツールチップ（スマホでは長押しが必要で実質読めない）。
 * どちらも「後から読み返す」ことができない。
 *
 * 判定は根拠を読んで初めて意味を持つ。ADD というバッジだけでは
 * 「なぜ今買うのか」が分からず、判断の材料にならない。
 *
 * 【既定で畳む理由】
 * 本文は 150〜300 字あり、112 銘柄すべてで全文を出すと一覧が縦に伸びて
 * 使えなくなる。既定は 2 行に抑え、読みたい銘柄だけ開く。
 * ただし日付と判定は常に見えるようにする。「いつの判断か」が分からないと
 * 古い判定を今の判断に使ってしまう。
 */
import { Brain, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { BuffettLensBlock } from "@/components/investing/WouldBuyNowBadge";

/** 折りたたみボタンを出す文字数の下限（おおよそ 2 行分） */
const COLLAPSE_MIN_LENGTH = 80;

export type SignalBodyData = {
  action: string;
  confidence: number | null;
  rationale: string;
  createdAt: Date | string;
  wouldBuyNow: "YES" | "NO" | "UNCLEAR" | null;
  wouldBuyNowReason: string | null;
  priceVsValue: "PRICE_AHEAD" | "VALUE_AHEAD" | "IN_LINE" | "UNKNOWN" | null;
  priceVsValueReason: string | null;
};

/** 「8/19 19:49」の形。年は同年なら省く（今年の判定がほとんどのため） */
export function formatSignalAt(at: Date | string): string {
  const d = new Date(at);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameYear ? `${md} ${hm}` : `${d.getFullYear()}/${md} ${hm}`;
}

/**
 * 判定からの経過を「今日」「3日前」のように出す。
 *
 * 日時だけでは古さが直感的に分からない。月 1 回しか開かない使い方では
 * 「8/19 の判定」と書かれていても、それが 1 日前か 3 週間前かを
 * その場で計算する必要がある。
 */
export function elapsedLabel(at: Date | string): string {
  const d = new Date(at);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 7) return `${days}日前`;
  if (days < 30) return `${Math.floor(days / 7)}週間前`;
  return `${Math.floor(days / 30)}か月前`;
}

export function SignalBody({
  signal,
  defaultOpen = false,
}: {
  signal: SignalBodyData;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const collapsible = signal.rationale.length > COLLAPSE_MIN_LENGTH;

  return (
    <div className="mt-2 rounded-md bg-muted/40 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Brain className="h-3 w-3" />
          AI の判断
        </span>
        <span className="text-[10px] text-muted-foreground">
          {formatSignalAt(signal.createdAt)}（{elapsedLabel(signal.createdAt)}）
          {signal.confidence !== null ? ` ・確信度 ${signal.confidence}` : ""}
        </span>
      </div>
      <p
        className={`mt-1 text-[11px] leading-relaxed ${open || !collapsible ? "" : "line-clamp-2"}`}
      >
        {signal.rationale}
      </p>
      {open ? (
        <BuffettLensBlock
          wouldBuyNow={signal.wouldBuyNow}
          wouldBuyNowReason={signal.wouldBuyNowReason}
          priceVsValue={signal.priceVsValue}
          priceVsValueReason={signal.priceVsValueReason}
        />
      ) : null}
      {collapsible || signal.wouldBuyNowReason || signal.priceVsValueReason ? (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? (
            <>
              閉じる
              <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              全文を読む
              <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
