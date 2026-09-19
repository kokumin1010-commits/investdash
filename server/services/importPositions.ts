import type { BrokerFormatId } from "./brokerFormats";

type ImportPositionRow = {
  symbol: string;
  quantity: number | null;
  avgCost: number | null;
  confidence: number;
  existingQuantity: number | null;
  mode: "NEW" | "UPDATE" | "SKIP";
};

export function consolidateBrokerPositionRows<T extends ImportPositionRow>(
  rows: T[],
  formatId?: BrokerFormatId | null
): { rows: T[]; warnings: string[] } {
  if (formatId !== "rakuten_ispeed") return { rows, warnings: [] };

  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(row.symbol) ?? [];
    group.push(row);
    groups.set(row.symbol, group);
  }

  const emitted = new Set<string>();
  const consolidated: T[] = [];
  const warnings: string[] = [];

  for (const row of rows) {
    if (emitted.has(row.symbol)) continue;
    emitted.add(row.symbol);
    const group = groups.get(row.symbol) ?? [row];
    if (group.length === 1) {
      consolidated.push(row);
      continue;
    }

    const existingQuantity = group.find(
      candidate => candidate.existingQuantity !== null
    )?.existingQuantity;
    const matchingExisting =
      existingQuantity === null || existingQuantity === undefined
        ? []
        : group.filter(candidate => candidate.quantity === existingQuantity);

    if (matchingExisting.length > 0) {
      const selected = [...matchingExisting].sort(
        (a, b) => b.confidence - a.confidence
      )[0];
      consolidated.push(selected);
      warnings.push(
        `${row.symbol} は同一銘柄の重複 ${group.length} 行から、登録済み総数 ${existingQuantity} と一致する行だけを採用しました`
      );
      continue;
    }

    const uniqueByPosition = new Map<string, T>();
    for (const candidate of group) {
      const key = `${candidate.quantity ?? "?"}:${candidate.avgCost ?? "?"}`;
      const prior = uniqueByPosition.get(key);
      if (!prior || candidate.confidence > prior.confidence) {
        uniqueByPosition.set(key, candidate);
      }
    }
    const uniqueRows = Array.from(uniqueByPosition.values());
    if (uniqueRows.length === 1) {
      consolidated.push(uniqueRows[0]);
      warnings.push(
        `${row.symbol} の完全重複 ${group.length} 行を1行にまとめました`
      );
      continue;
    }

    const lotQuantityTotal = uniqueRows.reduce(
      (sum, candidate) => sum + (candidate.quantity ?? 0),
      0
    );
    const canMergeLots =
      existingQuantity !== null &&
      existingQuantity !== undefined &&
      existingQuantity > 0 &&
      Math.abs(lotQuantityTotal - existingQuantity) < 1e-9 &&
      uniqueRows.every(
        candidate =>
          candidate.quantity !== null &&
          candidate.quantity > 0 &&
          candidate.avgCost !== null &&
          Number.isFinite(candidate.avgCost)
      );
    if (canMergeLots) {
      const weightedAvgCost =
        uniqueRows.reduce(
          (sum, candidate) =>
            sum + (candidate.quantity ?? 0) * (candidate.avgCost ?? 0),
          0
        ) / existingQuantity;
      const representative = [...uniqueRows].sort(
        (a, b) => b.confidence - a.confidence
      )[0];
      consolidated.push({
        ...representative,
        quantity: existingQuantity,
        avgCost: Number(weightedAvgCost.toFixed(4)),
        confidence: Math.min(
          ...uniqueRows.map(candidate => candidate.confidence)
        ),
        mode: "UPDATE",
      } as T);
      warnings.push(
        `${row.symbol} は分割表示 ${uniqueRows.length} 行の合計が登録済み総数 ${existingQuantity} と一致したため、取得単価を加重平均して1行にまとめました`
      );
      continue;
    }

    const largest = [...uniqueRows]
      .filter(candidate => candidate.quantity !== null)
      .sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))[0];
    const othersTotal = uniqueRows
      .filter(candidate => candidate !== largest)
      .reduce((sum, candidate) => sum + (candidate.quantity ?? 0), 0);
    if (
      largest?.quantity !== null &&
      largest.quantity > 0 &&
      othersTotal > 0 &&
      Math.abs(largest.quantity - othersTotal) < 1e-9
    ) {
      consolidated.push(largest);
      warnings.push(
        `${row.symbol} は内訳合計と一致する総数行だけを採用しました`
      );
      continue;
    }

    consolidated.push({ ...row, mode: "SKIP" } as T);
    warnings.push(
      `${row.symbol} は重複行の総数を安全に確定できないため保存対象外にしました`
    );
  }

  return { rows: consolidated, warnings };
}
