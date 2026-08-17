import { describe, expect, it } from "vitest";
import { heldPnlPct, mergeHeldPositions } from "../shared/heldMerge";

describe("保有の畳み込み", () => {
  it("同じ銘柄を複数口座で持っている場合は株数を合算する", () => {
    const m = mergeHeldPositions([
      { symbol: "2267.T", quantity: 700, avgCost: 3000, broker: "moomoo_jp" },
      { symbol: "2267.T", quantity: 7400, avgCost: 2500, broker: "rakuten_ispeed" },
    ]);
    expect(m.get("2267.T")!.quantity).toBe(8100);
    expect(m.get("2267.T")!.brokers).toEqual(["moomoo_jp", "rakuten_ispeed"]);
  });

  it("取得単価は株数で重み付けする（単純平均だと少額口座が過大に効く）", () => {
    const m = mergeHeldPositions([
      { symbol: "X", quantity: 100, avgCost: 1000, broker: "a" },
      { symbol: "X", quantity: 900, avgCost: 2000, broker: "b" },
    ]);
    // 単純平均なら 1500 だが、株数で重み付けすると 1900
    expect(m.get("X")!.avgCost).toBe(1900);
  });

  it("同じ口座が複数レコードでも口座名は重複させない", () => {
    const m = mergeHeldPositions([
      { symbol: "X", quantity: 10, avgCost: 100, broker: "ibkr" },
      { symbol: "X", quantity: 10, avgCost: 100, broker: "ibkr" },
    ]);
    expect(m.get("X")!.brokers).toEqual(["ibkr"]);
  });

  it("保有が無ければ空で返す", () => {
    expect(mergeHeldPositions([]).size).toBe(0);
  });
});

describe("保有銘柄の損益率", () => {
  it("取得単価を上回っていれば正の値を返す", () => {
    expect(heldPnlPct(100, 120)).toBeCloseTo(20, 6);
  });

  it("取得原価が 0 以下なら率を出さない（原価回収済みは率で比較できない）", () => {
    expect(heldPnlPct(0, 120)).toBeNull();
    expect(heldPnlPct(-5, 120)).toBeNull();
  });

  it("株価が無ければ率を出さない", () => {
    expect(heldPnlPct(100, null)).toBeNull();
  });
});

