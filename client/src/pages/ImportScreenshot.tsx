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
import { looksLikeImage, prepareImage } from "@/lib/imageFile";
import { marketLabel, type Market } from "@shared/investing";
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
  market: Market;
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

type FormatId = "moomoo_jp" | "rakuten_ispeed" | "futu" | "generic";

/** 前回選択した証券アプリを覚えておくためのキー */
const FORMAT_STORAGE_KEY = "investdesk.import.format";

const MAX_FILES = 5;

/** 変換後のサイズ上限。サーバー側の受け入れ上限に合わせる */
const MAX_BYTES = 8 * 1024 * 1024;

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
  const [preparing, setPreparing] = useState(false);
  // 一度選べば次回以降も同じアプリが選択された状態になる
  const [formatId, setFormatId] = useState<FormatId>(() => {
    const saved = window.localStorage.getItem(FORMAT_STORAGE_KEY);
    return saved === "moomoo_jp" || saved === "rakuten_ispeed" || saved === "futu"
      ? saved
      : "moomoo_jp";
  });

  const formats = trpc.import.formats.useQuery();

  const changeFormat = (next: FormatId) => {
    setFormatId(next);
    window.localStorage.setItem(FORMAT_STORAGE_KEY, next);
  };

  const parse = trpc.import.parseScreenshots.useMutation({
    onSuccess: res => {
      setRows(res.rows as Row[]);
      setJobId(res.jobId ?? null);
      setWarnings(res.warnings);
      if (res.account.cash !== null) setCash(String(res.account.cash));
      toast.success(`${res.rows.length} 銘柄を読み取りました。内容をご確認ください。`);
      // 選択と実際の画面が食い違っていた場合は知らせる
      if (
        res.detectedFormatId !== "generic" &&
        res.detectedFormatId !== res.formatId
      ) {
        const detected = formats.data?.find(f => f.id === res.detectedFormatId);
        if (detected) {
          toast.info(
            `画面から「${detected.label}」と判定しました。選択と違う場合は次回から切り替えてください。`
          );
        }
      }
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
    const targets = Array.from(list).slice(0, MAX_FILES - files.length);
    if (targets.length === 0) return;

    setPreparing(true);
    try {
      const picked: Picked[] = [];
      for (const file of targets) {
        if (!looksLikeImage(file)) {
          toast.error(`${file.name || "選択されたファイル"} は画像として扱えません`);
          continue;
        }
        try {
          const prepared = await prepareImage(file);
          if (prepared.byteSize > MAX_BYTES) {
            toast.error(`${file.name} は変換後も 8MB を超えています`);
            continue;
          }
          picked.push({
            dataUrl: prepared.dataUrl,
            fileName: prepared.fileName,
            preview: prepared.dataUrl,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "画像を読み取れませんでした";
          toast.error(`${file.name || "画像"}: ${message}`);
        }
      }
      if (picked.length > 0) {
        setFiles(prev => [...prev, ...picked].slice(0, MAX_FILES));
      }
    } finally {
      setPreparing(false);
    }
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
                    PNG / JPEG / WebP / HEIC ・ 最大 {MAX_FILES} 枚
                    <br />
                    保有一覧が画面に収まらない場合は、スクロールして複数枚に分けて撮影してください。
                  </p>
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*,.heic,.heif"
                  multiple
                  className="hidden"
                  onChange={e => {
                    void addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  disabled={preparing}
                  onClick={() => fileInput.current?.click()}
                >
                  {preparing ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 h-4 w-4" />
                  )}
                  {preparing ? "画像を準備中..." : "ファイルを選択"}
                </Button>
              </div>

              {files.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {/* 証券アプリの選択 */}
                  <div className="space-y-2 rounded-lg border bg-muted/20 p-3 sm:flex sm:items-end sm:gap-4 sm:space-y-0">
                    <div className="w-full space-y-1.5 sm:w-[260px] sm:shrink-0">
                      <Label htmlFor="broker-format" className="text-xs">
                        どの証券アプリの画面ですか
                      </Label>
                      <Select value={formatId} onValueChange={v => changeFormat(v as FormatId)}>
                        <SelectTrigger id="broker-format" className="h-9 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(formats.data ?? []).map(f => (
                            <SelectItem key={f.id} value={f.id}>
                              <span className="flex items-center gap-2">
                                {f.label}
                                {f.verified ? (
                                  <Badge
                                    variant="outline"
                                    className="h-4 border-gain/40 px-1 text-[10px] text-gain"
                                  >
                                    学習済
                                  </Badge>
                                ) : null}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground sm:flex-1">
                      「学習済」のアプリは画面の列構成を把握しているため、読み取り精度が上がります。
                      一覧にないアプリは「その他」を選んでください。
                    </p>
                  </div>

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
                          formatId,
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

          {/* スマホ: 1 銘柄 1 カード。横スクロールせずすべての項目が見える */}
          <div className="space-y-3 lg:hidden">
            {rows.map((r, i) => (
              <Card
                key={`m-${r.symbol}-${i}`}
                className={r.mode === "SKIP" ? "opacity-50" : ""}
              >
                <CardContent className="space-y-3 p-4">
                  {/* 銘柄名と削除 */}
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Input
                        value={r.name}
                        onChange={e => updateRow(i, { name: e.target.value })}
                        className="h-10 text-base font-medium"
                      />
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="tabular">{r.symbol}</span>
                        <span>·</span>
                        <span>{marketLabel(r.market)}</span>
                        {r.existingQuantity !== null ? (
                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                            登録済
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className={`h-4 px-1 text-[10px] ${
                            r.confidence >= 90
                              ? "border-gain/40 text-gain"
                              : r.confidence >= 60
                                ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                                : "border-loss/40 text-loss"
                          }`}
                        >
                          確信度 {r.confidence}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setRows(prev => prev?.filter((_, idx) => idx !== i) ?? null)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* 株数・取得単価を横並びで大きく表示 */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">株数</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={r.quantity ?? ""}
                        onChange={e =>
                          updateRow(i, {
                            quantity: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className={`tabular h-11 text-base ${r.quantity === null ? "border-destructive" : ""}`}
                      />
                      {r.existingQuantity !== null && r.existingQuantity !== r.quantity ? (
                        <p className="tabular text-[11px] text-muted-foreground">
                          現在: {r.existingQuantity}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">取得単価</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={r.avgCost ?? ""}
                        onChange={e =>
                          updateRow(i, {
                            avgCost: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        className={`tabular h-11 text-base ${r.avgCost === null ? "border-destructive" : ""}`}
                      />
                      {r.existingAvgCost !== null && r.existingAvgCost !== r.avgCost ? (
                        <p className="tabular text-[11px] text-muted-foreground">
                          現在: {r.existingAvgCost}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* 読取時の現在値と処理方法 */}
                  <div className="flex items-end gap-3">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs text-muted-foreground">処理</Label>
                      <Select
                        value={r.mode}
                        onValueChange={v => updateRow(i, { mode: v as Row["mode"] })}
                      >
                        <SelectTrigger className="h-10 w-full text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NEW">新規追加</SelectItem>
                          <SelectItem value="UPDATE">既存を更新</SelectItem>
                          <SelectItem value="SKIP">取り込まない</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 text-right">
                      <Label className="text-xs text-muted-foreground">読取時の現在値</Label>
                      <MoneyText
                        value={r.currentPrice}
                        currency={r.market === "JP" ? "JPY" : "USD"}
                        className="block pb-2.5 text-sm text-muted-foreground"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* デスクトップ: 一覧性の高い表 */}
          <Card className="hidden overflow-hidden lg:block">
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
            <p className="w-full text-sm text-muted-foreground sm:w-auto">
              {activeRows.length} 件を保存します
              {(rows.length ?? 0) - activeRows.length > 0
                ? `（${rows.length - activeRows.length} 件はスキップ）`
                : ""}
            </p>
            <div className="flex w-full gap-2 sm:w-auto">
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={() => {
                  setRows(null);
                  setWarnings([]);
                  setJobId(null);
                }}
              >
                やり直す
              </Button>
              <Button
                className="flex-1 sm:flex-none"
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
                    formatId,
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
