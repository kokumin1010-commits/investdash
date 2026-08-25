import React from "react";

/**
 * 「今この株を持っていなかったら、この値段で買うか」の判定表示。
 *
 * なぜシグナルと別に出すか:
 * ADD/HOLD は「今の保有をどうするか」の判断で、
 * 「今から新規に買うか」とは別の問いである。
 * たとえば大きく育った株は「今からは買わないが売る理由もない」ことがあり、
 * これを ADD/HOLD に押し込むとその区別が消える。
 */

type WouldBuy = "YES" | "NO" | "UNCLEAR";
type PriceVsValue = "PRICE_AHEAD" | "VALUE_AHEAD" | "IN_LINE" | "UNKNOWN";

const BUY_LABEL: Record<WouldBuy, string> = {
  YES: "仮に未保有なら買う",
  NO: "新規購入は見送る",
  UNCLEAR: "新規購入は判断保留",
};

/**
 * 色の割り当て。
 * 「今からは買わない」を赤にはしない。売るべきという意味ではないため。
 * 赤にすると保有一覧で警告と読み違えられる。
 */
const BUY_STYLE: Record<WouldBuy, string> = {
  YES: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  NO: "bg-slate-100 text-slate-600 ring-slate-300",
  UNCLEAR: "bg-amber-50 text-amber-700 ring-amber-200",
};

const VALUE_LABEL: Record<PriceVsValue, string> = {
  PRICE_AHEAD: "株価が中身より速い",
  VALUE_AHEAD: "中身が株価より速い",
  IN_LINE: "株価と中身が釣り合う",
  UNKNOWN: "比べる材料が足りない",
};

const VALUE_STYLE: Record<PriceVsValue, string> = {
  // 株価の先行は「上がったから売る」ではなく「注意して見る」段階
  PRICE_AHEAD: "bg-orange-50 text-orange-700 ring-orange-200",
  VALUE_AHEAD: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  IN_LINE: "bg-slate-100 text-slate-600 ring-slate-300",
  UNKNOWN: "bg-slate-100 text-slate-500 ring-slate-300",
};

export function WouldBuyNowBadge({
  value,
  className = "",
}: {
  value: WouldBuy | null;
  className?: string;
}) {
  // 過去に生成したシグナルには入っていないので null になる。
  // その場合は何も出さない（「未判定」と出すと未実装に見える）
  if (!value) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${BUY_STYLE[value]} ${className}`}
    >
      {BUY_LABEL[value]}
    </span>
  );
}

export function PriceVsValueBadge({
  value,
  className = "",
}: {
  value: PriceVsValue | null;
  className?: string;
}) {
  if (!value) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${VALUE_STYLE[value]} ${className}`}
    >
      {VALUE_LABEL[value]}
    </span>
  );
}

/**
/**
 * 表形式向けの短い印。
 *
 * 表のシグナル列は狭く、「今からは買わない」をそのまま置くと列が広がり
 * 横スクロールが発生する（横スクロールは使わない方針）。
 * ここでは 2〜3 文字に留め、理由はツールチップとカード表示側で読ませる。
 */
export function WouldBuyNowMark({ value }: { value: WouldBuy | null }) {
  if (!value) return null;
  // 「買う」だけは前向きな情報なので色を付ける。
  // 「買わない」は警告ではないので彩度を落とす。
  const style =
    value === "YES"
      ? "text-emerald-700 dark:text-emerald-400"
      : value === "NO"
        ? "text-muted-foreground"
        : "text-amber-600 dark:text-amber-400";
  const label =
    value === "YES"
      ? "仮に未保有なら買う"
      : value === "NO"
        ? "未保有でも見送る"
        : "未保有時も判断保留";
  return <p className={`mt-0.5 text-[10px] leading-tight ${style}`}>{label}</p>;
}

/**
 * 判定とその理由をまとめて出す。銘柄詳細やカードの本文向け。
 */
export function BuffettLensBlock({
  wouldBuyNow,
  wouldBuyNowReason,
  priceVsValue,
  priceVsValueReason,
}: {
  wouldBuyNow: WouldBuy | null;
  wouldBuyNowReason: string | null;
  priceVsValue: PriceVsValue | null;
  priceVsValueReason: string | null;
}) {
  if (!wouldBuyNow && !priceVsValue) return null;
  return (
    <div className="space-y-2 rounded-lg bg-muted/40 p-3">
      {wouldBuyNow ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">新規購入の判断</span>
            <WouldBuyNowBadge value={wouldBuyNow} />
          </div>
          {wouldBuyNowReason ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {wouldBuyNowReason}
            </p>
          ) : null}
        </div>
      ) : null}
      {priceVsValue ? (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">株価と中身の伸び</span>
            <PriceVsValueBadge value={priceVsValue} />
          </div>
          {priceVsValueReason ? (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {priceVsValueReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
