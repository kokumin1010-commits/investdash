import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getStoredToken } from "@/lib/passcodeSession";
import { trpc } from "@/lib/trpc";
import {
  BROKER_LABELS,
  BROKERS,
  brokerLabel,
  brokerStyle,
  type Broker,
} from "@shared/investing";
import { CalendarDays, ImageIcon, Loader2, ShieldCheck } from "lucide-react";
import * as React from "react";
import { useEffect, useMemo, useState } from "react";

const ALL = "ALL";

type SelectedImage = {
  jobId: number;
  imageIndex: number;
  fileName: string | null;
  broker: Broker;
  asOfDate: string;
};

function evidenceEndpoint(jobId: number, imageIndex: number) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/api/import-evidence/${jobId}/${imageIndex}`;
}

function ProtectedEvidenceImage({
  jobId,
  imageIndex,
  alt,
  className,
  eager = false,
}: {
  jobId: number;
  imageIndex: number;
  alt: string;
  className: string;
  eager?: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(eager);
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (eager || shouldLoad) return;
    const target = containerRef.current;
    if (!target || !("IntersectionObserver" in window)) {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [eager, shouldLoad]);

  useEffect(() => {
    if (!shouldLoad) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const token = getStoredToken();
    void fetch(evidenceEndpoint(jobId, imageIndex), {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
    })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.error("[ScreenshotHistory] image load failed", error);
          setFailed(true);
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageIndex, jobId, shouldLoad]);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-muted text-xs text-muted-foreground ${className}`}
      >
        画像を表示できません
      </div>
    );
  }
  if (!src) {
    return (
      <div
        ref={containerRef}
        className={`flex items-center justify-center bg-muted/60 ${className}`}
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return <img src={src} alt={alt} className={className} />;
}

function formatImportTime(value: string | Date) {
  return new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function recordSummary(item: {
  holdingCount: number;
  accountCashCount: number;
  interestCount: number;
  dividendCount: number;
}) {
  const parts: string[] = [];
  if (item.holdingCount > 0) parts.push(`保有 ${item.holdingCount}`);
  if (item.accountCashCount > 0) parts.push(`現金 ${item.accountCashCount}`);
  if (item.interestCount > 0) parts.push(`利息 ${item.interestCount}`);
  if (item.dividendCount > 0) parts.push(`配当 ${item.dividendCount}`);
  return parts.join("・") || "保存済み証拠";
}

export function ScreenshotHistoryCard() {
  const history = trpc.import.history.useQuery();
  const [broker, setBroker] = useState<string>(ALL);
  const [month, setMonth] = useState<string>(ALL);
  const [selected, setSelected] = useState<SelectedImage | null>(null);

  const months = useMemo(
    () =>
      Array.from(
        new Set((history.data ?? []).map(item => item.asOfDate.slice(0, 7)))
      ),
    [history.data]
  );
  const items = useMemo(
    () =>
      (history.data ?? []).filter(
        item =>
          (broker === ALL || item.broker === broker) &&
          (month === ALL || item.asOfDate.startsWith(month))
      ),
    [broker, history.data, month]
  );

  return (
    <>
      <Card>
        <CardHeader className="space-y-2 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4 text-primary" />
                スクリーンショット履歴
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                保存を確定した原画像を、証券口座と基準日ごとに確認できます。
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className="gap-1 border-primary/25 text-primary"
            >
              <ShieldCheck className="h-3 w-3" />
              パスコード保護
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <Select value={broker} onValueChange={setBroker}>
              <SelectTrigger
                aria-label="履歴の証券口座"
                className="h-9 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>すべての口座</SelectItem>
                {BROKERS.filter(item => item !== "other").map(item => (
                  <SelectItem key={item} value={item}>
                    {BROKER_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger aria-label="履歴の年月" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>すべての年月</SelectItem>
                {months.map(value => (
                  <SelectItem key={value} value={value}>
                    {value.replace("-", "年")}月
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              履歴を読み込み中
            </div>
          ) : history.error ? (
            <p className="py-8 text-center text-sm text-destructive">
              履歴を取得できませんでした
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              条件に一致する保存済みスクリーンショットはありません。
            </p>
          ) : (
            <div className="space-y-4">
              {items.map(item => (
                <section
                  key={item.jobId}
                  className="overflow-hidden rounded-xl border bg-muted/10"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={brokerStyle(item.broker)}
                        >
                          {brokerLabel(item.broker)}
                        </Badge>
                        <span className="flex items-center gap-1 text-sm font-medium tabular-nums">
                          <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                          {item.asOfDate}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {recordSummary(item)}・{item.images.length}枚・取込{" "}
                        {formatImportTime(item.createdAt)}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      保存済み
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
                    {item.images.map(image => (
                      <Button
                        key={`${item.jobId}-${image.index}`}
                        type="button"
                        variant="outline"
                        className="h-auto min-w-0 overflow-hidden p-0 text-left"
                        onClick={() =>
                          setSelected({
                            jobId: item.jobId,
                            imageIndex: image.index,
                            fileName: image.fileName,
                            broker: item.broker,
                            asOfDate: item.asOfDate,
                          })
                        }
                      >
                        <span className="block min-w-0 w-full">
                          <ProtectedEvidenceImage
                            jobId={item.jobId}
                            imageIndex={image.index}
                            alt={
                              image.fileName ??
                              `${brokerLabel(item.broker)}のスクリーンショット`
                            }
                            className="h-32 w-full bg-muted object-cover object-top"
                          />
                          <span className="block truncate px-2 py-1.5 text-[11px] text-muted-foreground">
                            {image.fileName ?? `画像 ${image.index + 1}`}
                          </span>
                        </span>
                      </Button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selected !== null}
        onOpenChange={open => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[94vh] max-w-[min(94vw,1100px)] overflow-y-auto p-3 sm:p-5">
          {selected ? (
            <>
              <DialogHeader className="pr-8 text-left">
                <DialogTitle className="text-base">
                  {brokerLabel(selected.broker)}・{selected.asOfDate}
                </DialogTitle>
                <DialogDescription className="truncate">
                  {selected.fileName ?? `画像 ${selected.imageIndex + 1}`}
                  ・保存済み原画像
                </DialogDescription>
              </DialogHeader>
              <ProtectedEvidenceImage
                jobId={selected.jobId}
                imageIndex={selected.imageIndex}
                alt={
                  selected.fileName ??
                  `${brokerLabel(selected.broker)}の保存済み原画像`
                }
                className="max-h-[78vh] w-full rounded-lg bg-muted object-contain"
                eager
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
