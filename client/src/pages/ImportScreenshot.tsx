import { DisclaimerNote } from "@/components/investing/DisclaimerNote";
import { MoneyText } from "@/components/investing/Figures";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { marketLabel } from "@shared/investing";
import {
  AlertTriangle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  ScanLine,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

type Row = {
  name: string;
  symbol: string;
  tickerCode: string;
  market: "JP" | "US" | "OTHER";
  quantity: number | null;
  avgCost: number | null;
  currentPrice: number | null;
  marketValue: number | null;
  pnl: number | null;
  confidence: number;
  mode: "NEW" | "UPDATE" | "SKIP";
  existingQuantity: number | null;
  existingAvgCost: number | null;
};

type Picked = { dataUrl: string; fileName: string; preview: string };

const MAX_FILES = 5;

export default function ImportScreenshot() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [cash, setCash] = useState<string>("");
  const [dragging, setDragging] = useState(false);

  const parse = trpc.import.parseScreenshots.useMutation({
    onSuccess: res => {
      setRows(res.rows as Row[]);
      setJobId(res.jobId);
      setWarnings(res.warnings);
      if (res.account.cash !== null) setCash(String(res.account.cash));
      toast.success(`${res.rows.length} 銘柄を読み取りました。内容をご確認ください。`);
    },
    onError: e => toast.error(e.message),
  });

  const apply = trpc.import.applyRows.useMutation({
    onSuccess: async res => {
      await utils.invalidate();
      const parts: string[] = [];
      if (res.created > 0) parts.push(`新規 ${res.created} 件`);
      if (res.updated > 0) parts.push(`更新 ${res.updated} 件`);
      toast.success(
        parts.length > 0 ? `${parts.join(" ・ ")} を保存しました` : "保存対象がありませんでした"
      );
      if (res.skipped.length > 0) {
        toast.warning(`${res.skipped.length} 件をスキップしました: ${res.skipped.join(", ")}`);
      }
      setRows(null);
      setFiles([]);
      setJobId(null);
      setWarnings([]);
      if (res.created + res.updated > 0) setLocation("/holdings");
    },
    onError: e => toast.error(e.message),
  });

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const picked: Picked[] = [];
    for (const file of Array.from(list).slice(0, MAX_FILES - files.length)) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} は画像ファイルではありません`);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        toast.error(`${file.name} は 8MB を超えています`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      picked.push({ dataUrl, fileName: file.name, preview: dataUrl });
    }
    setFiles(prev => [...prev, ...picked].slice(0, MAX_FILES));
  };

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows(prev => (prev ? prev.map((r, i) => (i === index ? { ...r, ...patch } : r)) : prev));
  };

  const activeRows = (rows ?? []).filter(r => r.mode !== "SKIP");

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 pb-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">スクリーンショット取込</h1>
        <p className="text-sm text-muted-foreground">
          証券会社アプリの保有一覧のスクリーンショットから、銘柄コード・株数・取得単価を自動で読み取ります。
        </p>
      </header>

      {rows === null ? (
        <>
          {/* アップロードエリア */}
          <Card>
            <CardContent className="pt-6">
              <div
                onDragOver={e => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => {
                  e.preventDefault();
                  setDragging(false);
                  void addFiles(e.dataTransfer.files);
                }}
                className={`flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
                  dragging ? "border-primary bg-accent/60" : "border-border bg-muted/20"
                }`}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
                  <ImagePlus className="h-7 w-7 text-primary" />
                </div>
                <div className="space-y-1.5">
                  <p className="font-medium">画像をドラッグ＆ドロップ、またはファイルを選択</p>
                  <p className="text-xs text-muted-foreground">
                    PNG / JPEG / WebP ・ 1 枚 8MB まで ・ 最大 {MAX_FILES} 枚
                    <br />
                    保有一覧が画面に収まらない場合は、スクロールして複数枚に分けて撮影してください。
                  </p>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button variant="outline" onClick={() => fileInput.current?.click()}>
                  <Upload className="mr-1.5 h-4 w-4" />
                  ファイルを選択
                </Button>
              </div>

              {files.length > 0 ? (
                <div className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {files.map((f, i) => (
                      <div key={i} className="group relative overflow-hidden rounded-lg border">
                        <img
                          src={f.preview}
                          alt={f.fileName}
                          className="h-32 w-full bg-muted object-cover object-top"
                        />
                        <button
                          onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-background/90 shadow-sm transition-transform hover:scale-105 active:scale-95"
                          aria-label="削除"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <p className="truncate px-2 py-1.5 text-[11px] text-muted-foreground">
                          {f.fileName}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setFiles([])}>
                      すべてクリア
                    </Button>
                    <Button
                      disabled={parse.isPending}
                      onClick={() =>
                        parse.mutate({
                          images: files.map(f => ({ dataUrl: f.dataUrl, fileName: f.fileName })),
                        })
                      }
                    >
                      {parse.isPending ? (
                        <>
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          読み取り中...
                        </>
                      ) : (
                        <>
                          <ScanLine className="mr-1.5 h-4 w-4" />
                          読み取りを開始
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">きれいに読み取るためのコツ</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="text-primary">・</span>
                  銘柄名・コード・株数・取得単価・現在値が画面に写っている状態で撮影してください
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">・</span>
                  取得単価が画面右端で切れていると読み取れません。横向きにするか、表示項目を切り替えてください
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">・</span>
                  読み取り結果は保存前に必ず確認・修正できます。数値が違う場合はその場で直せます
                </li>
                <li className="flex gap-2">
                  <span className="text-primary">・</span>
                  すでに登録済みの銘柄は「更新」として扱われ、株数と取得単価が上書きされます
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* 確認・編集テーブル */}
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle className="text-sm">読み取り結果をご確認ください</AlertTitle>
            <AlertDescription className="text-xs">
              数値が誤っている場合は直接編集できます。確信度が低い行は特に注意してご確認ください。「保存する」を押すまでデータベースには反映されません。
            </AlertDescription>
          </Alert>

          {warnings.length > 0 ? (
            <Alert className="border-amber-500/30 bg-amber-500/10">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-sm">読み取り時の注意点</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {warnings.map((w, i) => (
                    <li key={i}>・{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[110px]">処理</TableHead>
                    <TableHead className="min-w-[180px]">銘柄</TableHead>
                    <TableHead className="w-[120px]">株数</TableHead>
                    <TableHead className="w-[130px]">取得単価</TableHead>
                    <TableHead className="text-right">読取時の現在値</TableHead>
                    <TableHead className="w-[90px] text-right">確信度</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.symbol}-${i}`} className={r.mode === "SKIP" ? "opacity-40" : ""}>
                      <TableCell>
                        <Select
                          value={r.mode}
                          onValueChange={v => updateRow(i, { mode: v as Row["mode"] })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NEW">新規追加</SelectItem>
                            <SelectItem value="UPDATE">既存を更新</SelectItem>
                            <SelectItem value="SKIP">取り込まない</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          <Input
                            value={r.name}
                            onChange={e => updateRow(i, { name: e.target.value })}
                            className="h-8 text-sm"
                          />
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <span className="tabular">{r.symbol}</span>
                            <span>·</span>
                            <span>{marketLabel(r.market)}</span>
                            {r.existingQuantity !== null ? (
                              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                登録済
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={r.quantity ?? ""}
                          onChange={e =>
                            updateRow(i, {
                              quantity: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          className={`tabular h-8 text-sm ${r.quantity === null ? "border-destructive" : ""}`}
                        />
                        {r.existingQuantity !== null && r.existingQuantity !== r.quantity ? (
                          <p className="mt-0.5 tabular text-[10px] text-muted-foreground">
                            現在: {r.existingQuantity}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={r.avgCost ?? ""}
                          onChange={e =>
                            updateRow(i, {
                              avgCost: e.target.value === "" ? null : Number(e.target.value),
                            })
                          }
                          className={`tabular h-8 text-sm ${r.avgCost === null ? "border-destructive" : ""}`}
                        />
                        {r.existingAvgCost !== null && r.existingAvgCost !== r.avgCost ? (
                          <p className="mt-0.5 tabular text-[10px] text-muted-foreground">
                            現在: {r.existingAvgCost}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyText
                          value={r.currentPrice}
                          currency={r.market === "JP" ? "JPY" : "USD"}
                          className="text-sm text-muted-foreground"
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={
                            r.confidence >= 90
                              ? "border-gain/40 text-gain"
                              : r.confidence >= 60
                                ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                                : "border-loss/40 text-loss"
                          }
                        >
                          {r.confidence}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setRows(prev => prev?.filter((_, idx) => idx !== i) ?? null)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">現金残高（任意）</CardTitle>
              <CardDescription className="text-xs">
                預り金を入力すると、ダッシュボードの総資産に反映されます。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-w-xs space-y-2">
                <Label htmlFor="cash">預り金（JPY）</Label>
                <Input
                  id="cash"
                  type="number"
                  inputMode="decimal"
                  value={cash}
                  onChange={e => setCash(e.target.value)}
                  placeholder="1255302"
                  className="tabular"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {activeRows.length} 件を保存します
              {(rows.length ?? 0) - activeRows.length > 0
                ? `（${rows.length - activeRows.length} 件はスキップ）`
                : ""}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setRows(null);
                  setWarnings([]);
                  setJobId(null);
                }}
              >
                やり直す
              </Button>
              <Button
                disabled={apply.isPending || activeRows.length === 0}
                onClick={() =>
                  apply.mutate({
                    jobId: jobId ?? undefined,
                    rows: rows.map(r => ({
                      name: r.name,
                      tickerCode: r.tickerCode,
                      symbol: r.symbol,
                      market: r.market,
                      quantity: r.quantity,
                      avgCost: r.avgCost,
                      currentPrice: r.currentPrice,
                      marketValue: r.marketValue,
                      pnl: r.pnl,
                      confidence: r.confidence,
                      mode: r.mode,
                    })),
                    cashBalance: cash === "" ? null : Number(cash),
                  })
                }
              >
                {apply.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    保存中...
                  </>
                ) : (
                  "保存する"
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      <DisclaimerNote />
    </div>
  );
}
