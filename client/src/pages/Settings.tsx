import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import PasscodeSettings from "@/components/PasscodeSettings";
import MarginSettings from "@/components/MarginSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { Moon, RefreshCw, Save, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function SettingsPage() {
  const utils = trpc.useUtils();
  const settings = trpc.portfolio.settings.useQuery();
  const { theme, toggleTheme } = useTheme();

  const [usdJpy, setUsdJpy] = useState("");
  const [sgdJpy, setSgdJpy] = useState("");
  const [posThreshold, setPosThreshold] = useState("");
  const [secThreshold, setSecThreshold] = useState("");
  const [cash, setCash] = useState("");
  const [autoNews, setAutoNews] = useState(true);
  const [fxAuto, setFxAuto] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setUsdJpy(settings.data.usdJpyRate ?? "150");
    setSgdJpy(settings.data.sgdJpyRate ?? "115");
    setPosThreshold(String(settings.data.concentrationThreshold));
    setSecThreshold(String(settings.data.sectorConcentrationThreshold));
    setCash(settings.data.cashBalance ?? "0");
    setAutoNews(settings.data.autoNewsEnabled);
    setFxAuto(settings.data.fxAutoUpdate);
    setDirty(false);
  }, [settings.data]);

  const update = trpc.portfolio.updateSettings.useMutation({
    onSuccess: async () => {
      await utils.portfolio.invalidate();
      toast.success("設定を保存しました");
      setDirty(false);
    },
    onError: e => toast.error(e.message),
  });

  const enrich = trpc.portfolio.enrichProfiles.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      toast.success(
        res.count > 0 ? `${res.count} 銘柄の業種情報を更新しました` : "更新対象はありませんでした"
      );
    },
    onError: e => toast.error(e.message),
  });

  const syncFx = trpc.portfolio.syncFxRate.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      const parts: string[] = [];
      if (res.usdJpy !== null) parts.push(`${res.usdJpy.toFixed(2)} 円/ドル`);
      if (res.sgdJpy !== null) parts.push(`${res.sgdJpy.toFixed(2)} 円/SGD`);
      toast.success(`為替レートを更新しました（${parts.join(" ・ ")}）`);
    },
    onError: e => toast.error(e.message),
  });

  if (settings.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const mark = () => setDirty(true);

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">設定</h1>
        <p className="text-sm text-muted-foreground">
          パスコード、為替レート、アラートのしきい値、表示テーマを設定します。
        </p>
      </header>

      <PasscodeSettings />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">資産計算</CardTitle>
          <CardDescription className="text-xs">
            外貨建て銘柄の評価額は、ここの為替レートで円換算されます（米国株は USD/JPY、シンガポール株と
            IBKR の SGD 建て残高は SGD/JPY）。自動取得を有効にすると、株価更新のたびに最新レートへ更新されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="fx-auto" className="text-sm">
                為替レートを自動取得する
              </Label>
              <p className="text-xs text-muted-foreground">
                {settings.data?.fxRateUpdatedAt
                  ? `最終取得: ${new Date(settings.data.fxRateUpdatedAt).toLocaleString("ja-JP")}`
                  : "まだ自動取得していません（下の入力値を使用中）"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={syncFx.isPending}
                onClick={() => syncFx.mutate()}
              >
                {syncFx.isPending ? "取得中…" : "今すぐ取得"}
              </Button>
              <Switch
                id="fx-auto"
                checked={fxAuto}
                onCheckedChange={v => {
                  setFxAuto(v);
                  mark();
                }}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="usdjpy">USD/JPY レート</Label>
              <Input
                id="usdjpy"
                type="number"
                inputMode="decimal"
                value={usdJpy}
                onChange={e => {
                  setUsdJpy(e.target.value);
                  mark();
                }}
                className="tabular"
              />
              {fxAuto ? (
                <p className="text-xs text-muted-foreground">
                  自動取得が有効なため、株価更新のたびに上書きされます
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="sgdjpy">SGD/JPY レート</Label>
              <Input
                id="sgdjpy"
                type="number"
                inputMode="decimal"
                value={sgdJpy}
                onChange={e => {
                  setSgdJpy(e.target.value);
                  mark();
                }}
                className="tabular"
              />
              <p className="text-xs text-muted-foreground">
                シンガポール株（SGX）と IBKR の借入・証拠金の円換算に使います
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cash-setting">現金残高（JPY）</Label>
              <Input
                id="cash-setting"
                type="number"
                inputMode="decimal"
                value={cash}
                onChange={e => {
                  setCash(e.target.value);
                  mark();
                }}
                className="tabular"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 信用取引の借入は資産計算に直結するため、為替・現金の直後に置く */}
      <MarginSettings />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">集中度アラート</CardTitle>
          <CardDescription className="text-xs">
            構成比がしきい値を超えた場合、ダッシュボードに警告を表示します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pos-th">単一銘柄のしきい値（%）</Label>
              <Input
                id="pos-th"
                type="number"
                inputMode="numeric"
                value={posThreshold}
                onChange={e => {
                  setPosThreshold(e.target.value);
                  mark();
                }}
                className="tabular"
              />
              <p className="text-xs text-muted-foreground">
                1 銘柄がポートフォリオのこの割合を超えたら警告します
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sec-th">業種のしきい値（%）</Label>
              <Input
                id="sec-th"
                type="number"
                inputMode="numeric"
                value={secThreshold}
                onChange={e => {
                  setSecThreshold(e.target.value);
                  mark();
                }}
                className="tabular"
              />
              <p className="text-xs text-muted-foreground">
                同一業種の合計がこの割合を超えたら警告します
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">自動更新</CardTitle>
          <CardDescription className="text-xs">
            毎日定時に株価とニュースを自動取得します。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="auto-news">ニュースの自動取得</Label>
              <p className="text-xs text-muted-foreground">
                無効にすると、手動で取得したときだけ更新されます
              </p>
            </div>
            <Switch
              id="auto-news"
              checked={autoNews}
              onCheckedChange={v => {
                setAutoNews(v);
                mark();
              }}
            />
          </div>

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">業種情報の再取得</p>
              <p className="text-xs text-muted-foreground">
                業種が「未分類」のままの銘柄がある場合に実行してください
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={enrich.isPending}
              onClick={() => enrich.mutate({ force: true })}
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${enrich.isPending ? "animate-spin" : ""}`} />
              業種情報を再取得
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">表示</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label>テーマ</Label>
              <p className="text-xs text-muted-foreground">
                現在: {theme === "dark" ? "ダーク" : "ライト"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={toggleTheme}>
              {theme === "dark" ? (
                <>
                  <Sun className="mr-1.5 h-3.5 w-3.5" />
                  ライトに切替
                </>
              ) : (
                <>
                  <Moon className="mr-1.5 h-3.5 w-3.5" />
                  ダークに切替
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          disabled={update.isPending || !dirty}
          onClick={() =>
            update.mutate({
              // 自動取得が有効なときに手動値を送ると fxRateUpdatedAt が消えて
              // 「まだ自動取得していません」と表示されてしまうため、手動時のみ送る
              usdJpyRate: !fxAuto && Number(usdJpy) > 0 ? Number(usdJpy) : undefined,
              sgdJpyRate: !fxAuto && Number(sgdJpy) > 0 ? Number(sgdJpy) : undefined,
              concentrationThreshold: Number(posThreshold) > 0 ? Number(posThreshold) : undefined,
              sectorConcentrationThreshold:
                Number(secThreshold) > 0 ? Number(secThreshold) : undefined,
              cashBalance: cash === "" ? undefined : Number(cash),
              autoNewsEnabled: autoNews,
              fxAutoUpdate: fxAuto,
            })
          }
        >
          <Save className="mr-1.5 h-4 w-4" />
          {update.isPending ? "保存中..." : "設定を保存"}
        </Button>
      </div>

      <DisclaimerNote />
    </div>
  );
}
