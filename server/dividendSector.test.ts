import { describe, expect, it } from "vitest";
import {
  buildSectorDividends,
  sectorLabelJa,
  UNCLASSIFIED_SECTOR,
} from "./services/dividendSector";
import type { SectorDividendInput } from "./services/dividendSector";

const item = (
  symbol: string,
  sector: string | null,
  annualIncomeBase: number | null,
  marketValueBase: number | null = 1_000_000,
): SectorDividendInput => ({ symbol, sector, annualIncomeBase, marketValueBase });

describe("業種別の配当内訳", () => {
  it("業種ごとに配当を合計し、金額の大きい順に並べる", () => {
    const r = buildSectorDividends([
      item("PRU", "Financial Services", 300_000),
      item("DBS", "Financial Services", 200_000),
      item("M44U", "Real Estate", 400_000),
      item("KHC", "Consumer Defensive", 100_000),
    ]);

    expect(r.rows.map(x => x.sector)).toEqual([
      "Financial Services",
      "Real Estate",
      "Consumer Defensive",
    ]);
    // 金融は 2 銘柄の合計 500,000 で、単独 400,000 の不動産より大きい
    expect(r.rows[0].annualIncomeBase).toBe(500_000);
    expect(r.rows[0].symbolCount).toBe(2);
    expect(r.rows[1].annualIncomeBase).toBe(400_000);
    expect(r.totalIncomeBase).toBe(1_000_000);
  });

  it("占有率が合計 100% になる", () => {
    const r = buildSectorDividends([
      item("A", "Technology", 250_000),
      item("B", "Energy", 750_000),
    ]);

    const sum = r.rows.reduce((acc, x) => acc + x.sharePct, 0);
    expect(sum).toBeCloseTo(100, 10);
    expect(r.rows[0].sharePct).toBeCloseTo(75, 10);
  });

  it("同一銘柄を複数口座で持つ場合、金額は足すが銘柄数は 1 と数える", () => {
    /*
     * 「年間いくら入るか」は株数の合計に比例するので金額は足す。
     * 一方「何銘柄から配当を得ているか」で同じ会社を 2 と数えると
     * 分散しているように見えてしまう。
     */
    const r = buildSectorDividends([
      item("U11.SI", "Financial Services", 100_000, 3_000_000),
      item("U11.SI", "Financial Services", 50_000, 1_500_000),
    ]);

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].annualIncomeBase).toBe(150_000);
    expect(r.rows[0].symbolCount).toBe(1);
    expect(r.rows[0].marketValueBase).toBe(4_500_000);
  });

  it("業種が取れない銘柄は未分類にまとめる", () => {
    // ETF（QQQ / VOO）は業種を持たないのが正しい状態
    const r = buildSectorDividends([
      item("VOO", null, 50_000),
      item("QQQ", "", 30_000),
      item("PRU", "Financial Services", 100_000),
    ]);

    const unclassified = r.rows.find(x => x.sector === UNCLASSIFIED_SECTOR)!;
    expect(unclassified.annualIncomeBase).toBe(80_000);
    expect(unclassified.symbolCount).toBe(2);
  });

  it("未分類は業種の依存度の判定から除く", () => {
    /*
     * ETF の配当が最大でも「ETF に依存している」という指摘は
     * 業種の偏りを表さないため、topSector には選ばない。
     */
    const r = buildSectorDividends([
      item("VOO", null, 900_000),
      item("PRU", "Financial Services", 100_000),
    ]);

    expect(r.topSector).toBe("Financial Services");
    expect(r.topSharePct).toBeCloseTo(10, 10);
  });

  it("無配・未取得の銘柄は業種の行に含めない", () => {
    /*
     * 無配銘柄の評価額を分母に入れると、その業種の配当利回りが
     * 実際に配当を出している銘柄の水準より低く出てしまう。
     */
    const r = buildSectorDividends([
      item("PAY", "Technology", 100_000, 2_000_000),
      item("NOPAY", "Technology", 0, 8_000_000),
      item("UNKNOWN", "Technology", null, 5_000_000),
    ]);

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].symbolCount).toBe(1);
    expect(r.rows[0].marketValueBase).toBe(2_000_000);
    // 100,000 / 2,000,000 = 5%。無配銘柄を含めると 0.67% に薄まってしまう
    expect(r.rows[0].yieldPct).toBeCloseTo(5, 10);
  });

  it("評価額が取れない場合は利回りを null にする（0 と混同しない）", () => {
    const r = buildSectorDividends([item("X", "Energy", 100_000, null)]);

    expect(r.rows[0].yieldPct).toBeNull();
    expect(r.rows[0].annualIncomeBase).toBe(100_000);
  });

  it("配当が 1 件も無ければ空の内訳を返す", () => {
    const r = buildSectorDividends([item("A", "Technology", 0), item("B", null, null)]);

    expect(r.rows).toEqual([]);
    expect(r.totalIncomeBase).toBe(0);
    expect(r.topSector).toBeNull();
    expect(r.topSharePct).toBeNull();
  });

  it("業種名を日本語にする。未知の業種は英語のまま出す", () => {
    expect(sectorLabelJa("Financial Services")).toBe("金融");
    expect(sectorLabelJa("Real Estate")).toBe("不動産");
    expect(sectorLabelJa("Consumer Defensive")).toBe("生活必需品");
    // 勝手に「その他」へ丸めると、新しい業種が来たときに気付けない
    expect(sectorLabelJa("Brand New Sector")).toBe("Brand New Sector");
    expect(sectorLabelJa(UNCLASSIFIED_SECTOR)).toBe(UNCLASSIFIED_SECTOR);
  });
});
