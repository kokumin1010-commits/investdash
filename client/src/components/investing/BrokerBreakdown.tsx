import { BrokerBadge } from "@/components/investing/BrokerBadge";
import { MoneyText, PctText, PnlText } from "@/components/investing/Figures";
import { formatNumber, type Broker } from "@shared/investing";

/**
 * 同一銘柄を複数の証券口座で保有している場合の内訳。
 *
 * 合計だけでは「どちらの口座の買いが儲かっているか」が分からないため、
 * 口座ごとの株数・取得単価・損益を並べる。
 */
export type BreakdownEntry = {
  id: number;
  broker: Broker;
  quantity: number;
  avgCost: number;
  pnl: number | null;
  pnlPct: number | null;
  currency: string;
};

export function BrokerBreakdown({
  entries,
  onEdit,
  onDelete,
  compact = false,
}: {
  entries: BreakdownEntry[];
  onEdit?: (id: number) => void;
  onDelete?: (id: number) => void;
  compact?: boolean;
}) {
  // 1 口座しかない銘柄では内訳を出す意味がない
  if (entries.length <= 1) return null;

  return (
    <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2">
      <p className="text-[10px] font-medium text-muted-foreground">
        口座別の内訳（口座ごとの評価損益）
      </p>
      {entries.map(e => (
        <div
          key={e.id}
          /**
           * スマホ幅（375px 前後）では株数・単価・損益・操作を 1 行に収めると
           * 文字が重なってしまうため、2 段に分けて折り返す。
           */
          className="space-y-0.5 border-b border-border/40 pb-1.5 last:border-0 last:pb-0"
          data-testid="breakdown-row"
        >
          {/* 1 段目: 口座と損益 */}
          <div className="flex items-center justify-between gap-2">
            <BrokerBadge broker={e.broker} short />
            <div className="flex shrink-0 items-baseline gap-1.5">
              <PnlText value={e.pnl} currency={e.currency} compact className="text-[11px]" />
              <span className="text-[10px]">
                <PctText value={e.pnlPct} />
              </span>
            </div>
          </div>
          {/* 2 段目: 株数・取得単価と操作 */}
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="tabular truncate">
              {formatNumber(e.quantity, 0)}株 @{" "}
              <MoneyText value={e.avgCost} currency={e.currency} className="tabular" />
            </span>
            {!compact && (onEdit || onDelete) ? (
              <span className="flex shrink-0 items-center gap-2">
                {onEdit ? (
                  <button
                    type="button"
                    className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
                    onClick={() => onEdit(e.id)}
                  >
                    編集
                  </button>
                ) : null}
                {onDelete ? (
                  <button
                    type="button"
                    className="underline-offset-2 transition-colors hover:text-destructive hover:underline"
                    onClick={() => onDelete(e.id)}
                  >
                    削除
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
