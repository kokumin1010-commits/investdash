import { describe, expect, it } from "vitest";
import { consolidateBrokerPositionRows } from "./services/importPositions";

type Row = {
  symbol: string;
  quantity: number | null;
  avgCost: number | null;
  confidence: number;
  existingQuantity: number | null;
  mode: "NEW" | "UPDATE" | "SKIP";
  name: string;
};

function row(input: Partial<Row> & Pick<Row, "symbol" | "quantity">): Row {
  return {
    symbol: input.symbol,
    quantity: input.quantity,
    avgCost: input.avgCost ?? 100,
    confidence: input.confidence ?? 95,
    existingQuantity: input.existingQuantity ?? null,
    mode: input.mode ?? "UPDATE",
    name: input.name ?? input.symbol,
  };
}

describe("consolidateBrokerPositionRows", () => {
  it("楽天の総数行と内訳行が重複したら既存総数と一致する行だけを採用する", () => {
    const total = row({
      symbol: "7203.T",
      quantity: 8100,
      avgCost: 2581.16,
      existingQuantity: 8100,
    });
    const lot = row({
      symbol: "7203.T",
      quantity: 7400,
      avgCost: 2555.46,
      existingQuantity: 8100,
    });

    const result = consolidateBrokerPositionRows(
      [total, lot],
      "rakuten_ispeed"
    );

    expect(result.rows).toEqual([total]);
    expect(result.warnings[0]).toContain("登録済み総数 8100");
  });

  it("楽天の完全重複は1行にまとめる", () => {
    const first = row({ symbol: "2267.T", quantity: 1800 });
    const duplicate = { ...first };

    const result = consolidateBrokerPositionRows(
      [first, duplicate],
      "rakuten_ispeed"
    );

    expect(result.rows).toEqual([first]);
    expect(result.warnings[0]).toContain("完全重複");
  });

  it("安全に総数を確定できない楽天重複は保存対象外にする", () => {
    const result = consolidateBrokerPositionRows(
      [
        row({ symbol: "7203.T", quantity: 700 }),
        row({ symbol: "7203.T", quantity: 7400 }),
      ],
      "rakuten_ispeed"
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].mode).toBe("SKIP");
    expect(result.warnings[0]).toContain("安全に確定できない");
  });

  it("楽天以外は入力順と重複を変更しない", () => {
    const rows = [
      row({ symbol: "PYPL", quantity: 88 }),
      row({ symbol: "PYPL", quantity: 268 }),
    ];

    expect(consolidateBrokerPositionRows(rows, "ibkr")).toEqual({
      rows,
      warnings: [],
    });
  });
});
