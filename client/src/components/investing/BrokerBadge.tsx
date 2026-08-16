import { brokerLabel, brokerShort, brokerStyle } from "@shared/investing";
import { cn } from "@/lib/utils";

type Props = {
  broker?: string | null;
  /** 短縮表記（moomoo / 楽天 / 富途）にする */
  short?: boolean;
  className?: string;
};

/**
 * どの証券プラットフォームで保有しているかを示すバッジ。
 * 一覧をざっと眺めたときに口座の違いが色で判別できるよう、各社のブランドカラーに寄せている。
 * 色は shared/investing.ts の BROKER_STYLES を単一の出典とし、
 * 表の縦線や円グラフ（BROKER_HEX）と同じ色相で揃えている。
 */
export function BrokerBadge({ broker, short = false, className }: Props) {
  const label = short ? brokerShort(broker) : brokerLabel(broker);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        brokerStyle(broker),
        className
      )}
      title={brokerLabel(broker)}
    >
      {label}
    </span>
  );
}
