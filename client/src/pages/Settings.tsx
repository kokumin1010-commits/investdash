import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
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
  const [posThreshold, setPosThreshold] = useState("");
  const [secThreshold, setSecThreshold] = useState("");
  const [cash, setCash] = useState("");
  const [autoNews, setAutoNews] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setUsdJpy(settings.data.usdJpyRate ?? "150");
    setPosThreshold(String(settings.data.concentrationThreshold));
    setSecThreshold(String(settings.data.sectorConcentrationThreshold));
    setCash(settings.data.cashBalance ?? "0");
    setAutoNews(settings.data.autoNewsEnabled);
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
          為替レート、アラートのしきい値、表示テーマを設定します。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">資産計算</CardTitle>
          <CardDescription className="text-xs">
            米国株の評価額は、この為替レートで円換算されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              usdJpyRate: Number(usdJpy) > 0 ? Number(usdJpy) : undefined,
              concentrationThreshold: Number(posThreshold) > 0 ? Number(posThreshold) : undefined,
              sectorConcentrationThreshold:
                Number(secThreshold) > 0 ? Number(secThreshold) : undefined,
              cashBalance: cash === "" ? undefined : Number(cash),
              autoNewsEnabled: autoNews,
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

