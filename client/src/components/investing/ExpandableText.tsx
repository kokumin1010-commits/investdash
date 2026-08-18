/**
 * 長い文章を既定では 2 行に抑え、押すと全文を開く表示。
 *
 * 注目理由や買付条件は AI が 150〜250 字程度で書くため、2 行で切ると
 * 「【懸念】シンガポ…」のように肝心の懸念点が読めない。かといって
 * 常に全文を出すと 1 銘柄のカードが縦に伸び、12 銘柄を並べたときに
 * 一覧としての用を成さない。既定は畳んでおき、読みたいものだけ開く。
 *
 * 短い文章では開閉ボタンを出さない。押しても何も変わらないボタンは
 * 「押しても反応しない」と受け取られる。
 */
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

/**
 * 折りたたみボタンを出す文字数の下限。
 *
 * 2 行に収まる分量であれば開いても見た目が変わらないため、
 * おおよそ 2 行分（全角 40 字前後 × 2）を超えるものだけ対象にする。
 */
const COLLAPSE_MIN_LENGTH = 80;

export function ExpandableText({
  label,
  text,
  className,
}: {
  label: string;
  text: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const collapsible = text.length > COLLAPSE_MIN_LENGTH;

  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <p className="text-muted-foreground text-[11px] font-medium">{label}</p>
      <p className={`text-xs leading-relaxed ${open || !collapsible ? "" : "line-clamp-2"}`}>
        {text}
      </p>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[11px] transition-colors"
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
