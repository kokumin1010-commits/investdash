/**
 * ロック画面。パスコードが未入力・失効している場合に表示する。
 * 数字キーパッドと物理キーボードの両方に対応する。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Delete, Loader2, LockKeyhole } from "lucide-react";
import { usePasscode } from "@/contexts/PasscodeContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_LENGTH = 6;
const MIN_LENGTH = 4;

export default function PasscodeGate() {
  const { unlock } = usePasscode();
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);
  const submittingRef = useRef(false);

  const submit = useCallback(
    async (passcode: string) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      setError(null);
      try {
        // 万一サーバー応答が返らない場合でも操作不能にならないよう上限を設ける
        await Promise.race([
          unlock(passcode),
          new Promise<never>((_, reject) =>
            window.setTimeout(
              () => reject(new Error("応答がありません。通信状況を確認して再度お試しください。")),
              30_000
            )
          ),
        ]);
        // 成功時はこのコンポーネントがアンマウントされる
      } catch (err) {
        setError(err instanceof Error ? err.message : "解錠できませんでした");
        setDigits("");
        setShake(true);
        window.setTimeout(() => setShake(false), 400);
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [unlock]
  );

  const append = useCallback((digit: string) => {
    setError(null);
    setDigits(prev => (prev.length >= MAX_LENGTH ? prev : prev + digit));
  }, []);

  const backspace = useCallback(() => {
    setError(null);
    setDigits(prev => prev.slice(0, -1));
  }, []);

  // 物理キーボード対応
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        append(e.key);
      } else if (e.key === "Backspace") {
        backspace();
      } else if (e.key === "Enter" && digits.length >= MIN_LENGTH) {
        void submit(digits);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [append, backspace, digits, submit]);

  const canSubmit = digits.length >= MIN_LENGTH && !submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-4 overflow-auto">
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-14 w-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center">
            <LockKeyhole className="h-7 w-7" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">InvestDesk</h1>
            <p className="text-sm text-muted-foreground mt-1">パスコードを入力してください</p>
          </div>
        </div>

        {/* 入力インジケーター */}
        <div
          className={cn(
            "flex items-center justify-center gap-3 mb-3 transition-transform",
            shake && "animate-[shake_0.4s_ease-out]"
          )}
        >
          {Array.from({ length: MAX_LENGTH }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-3 w-3 rounded-full transition-all duration-150",
                i < digits.length ? "bg-primary scale-100" : "bg-border scale-90"
              )}
            />
          ))}
        </div>

        <div className="h-10 mb-2 flex items-start justify-center">
          {error ? (
            <p className="text-sm text-destructive text-center leading-snug">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground text-center">4〜6 桁の数字</p>
          )}
        </div>

        {/* キーパッド */}
        <div className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => (
            <KeypadButton key={n} onClick={() => append(n)} disabled={submitting}>
              {n}
            </KeypadButton>
          ))}
          <KeypadButton onClick={backspace} disabled={submitting || digits.length === 0} muted>
            <Delete className="h-5 w-5" />
          </KeypadButton>
          <KeypadButton onClick={() => append("0")} disabled={submitting}>
            0
          </KeypadButton>
          <KeypadButton
            onClick={() => void submit(digits)}
            disabled={!canSubmit}
            variant="primary"
          >
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "OK"}
          </KeypadButton>
        </div>

        <p className="mt-8 text-xs text-muted-foreground text-center leading-relaxed">
          本アプリの分析結果は情報提供であり、投資助言ではありません。
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}

function KeypadButton({
  children,
  onClick,
  disabled,
  variant = "default",
  muted,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary";
  muted?: boolean;
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      variant={variant === "primary" ? "default" : "outline"}
      className={cn(
        "h-16 text-xl font-medium rounded-xl transition-transform active:scale-[0.97]",
        variant === "default" && !muted && "bg-card hover:bg-accent",
        muted && "bg-transparent border-transparent hover:bg-accent"
      )}
      style={{ transitionDuration: "160ms", transitionTimingFunction: "cubic-bezier(0.23,1,0.32,1)" }}
    >
      {children}
    </Button>
  );
}
