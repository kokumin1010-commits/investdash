/**
 * 信用取引（レバレッジ）口座の借入額・維持証拠金を更新する設定カード。
 *
 * IBKR のように借入をして株を買っている口座では、借入額を記録しないと
 * 総資産が借入分だけ過大になる。借入額は日々変動する（利息が付く、
 * 売買で増減する）ため、残高画面のスクリーンショットを見ながら
 * 数字を入れ直せるようにしている。
 *
 * 通貨は口座の基軸通貨で入力する（IBKR なら SGD）。円換算は
 * サーバー側で SGD/JPY レートを使って行うため、ここでは換算しない。
 */
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BrokerBadge } from "@/components/investing/BrokerBadge";
import { trpc } from "@/lib/trpc";
import {
  BROKERS,
  BROKER_BASE_CURRENCY,
  brokerLabel,
  formatMoney,
  type Broker,
} from "@shared/investing";
import { Landmark, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/** 信用取引を使う可能性がある口座のみ対象にする（NISA 等の現物専用口座は除く） */
const MARGIN_CAPABLE: readonly Broker[] = BROKERS;

export default function MarginSettings() {
  const utils = trpc.useUtils();
  const balances = trpc.portfolio.brokerBalances.useQuery();
  const overview = trpc.portfolio.overview.useQuery();

  /** 編集対象の口座。既に記録がある口座があればそれを初期選択する */
  const [broker, setBroker] = useState<Broker>("ibkr");
  const [cashBalance, setCashBalance] = useState("");
  const [maintenanceMargin, setMaintenanceMargin] = useState("");
  const [interestMtd, setInterestMtd] = useState("");
  const [dirty, setDirty] = useState(false);

  const current = useMemo(
    () => (balances.data ?? []).find(b => b.broker === broker) ?? null,
    [balances.data, broker]
  );

  // 口座を切り替えたら、その口座の記録値をフォームに読み込む
  useEffect(() => {
    setCashBalance(current ? String(Number(current.cashBalance)) : "");
    setMaintenanceMargin(current ? String(Number(current.maintenanceMargin)) : "");
    setInterestMtd(current ? String(Number(current.interestMtd)) : "");
    setDirty(false);
  }, [current]);

  const save = trpc.portfolio.saveBrokerBalance.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      toast.success(`${brokerLabel(broker)} の借入・証拠金を更新しました`);
      setDirty(false);
    },
    onError: e => toast.error(e.message),
  });

  const remove = trpc.portfolio.deleteBrokerBalance.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      toast.success(`${brokerLabel(broker)} の借入記録を削除しました`);
    },
    onError: e => toast.error(e.message),
  });

  const currency = BROKER_BASE_CURRENCY[broker] ?? "JPY";
  const cashNum = Number(cashBalance);
  const marginNum = Number(maintenanceMargin);

  /** この口座で保有している株式の時価（口座通貨換算前の円ベース） */
  const brokerSlice = (overview.data?.brokers ?? []).find(b => b.key === broker) ?? null;
  const leverage = brokerSlice?.leverage ?? null;

  /*
   * 入力中の借入額から、保存した場合のレバレッジを先に見せる。
   * 保存してから画面を戻って確認する手間を省き、桁の入力ミスにも気付ける。
   */
  const preview = useMemo(() => {
    if (!brokerSlice || !Number.isFinite(cashNum)) return null;
    const rate = overview.data?.summary?.sgdJpyRate;
    const usdJpy = overview.data?.summary?.usdJpyRate;
    // 口座通貨を円に直すレート
    const toJpy =
      currency === "JPY" ? 1 : currency === "SGD" ? Number(rate ?? 0) : Number(usdJpy ?? 0);
    if (!toJpy) return null;
    const cashJpy = cashNum * toJpy;
    const net = brokerSlice.value + cashJpy;
    return {
      borrowedJpy: cashNum < 0 ? -cashJpy : 0,
      netJpy: net,
      leverage: net > 0 ? brokerSlice.value / net : null,
    };
  }, [brokerSlice, cashNum, currency, overview.data?.summary]);

  const mark = () => setDirty(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Landmark className="h-4 w-4" />
          信用取引（借入）の記録
        </CardTitle>
        <CardDescription className="text-xs">
          借入をして株を買っている口座は、借入額を記録しないと総資産が借入分だけ過大になります。
          証券アプリの残高画面を見ながら、口座の基軸通貨のまま入力してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>対象の証券口座</Label>
          <div className="flex flex-wrap gap-2">
            {MARGIN_CAPABLE.map(b => {
              const recorded = (balances.data ?? []).some(x => x.broker === b);
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBroker(b)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all active:scale-[0.97] ${
                    broker === b ? "border-primary bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <BrokerBadge broker={b} short />
                  {recorded ? (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      記録あり
                    </Badge>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="margin-cash">現金残高（{currency}）</Label>
            <Input
              id="margin-cash"
              type="number"
              inputMode="decimal"
              placeholder="例: -1826237.33"
              value={cashBalance}
              onChange={e => {
                setCashBalance(e.target.value);
                mark();
              }}
              className="tabular"
            />
            <p className="text-xs text-muted-foreground">
              マイナスで入力すると借入として扱います（例: −1,826,237.33 は約 182 万 SGD の借入）
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="margin-maint">維持証拠金（{currency}）</Label>
            <Input
              id="margin-maint"
              type="number"
              inputMode="decimal"
              placeholder="例: 844670.35"
              value={maintenanceMargin}
              onChange={e => {
                setMaintenanceMargin(e.target.value);
                mark();
              }}
              className="tabular"
            />
            <p className="text-xs text-muted-foreground">
              純資産がこの金額を下回ると追証です。追証までの下落余地の計算に使います
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="margin-interest">月初来の支払利息（{currency}）</Label>
            <Input
              id="margin-interest"
              type="number"
              inputMode="decimal"
              placeholder="例: -1217.22"
              value={interestMtd}
              onChange={e => {
                setInterestMtd(e.target.value);
                mark();
              }}
              className="tabular"
            />
            <p className="text-xs text-muted-foreground">
              借入の金利負担。マイナスで入力します（任意）
            </p>
          </div>
        </div>

        {/* 保存前に結果を見せて、桁の入力ミスに気付けるようにする */}
        {preview && cashNum < 0 ? (
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs">
            <p className="font-medium">この内容で保存した場合</p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">株式時価</span>
              <span className="tabular">{formatMoney(brokerSlice?.value, "JPY")}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">借入（円換算）</span>
              <span className="tabular text-loss">
                −{formatMoney(preview.borrowedJpy, "JPY")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-1">
              <span className="font-medium">純資産</span>
              <span className="tabular font-semibold">{formatMoney(preview.netJpy, "JPY")}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">レバレッジ</span>
              <span className="tabular">
                {preview.leverage !== null ? `${preview.leverage.toFixed(2)} 倍` : "算出不可"}
              </span>
            </div>
          </div>
        ) : null}

        {current && leverage ? (
          <p className="text-xs text-muted-foreground">
            現在の記録: 借入 {formatMoney(leverage.borrowedBase, "JPY")} / 純資産{" "}
            {formatMoney(leverage.netValueBase, "JPY")} /{" "}
            {leverage.leverage !== null ? `${leverage.leverage.toFixed(2)} 倍` : "レバレッジ算出不可"}
            {current.capturedAt
              ? `（${new Date(current.capturedAt).toLocaleString("ja-JP")} 時点）`
              : ""}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            この口座にはまだ借入の記録がありません。現物のみで運用している場合は入力不要です。
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {current ? (
            <Button
              variant="outline"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ broker })}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              記録を削除
            </Button>
          ) : null}
          <Button
            disabled={save.isPending || !dirty || !Number.isFinite(cashNum) || cashBalance === ""}
            onClick={() =>
              save.mutate({
                broker,
                currency,
                cashBalance: cashNum,
                maintenanceMargin: Number.isFinite(marginNum) && marginNum > 0 ? marginNum : 0,
                interestMtd: Number.isFinite(Number(interestMtd)) ? Number(interestMtd) : 0,
                // 借入通貨の内訳は OCR 経由の登録で記録するため、手入力では省く
              })
            }
          >
            <Save className="mr-1.5 h-4 w-4" />
            {save.isPending ? "保存中..." : "借入・証拠金を保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
