/**
 * AI に相談する画面。
 *
 * 購入判断はもともと外部の AI に相談して決めていた。そのやり取りは
 * どこにも残らないため「あの時なぜ買ったのか」を後から辿れない。
 * ここで相談すると保有状況（借入・レバレッジ・配当・偏り）が
 * 自動で前提に入り、やり取りは履歴として残る。
 */
import { AiBody } from "@/components/investing/AiBody";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { AdviceRecordCard } from "@/components/investing/AdviceRecordCard";
import { ArrowLeft, FileText, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSearch } from "wouter";

/**
 * 相談の例。
 *
 * 空欄から書き始めるのは負担が大きい。押すだけで送れる例を置いて
 * 「何を聞けるのか」が分かる状態にする。
 */
const EXAMPLES = [
  "今の保有状況で、レバレッジを上げてまで買い増すべき銘柄はあるか",
  "配当が金融と一般消費財に偏っているが、どう考えればよいか",
  "借入 2.29 億円を一部返すべきか、それとも買い増しに回すべきか",
  "今買い増し圏に入っている銘柄のうち、優先順位はどう考えるか",
];

function formatDateTime(d: Date | string) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Consult() {
  /*
   * 他のページ（Holdings / Dividends）と同じ useSearch を使う。
   * ライブラリ内で API が揺れている箇所なので、既に動いている
   * 書き方に揃えて壊れないようにする。
   */
  const search = useSearch();
  const searchParams = new URLSearchParams(search);
  const symbolParam = searchParams.get("symbol");
  const questionParam = searchParams.get("question");
  /*
   * 銘柄詳細の相談タブから特定の相談を開き直せるようにする。
   * 一覧から探し直させると、銘柄が多い場合に目的の相談まで辿れない。
   */
  const idParam = new URLSearchParams(search).get("id");
  const [openId, setOpenId] = useState<number | null>(null);

  /*
   * 銘柄付きで開かれたときは新規の相談として始める。
   * 既存の会話を開いてしまうと、別の銘柄の話に混ざる。
   */
  useEffect(() => {
    if (symbolParam) setOpenId(null);
  }, [symbolParam]);

  useEffect(() => {
    const n = Number(idParam);
    if (idParam && Number.isFinite(n) && n > 0) setOpenId(n);
  }, [idParam]);

  if (openId !== null) {
    return <ConsultThread id={openId} onBack={() => setOpenId(null)} />;
  }
  return <ConsultStart symbol={symbolParam} initialQuestion={questionParam} onOpen={setOpenId} />;
}

function ConsultStart({
  symbol,
  initialQuestion,
  onOpen,
}: {
  symbol: string | null;
  initialQuestion: string | null;
  onOpen: (id: number) => void;
}) {
  const [question, setQuestion] = useState(() => initialQuestion ?? "");
  const utils = trpc.useUtils();
  const list = trpc.consult.list.useQuery();

  const ask = trpc.consult.ask.useMutation({
    onSuccess: async res => {
      setQuestion("");
      await utils.consult.list.invalidate();
      onOpen(res.consultationId);
    },
    onError: err => toast.error(err.message),
  });

  const remove = trpc.consult.remove.useMutation({
    onSuccess: async () => {
      await utils.consult.list.invalidate();
      toast.success("相談を削除しました");
    },
    onError: err => toast.error(err.message),
  });

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("質問を入力してください");
      return;
    }
    ask.mutate({ question: trimmed, symbol: symbol ?? null });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI に相談</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          保有状況・借入・レバレッジ・配当の偏りを前提に入れて答えます。やり取りは履歴に残ります。
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {symbol ? `${symbol} について相談する` : "新しく相談する"}
          </CardTitle>
          <CardDescription>
            買う・待つ・売るのどれかを結論として出します。最終判断はご自身で行ってください。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder={
              symbol
                ? `${symbol} を今から買い増してよいか、判断材料を出してほしい`
                : "例: 今の保有状況で、レバレッジを上げてまで買い増すべき銘柄はあるか"
            }
            rows={4}
            disabled={ask.isPending}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => send(question)} disabled={ask.isPending} className="gap-2">
              {ask.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {ask.isPending ? "考えています（20 秒ほど）" : "相談する"}
            </Button>
          </div>

          {!symbol && (
            <div className="space-y-2 pt-1">
              <p className="text-muted-foreground text-xs">こんなことが聞けます</p>
              <div className="flex flex-col gap-2">
                {EXAMPLES.map(ex => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setQuestion(ex)}
                    disabled={ask.isPending}
                    className="hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">相談の履歴</CardTitle>
          <CardDescription>
            過去のやり取りを開くと、そのまま続きを聞けます。当時の前提も残っています。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {list.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : list.isError ? (
            <p className="text-destructive text-sm">
              履歴を読み込めませんでした（{list.error.message}）
            </p>
          ) : !list.data || list.data.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              まだ相談がありません。上の欄から相談すると、ここに残ります。
            </p>
          ) : (
            <div className="divide-y">
              {list.data.map(row => (
                <div key={row.id} className="flex items-start gap-2 py-3 first:pt-0 last:pb-0">
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {row.symbol && (
                        <Badge variant="outline" className="font-mono text-xs">
                          {row.symbol}
                        </Badge>
                      )}
                      <span className="text-sm font-medium">{row.title}</span>
                    </div>
                    {row.lastAnswerHead && (
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        {row.lastAnswerHead}
                      </p>
                    )}
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatDateTime(row.updatedAt)} ・ {row.messageCount} 件のやり取り
                    </p>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: row.id })}
                    aria-label="この相談を削除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        提案の実績は履歴の下に置く。相談を始める欄より上に出すと、
        まだ判定できる提案がない段階で場所を取るだけになる。
      */}
      <AdviceRecordCard />
    </div>
  );
}

function ConsultThread({ id, onBack }: { id: number; onBack: () => void }) {
  const [followUp, setFollowUp] = useState("");
  const utils = trpc.useUtils();
  const { data, isPending, isError, error } = trpc.consult.get.useQuery({ id });
  const endRef = useRef<HTMLDivElement>(null);

  const ask = trpc.consult.ask.useMutation({
    onSuccess: async () => {
      setFollowUp("");
      await utils.consult.get.invalidate({ id });
      await utils.consult.list.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  /*
   * 相談の内容を投資カードに書き戻す。
   * 何が反映され何が反映されなかったかを出す。「反映しました」だけだと
   * 触れていない項目も書かれたと誤解する。
   */
  const applyToCard = trpc.consult.applyToCard.useMutation({
    onSuccess: async res => {
      await utils.portfolio.invalidate();
      if (res.applied.length === 0) {
        toast.info(
          res.note ?? "投資カードに残せる内容が相談から見つかりませんでした"
        );
      } else {
        const skipped =
          res.skipped.length > 0 ? `（${res.skipped.join("・")}は該当なし）` : "";
        toast.success(`${res.applied.join("・")}に追記しました${skipped}`);
      }
    },
    onError: err => toast.error(err.message),
  });

  /*
   * 回答が増えたら末尾へ寄せる。長い回答が付くと下が見えず、
   * 答えが返ってきたことに気付きにくい。
   */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.messages.length]);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ArrowLeft className="h-4 w-4" />
        相談の一覧へ
      </Button>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <p className="text-destructive text-sm">
          相談を読み込めませんでした（{error.message}）
        </p>
      ) : !data ? (
        <p className="text-muted-foreground text-sm">相談が見つかりませんでした。</p>
      ) : (
        <>
          <div>
            <h1 className="text-lg font-semibold">{data.consultation.title}</h1>
            <p className="text-muted-foreground mt-1 text-xs">
              {formatDateTime(data.consultation.createdAt)} 開始
              {data.consultation.symbol ? ` ・ ${data.consultation.symbol}` : ""}
            </p>
          </div>

          {/*
            相談で出た撤退条件やリスクを投資カードに移せるようにする。
            相談画面の中に置いておくと、次に株価が動いたときに参照されない。
            銘柄を指定していない相談はどのカードに書くか決められないので出さない。
          */}
          {data.consultation.symbol ? (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">この相談を投資カードに残す</p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    出てきた撤退条件・リスク・前提を {data.consultation.symbol} のカードに
                    追記します（既存の内容は消しません）
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background shrink-0"
                  disabled={applyToCard.isPending}
                  onClick={() => applyToCard.mutate({ consultationId: id, mode: "append" })}
                >
                  {applyToCard.isPending ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      整理中…
                    </>
                  ) : (
                    <>
                      <FileText className="mr-1.5 h-3.5 w-3.5" />
                      投資カードに反映
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <div className="space-y-3">
            {data.messages.map(m =>
              m.role === "USER" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                    {m.content}
                  </div>
                </div>
              ) : (
                <Card key={m.id}>
                  <CardContent className="pt-4">
                    <AiBody body={m.content} />
                    <p className="text-muted-foreground mt-3 text-xs">
                      {formatDateTime(m.createdAt)}
                      {m.model ? ` ・ ${m.model}` : ""}
                    </p>
                  </CardContent>
                </Card>
              )
            )}
            <div ref={endRef} />
          </div>

          <Card>
            <CardContent className="space-y-3 pt-4">
              <Textarea
                value={followUp}
                onChange={e => setFollowUp(e.target.value)}
                placeholder="続けて聞く（例: では代わりに別の銘柄を買うのはどうか）"
                rows={3}
                disabled={ask.isPending}
              />
              <Button
                onClick={() => {
                  const trimmed = followUp.trim();
                  if (!trimmed) {
                    toast.error("質問を入力してください");
                    return;
                  }
                  ask.mutate({ question: trimmed, consultationId: id });
                }}
                disabled={ask.isPending}
                className="gap-2"
              >
                {ask.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
                {ask.isPending ? "考えています（20 秒ほど）" : "続けて聞く"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
