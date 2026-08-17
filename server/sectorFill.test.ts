import { describe, expect, it } from "vitest";
import { fillMissingSectors } from "./services/sectorFill";

/**
 * 同一銘柄のレコード間で業種を埋め合わせる処理の検証。
 *
 * 業種は企業プロファイル取得時にレコード単位で保存されるため、
 * 同じ銘柄を 2 口座で持つと片方だけ未取得のまま残ることがある。
 * 実データでは F34（ウィルマー）・D05（DBS）・7203.T（トヨタ）など
 * 8 件がこの状態になっていた。
 */

describe("同一銘柄の業種の埋め合わせ", () => {
  it("同じ銘柄の他レコードから業種を借りる", () => {
    const map = fillMissingSectors([
      { symbol: "F34.SI", sector: "Consumer Defensive", industry: "Farm Products" },
      { symbol: "F34.SI", sector: null, industry: null },
    ]);

    expect(map.get("F34.SI")).toEqual({
      sector: "Consumer Defensive",
      industry: "Farm Products",
    });
  });

  it("どのレコードにも業種が無い銘柄は含めない", () => {
    /*
     * ETF（QQQ / VOO）は個別企業ではなく指数連動の詰め合わせなので
     * 業種を持たない。無理に「その他」を割り当てると業種別の集計が歪む。
     */
    const map = fillMissingSectors([
      { symbol: "QQQ", sector: null, industry: null },
      { symbol: "VOO", sector: null, industry: null },
    ]);

    expect(map.has("QQQ")).toBe(false);
    expect(map.has("VOO")).toBe(false);
  });

  it("空文字は業種が入っているとみなさない", () => {
    const map = fillMissingSectors([
      { symbol: "D05.SI", sector: "", industry: "" },
      { symbol: "D05.SI", sector: "Financial Services", industry: "Banks" },
    ]);

    expect(map.get("D05.SI")?.sector).toBe("Financial Services");
  });

  it("業種はあるが業界（industry）が無い場合も扱える", () => {
    const map = fillMissingSectors([
      { symbol: "7203.T", sector: "Consumer Cyclical", industry: null },
    ]);

    expect(map.get("7203.T")).toEqual({ sector: "Consumer Cyclical", industry: null });
  });

  it("複数銘柄が混ざっても銘柄ごとに分かれる", () => {
    const map = fillMissingSectors([
      { symbol: "F34.SI", sector: null, industry: null },
      { symbol: "D05.SI", sector: "Financial Services", industry: "Banks" },
      { symbol: "F34.SI", sector: "Consumer Defensive", industry: null },
    ]);

    expect(map.get("F34.SI")?.sector).toBe("Consumer Defensive");
    expect(map.get("D05.SI")?.sector).toBe("Financial Services");
  });
});
