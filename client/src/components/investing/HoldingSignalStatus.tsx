import { cn } from "@/lib/utils";
import type { SignalAction } from "@shared/investing";
import { SignalBadge, SignalPlaceholder } from "./SignalBadge";

/**
 * 保有銘柄一覧に表示する主判断。
 *
 * wouldBuyNow は「未保有なら新規購入するか」という参考視点であり、
 * 現在の保有状態ではない。一覧では action だけを表示することで、
 * 実際に保有している銘柄を「未保有」と誤読させない。
 */
export function HoldingSignalStatus({
  action,
  className,
  surface,
}: {
  action?: SignalAction | null;
  className?: string;
  surface: "mobile" | "desktop";
}) {
  return (
    <span
      data-testid={`holding-signal-${surface}`}
      className="inline-flex max-w-full"
    >
      {action ? (
        <SignalBadge
          action={action}
          showLabel
          className={cn("max-w-full whitespace-nowrap", className)}
        />
      ) : (
        <SignalPlaceholder className={className} />
      )}
    </span>
  );
}
