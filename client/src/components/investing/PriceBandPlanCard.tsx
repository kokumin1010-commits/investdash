import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Layers,
  RefreshCw,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Pencil,
  X,
} from "lucide-react";
import {
  BAND_ACTION_LABELS,
  BAND_ACTION_STYLES,
  bandRangeText,
  type BandAction,
} from "@shared/priceBands";
import { cn } from "@/lib/utils";

/**
 * 買い増しプラン（価格帯ごとの行動）の表示。
 *
 * 数字の表を並べるのではなく、縦に積んだ帯として描き、現在値の位置を線で示す。
 * 細かい数字を読まなくても「今どのへんにいるか」が分かるようにするため。
 *
 * 帯の外にいる場合は、一番近い帯の行動を出してはならない。
 * 例えば現在値 $222 に対してプランの最上段が 160〜170 の場合、
 * 「持有」と出すと誤った判断につながる。「対象外」と明示する。
 */

/**
 * 帯の基本情報。評価結果（evaluation）に入る帯は確認結果を持たないので、
 * checks は任意にして両方を同じ型で扱えるようにする。
 */
type Band = {
  id: number;
  lowerPrice: number | null;
  upperPrice: number | null;
  action: BandAction;
  actionLabel: string;
  reason: string | null;
  checkItems: string[] | null;
  plannedAmount: number | null;
  sortOrder: number;
  checks?: Array<{
    checkItem: string;
    status: "CLEAR" | "CONCERN" | "UNKNOWN";
    finding: string;
    sourceCount: number;
    checkedAt: string | Date;
  }>;
};

type Plan = {
  id: number;
  symbol: string;
  currency: string;
  strategy: string | null;
  rationale: string | null;
  model: string | null;
  editedByUser: boolean;
  generatedAt: string | Date;
  bands: Band[];
  currentPrice: number | null;
  evaluation: {
    currentBand: Band | null;
    abovePlan: boolean;
    belowPlan: boolean;
    nextBand: Band | null;
    gapToNextPct: number | null;
    nextBandPrice: number | null;
  };
};

function fmtPrice(v: number, currency: string): string {
  return `${v.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} ${currency}`;
}

/** 確認結果の状態に応じたアイコンと色 */
function CheckStatusIcon({ status }: { status: "CLEAR" | "CONCERN" | "UNKNOWN" }) {
  if (status === "CLEAR") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  if (status === "CONCERN") return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />;
  return <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

/**
 * 段の数字と行動を手で直すフォーム。
 *
 * 空欄は「上限なし／下限なし」を意味する（最上段と最下段で使う）。
 * 0 と空欄を区別しないと「0 円以下」という無意味な段ができてしまうため、
 * 空文字は null として扱う。
 */
function BandEditForm({
  band,
  currency,
  isSaving,
  onCancel,
  onSave,
}: {
  band: Band;
  currency: string;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (params: {
    bandId: number;
    lowerPrice: number | null;
    upperPrice: number | null;
    action: BandAction;
    actionLabel: string;
    reason: string | null;
  }) => void;
}) {
  const [lower, setLower] = useState(band.lowerPrice === null ? "" : String(band.lowerPrice));
  const [upper, setUpper] = useState(band.upperPrice === null ? "" : String(band.upperPrice));
  const [label, setLabel] = useState(band.actionLabel);
  const [reason, setReason] = useState(band.reason ?? "");

  const parse = (v: string): number | null => {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const lowerNum = parse(lower);
  const upperNum = parse(upper);
  // 下限が上限を上回る指定は判定不能な段を作るため保存させない
  const invalid = lowerNum !== null && upperNum !== null && lowerNum > upperNum;

  return (
    <div className="mt-2 space-y-2 rounded border border-current/30 bg-background/60 p-2">
      <div className="flex items-center gap-1.5">
        <Input
          value={lower}
          onChange={e => setLower(e.target.value)}
          placeholder="下限なし"
          inputMode="decimal"
          className="h-7 flex-1 text-xs"
        />
        <span className="text-xs opacity-60">〜</span>
        <Input
          value={upper}
          onChange={e => setUpper(e.target.value)}
          placeholder="上限なし"
          inputMode="decimal"
          className="h-7 flex-1 text-xs"
        />
        <span className="text-[10px] opacity-60">{currency}</span>
      </div>
      <Input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="この価格帯での行動"
        className="h-7 text-xs"
      />
      <Input
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="そう決めた理由（任意）"
        className="h-7 text-xs"
      />
      {invalid ? (
        <p className="text-[10px] text-rose-600">下限が上限を上回っています</p>
      ) : (
        <p className="text-[10px] opacity-60">
          空欄にすると「上限なし」「下限なし」になります。作り直すと手直しは消えます。
        </p>
      )}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="h-7 flex-1 text-[11px]"
          disabled={isSaving || invalid || label.trim() === ""}
          onClick={() =>
            onSave({
              bandId: band.id,
              lowerPrice: lowerNum,
              upperPrice: upperNum,
              action: band.action,
              actionLabel: label.trim(),
              reason: reason.trim() === "" ? null : reason.trim(),
            })
          }
        >
          {isSaving ? "保存中…" : "保存"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 bg-transparent text-[11px]"
          onClick={onCancel}
        >
          やめる
        </Button>
      </div>
    </div>
  );
}

export function PriceBandPlanCard({
  plan,
  isGenerating,
  onGenerate,
  onRunChecks,
  isCheckingBandId,
  isLoading = false,
  errorMessage = null,
  onSaveBand,
  savingBandId = null,
}: {
  plan: Plan | null | undefined;
  isGenerating: boolean;
  onGenerate: () => void;
  onRunChecks?: (bandId: number) => void;
  isCheckingBandId?: number | null;
  /** 取得中。未作成と混同すると「作られていない」と誤表示するため区別する */
  isLoading?: boolean;
  /** 取得に失敗した場合のメッセージ。黙って未作成扱いにしてはいけない */
  errorMessage?: string | null;
  /** 段を手で直したときの保存。渡されなければ編集ボタンを出さない */
  onSaveBand?: (params: {
    bandId: number;
    lowerPrice: number | null;
    upperPrice: number | null;
    action: BandAction;
    actionLabel: string;
    reason: string | null;
  }) => void;
  savingBandId?: number | null;
}) {
  /** 編集中の段。1 つずつしか開かない（同時に開くと保存漏れが分かりにくい） */
  const [editingBandId, setEditingBandId] = useState<number | null>(null);

  /** 現在値がどの帯にいるかを見出しに出すための文言 */
  const headline = useMemo(() => {
    if (!plan || plan.currentPrice === null) {
      return { text: "株価が未取得のため判定できません", tone: "muted" as const };
    }
    const { currentBand, abovePlan, belowPlan } = plan.evaluation;
    if (currentBand) {
      return { text: currentBand.actionLabel, tone: "band" as const };
    }
    if (abovePlan) {
      // 買い増しプランより上にいる = 今は買う水準ではない
      return {
        text: "登録した価格帯より上にいます。今は買い増しの対象外です",
        tone: "above" as const,
      };
    }
    if (belowPlan) {
      return {
        text: "登録した価格帯より下にいます。想定以上に下落しているため計画の見直しが必要です",
        tone: "below" as const,
      };
    }
    // 帯の隙間。飛び飛びの価格帯を指定しているため実際に起こる
    return {
      text: "価格帯の間にいます。どの段の条件にも当てはまりません",
      tone: "gap" as const,
    };
  }, [plan]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">買い増しプランを読み込み中…</p>
        </CardContent>
      </Card>
    );
  }

  if (errorMessage) {
    return (
      <Card className="border-rose-200 dark:border-rose-900">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-rose-600 dark:text-rose-400">
            買い増しプランを読み込めませんでした
          </p>
          <p className="text-xs text-muted-foreground">{errorMessage}</p>
        </CardContent>
      </Card>
    );
  }

  if (!plan) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            買い増しプランはまだ作られていません。
            <br />
            「この値段になったらこうする」という段組みを AI が提案します。
          </p>
          <Button size="sm" disabled={isGenerating} onClick={onGenerate}>
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            {isGenerating ? "生成中…" : "買い増しプランを作る"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { currentBand, nextBand, gapToNextPct, nextBandPrice } = plan.evaluation;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            買い増しプラン（価格帯）
          </CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {plan.editedByUser ? <Badge variant="outline">手動で調整済み</Badge> : null}
            <span>{new Date(plan.generatedAt).toLocaleString("ja-JP")}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2"
              disabled={isGenerating}
              onClick={onGenerate}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isGenerating && "animate-spin")} />
              <span className="ml-1 hidden sm:inline">作り直す</span>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 今どうすべきかを一番大きく出す */}
        <div
          className={cn(
            "rounded-lg border p-3",
            headline.tone === "band" && currentBand
              ? BAND_ACTION_STYLES[currentBand.action]
              : "border-dashed bg-muted/40"
          )}
        >
          <p className="text-xs font-medium opacity-80">
            {plan.currentPrice !== null
              ? `現在値 ${fmtPrice(plan.currentPrice, plan.currency)} での判断`
              : "現在の判断"}
          </p>
          <p className="mt-1 text-sm font-semibold leading-relaxed">{headline.text}</p>
          {currentBand?.reason ? (
            <p className="mt-1.5 text-xs leading-relaxed opacity-90">{currentBand.reason}</p>
          ) : null}
          {/* 次の段までの距離。機会を待つ目安になる */}
          {nextBand && gapToNextPct !== null && nextBandPrice !== null ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs opacity-90">
              <TrendingDown className="h-3.5 w-3.5 shrink-0" />
              あと {Math.abs(gapToNextPct).toFixed(1)}% 下がって{" "}
              {fmtPrice(nextBandPrice, plan.currency)} になると「{nextBand.actionLabel}」の段に入ります
            </p>
          ) : null}
        </div>

        {/* 価格帯を縦に積む。上が高値 */}
        <div className="space-y-1.5">
          {plan.bands.map(band => {
            const isCurrent = currentBand?.id === band.id;
            const isNext = nextBand?.id === band.id && !isCurrent;
            return (
              <div
                key={band.id}
                className={cn(
                  "rounded-md border px-3 py-2.5 transition-colors",
                  BAND_ACTION_STYLES[band.action],
                  isCurrent && "ring-2 ring-offset-1 ring-current",
                  !isCurrent && "opacity-75"
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {bandRangeText(band)}
                    </span>
                    <span className="text-[11px] opacity-70">{plan.currency}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isCurrent ? (
                      <Badge className="h-5 bg-current/15 px-1.5 text-[10px] font-semibold">
                        現在ここ
                      </Badge>
                    ) : null}
                    {isNext ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                        次の段
                      </Badge>
                    ) : null}
                    <span className="text-[11px] font-medium opacity-80">
                      {BAND_ACTION_LABELS[band.action]}
                    </span>
                    {onSaveBand ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        title={editingBandId === band.id ? "編集をやめる" : "この段の数字を直す"}
                        onClick={() =>
                          setEditingBandId(editingBandId === band.id ? null : band.id)
                        }
                      >
                        {editingBandId === band.id ? (
                          <X className="h-3 w-3" />
                        ) : (
                          <Pencil className="h-3 w-3" />
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {/* 手で直すフォーム。AI の提案が自分の考えと違う場合に使う */}
                {editingBandId === band.id && onSaveBand ? (
                  <BandEditForm
                    band={band}
                    currency={plan.currency}
                    isSaving={savingBandId === band.id}
                    onCancel={() => setEditingBandId(null)}
                    onSave={params => {
                      onSaveBand(params);
                      setEditingBandId(null);
                    }}
                  />
                ) : (
                  <>
                <p className="mt-1 text-xs font-medium leading-snug">{band.actionLabel}</p>
                {band.reason ? (
                  <p className="mt-0.5 text-[11px] leading-relaxed opacity-80">{band.reason}</p>
                ) : null}
                  </>
                )}

                {/* 確認項目。帯に入るまでは照合しないので項目だけ出す */}
                {band.checkItems && band.checkItems.length > 0 ? (
                  <div className="mt-2 space-y-1.5 rounded border border-current/20 bg-current/5 p-2">
                    <p className="text-[11px] font-semibold opacity-90">
                      この水準になったら確認すること
                    </p>
                    <ul className="space-y-0.5">
                      {band.checkItems.map(item => {
                        const result = band.checks?.find(c => c.checkItem === item);
                        return (
                          <li key={item} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                            {result ? (
                              <CheckStatusIcon status={result.status} />
                            ) : (
                              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
                            )}
                            <span className="flex-1">
                              {item}
                              {result ? (
                                <span className="mt-0.5 block opacity-80">{result.finding}</span>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {/* 帯に入っているときだけ照合できる。無駄な AI 呼び出しを避ける */}
                    {isCurrent && onRunChecks ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 h-7 w-full bg-transparent text-[11px]"
                        disabled={isCheckingBandId === band.id}
                        onClick={() => onRunChecks(band.id)}
                      >
                        {isCheckingBandId === band.id
                          ? "ニュースを確認中…"
                          : (band.checks?.length ?? 0) > 0
                            ? "確認をやり直す"
                            : "ニュースで確認する"}
                      </Button>
                    ) : null}
                    {!isCurrent ? (
                      <p className="text-[10px] opacity-60">
                        この価格帯に入ると自動で確認できるようになります
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* 段組みの根拠。数字だけでは信用できないため必ず出す */}
        {plan.strategy || plan.rationale ? (
          <>
            <Separator />
            <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              {plan.strategy ? (
                <div>
                  <p className="font-medium text-foreground">全体の考え方</p>
                  <p className="mt-0.5">{plan.strategy}</p>
                </div>
              ) : null}
              {plan.rationale ? (
                <div>
                  <p className="font-medium text-foreground">価格水準の決め方</p>
                  <p className="mt-0.5">{plan.rationale}</p>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          価格は現地通貨（{plan.currency}）で表示しています。実際に注文できる水準で判断できるよう、
          表示通貨には換算していません。最終的な判断はご自身で行ってください。
        </p>
      </CardContent>
    </Card>
  );
}
