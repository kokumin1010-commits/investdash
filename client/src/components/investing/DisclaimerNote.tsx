import { Info } from "lucide-react";
import { DISCLAIMER } from "@shared/investing";
import { cn } from "@/lib/utils";

export function DisclaimerNote({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-lg border border-border/70 bg-muted/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground",
        className
      )}
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>{DISCLAIMER}</p>
    </div>
  );
}

