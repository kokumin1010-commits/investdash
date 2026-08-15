import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SIGNAL_LABELS, SIGNAL_STYLES, type SignalAction } from "@shared/investing";

export function SignalBadge({
  action,
  showLabel = false,
  className,
}: {
  action: SignalAction;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-semibold tracking-wide border",
        SIGNAL_STYLES[action],
        className
      )}
    >
      {action}
      {showLabel ? <span className="ml-1.5 font-normal">{SIGNAL_LABELS[action]}</span> : null}
    </Badge>
  );
}

export function SignalPlaceholder({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "border-dashed text-muted-foreground font-normal cursor-help",
            className
          )}
        >
          未生成
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px]">
        まだ AI 分析を実行していません。「AI分析」ボタンを押すとシグナルが生成されます。
      </TooltipContent>
    </Tooltip>
  );
}
