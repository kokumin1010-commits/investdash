/**
 * 設定ページ内のパスコード変更フォーム。
 */
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PASSCODE_PATTERN = /^\d{4,6}$/;

export default function PasscodeSettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const utils = trpc.useUtils();
  const usingDefault = trpc.auth.usingDefaultPasscode.useQuery();

  const change = trpc.auth.changePasscode.useMutation({
    onSuccess: () => {
      toast.success("パスコードを変更しました");
      setCurrent("");
      setNext("");
      setConfirm("");
      utils.auth.usingDefaultPasscode.invalidate();
    },
    onError: err => toast.error(err.message),
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const invalidNext = next.length > 0 && !PASSCODE_PATTERN.test(next);
  const canSubmit =
    PASSCODE_PATTERN.test(current) &&
    PASSCODE_PATTERN.test(next) &&
    next === confirm &&
    !change.isPending;

  const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <KeyRound className="h-4 w-4" />
          パスコード
        </CardTitle>
        <CardDescription>
          このパスコードを知っている人だけがアクセスできます。4〜6 桁の数字で設定してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {usingDefault.data === true ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <ShieldAlert className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive leading-relaxed">
              初期パスコード（1010）のままです。資産情報を保護するため、必ず変更してください。
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="current-passcode">現在のパスコード</Label>
            <Input
              id="current-passcode"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={current}
              onChange={e => setCurrent(onlyDigits(e.target.value))}
              placeholder="••••"
              className="font-mono tracking-widest"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-passcode">新しいパスコード</Label>
            <Input
              id="new-passcode"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={next}
              onChange={e => setNext(onlyDigits(e.target.value))}
              placeholder="••••"
              className="font-mono tracking-widest"
              aria-invalid={invalidNext}
            />
            {invalidNext ? (
              <p className="text-xs text-destructive">4〜6 桁の数字で入力してください</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-passcode">新しいパスコード（確認）</Label>
            <Input
              id="confirm-passcode"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(onlyDigits(e.target.value))}
              placeholder="••••"
              className="font-mono tracking-widest"
              aria-invalid={mismatch}
            />
            {mismatch ? <p className="text-xs text-destructive">一致していません</p> : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 pt-1">
          <p className="text-xs text-muted-foreground leading-relaxed">
            連続 5 回間違えると 15 分間ロックされます。パスコードはハッシュ化して保存され、元の数字は保持されません。
          </p>
          <Button onClick={() => change.mutate({ current, next })} disabled={!canSubmit}>
            {change.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                変更中
              </>
            ) : (
              "パスコードを変更"
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
