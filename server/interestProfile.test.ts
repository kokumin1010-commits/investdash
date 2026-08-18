/**
 * 関心のある産業の集計のテスト。
 *
 * ここが誤ると候補提案の出発点そのものがずれる。実データ（保有 112 銘柄・
 * ウォッチリスト 13 銘柄）で確認した分布を入力にして、期待どおりの
 * 順序と数字になるかを確かめる。
 */
import { describe, expect, it } from "vitest";
import {
  buildInterestClusters,
  findSectorGaps,
  type InterestInput,
} from "@shared/interestProfile";

function held(
  symbol: string,
  industry: string,
  sector: string,
  valueBase: number
): InterestInput {
  return { symbol, name: symbol, sector, industry, valueBase, fromWatchlist: false };
}

function watch(symbol: string, industry: string, sector: string): InterestInput {
  return { symbol, name: symbol, sector, industry, valueBase: null, fromWatchlist: true };
}

describe("buildInterestClusters", () => {
  it("ウォッチリストの銘柄を保有より強い関心として数える", () => {
    /*
     * 保有 2 銘柄の産業と、保有 1 + ウォッチ 1 の産業を比べる。
     * ウォッチが 2 倍で数えられるので後者（1 + 2 = 3）が上に来る。
     */
    const clusters = buildInterestClusters(
      [
        held("A", "Conglomerates", "Industrials", 100),
        held("B", "Conglomerates", "Industrials", 100),
        held("C", "Semiconductors", "Technology", 100),
        watch("TSM", "Semiconductors", "Technology"),
      ],
      1000
    );

    expect(clusters[0].industry).toBe("Semiconductors");
    expect(clusters[0].interestScore).toBe(3);
    expect(clusters[1].industry).toBe("Conglomerates");
    expect(clusters[1].interestScore).toBe(2);
  });

  it("実データの分布で半導体が最上位になる", () => {
    /*
     * 実測値: 保有 Semiconductors 7 銘柄・Conglomerates 7 銘柄、
     * ウォッチ Semiconductors 4 銘柄。
     * 半導体は 7 + 4*2 = 15、コングロマリットは 7 なので半導体が上。
     */
    const inputs: InterestInput[] = [
      ...["6963.T", "AMD", "INTC", "NVDA", "AVGO", "MRVL", "ALAB"].map(s =>
        held(s, "Semiconductors", "Technology", 1000)
      ),
      ...["4901.T", "8053.T", "8031.T", "2768.T", "8001.T", "8002.T", "8058.T"].map(s =>
        held(s, "Conglomerates", "Industrials", 2000)
      ),
      ...["TSM", "CRDO", "QCOM", "NXPI"].map(s => watch(s, "Semiconductors", "Technology")),
    ];

    const clusters = buildInterestClusters(inputs, 100000);
    expect(clusters[0].industry).toBe("Semiconductors");
    expect(clusters[0].heldCount).toBe(7);
    expect(clusters[0].watchCount).toBe(4);
    expect(clusters[0].interestScore).toBe(15);
  });

  it("保有 1 銘柄だけの産業は関心として扱わない", () => {
    /*
     * たまたま 1 つ持っているだけの産業を関心と扱うと、
     * 数十件が並んでどこに関心があるのか読めなくなる。
     */
    const clusters = buildInterestClusters(
      [
        held("A", "Airlines", "Industrials", 100),
        held("B", "Semiconductors", "Technology", 100),
        held("C", "Semiconductors", "Technology", 100),
      ],
      1000
    );

    expect(clusters.map(c => c.industry)).toEqual(["Semiconductors"]);
  });

  it("ウォッチリストにある産業は 1 銘柄でも関心として扱う", () => {
    /*
     * まだ買っていないのに登録してあるのは買う意思の表明なので、
     * 1 銘柄でも関心として残す。
     */
    const clusters = buildInterestClusters(
      [watch("VRT", "Electrical Equipment & Parts", "Industrials")],
      1000
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].industry).toBe("Electrical Equipment & Parts");
    expect(clusters[0].heldCount).toBe(0);
    expect(clusters[0].watchCount).toBe(1);
  });

  it("産業が取れていない銘柄は集計しない", () => {
    /*
     * 「未分類」としてまとめると、それが最大のクラスタになって
     * 提案の起点が「未分類を埋める」になってしまう。
     */
    const clusters = buildInterestClusters(
      [
        { symbol: "QQQ", name: "QQQ", sector: null, industry: null, valueBase: 999999, fromWatchlist: false },
        { symbol: "VOO", name: "VOO", sector: null, industry: "", valueBase: 999999, fromWatchlist: false },
        held("A", "Semiconductors", "Technology", 100),
        held("B", "Semiconductors", "Technology", 100),
      ],
      1000
    );

    expect(clusters.map(c => c.industry)).toEqual(["Semiconductors"]);
  });

  it("同じ銘柄が複数口座にあっても 1 銘柄として数える", () => {
    /*
     * トヨタは楽天・IBKR・富途香港の 3 口座にあるが、
     * 関心の強さとしては 1 銘柄。3 と数えると偏りが誇張される。
     */
    const clusters = buildInterestClusters(
      [
        held("7203.T", "Auto Manufacturers", "Consumer Cyclical", 100),
        held("7203.T", "Auto Manufacturers", "Consumer Cyclical", 200),
        held("7203.T", "Auto Manufacturers", "Consumer Cyclical", 300),
        held("TSLA", "Auto Manufacturers", "Consumer Cyclical", 400),
      ],
      2000
    );

    expect(clusters[0].heldCount).toBe(2);
    // 評価額は口座分をすべて足す（1,000 / 2,000 = 50%）
    expect(clusters[0].heldValueBase).toBe(1000);
    expect(clusters[0].weightPct).toBeCloseTo(50, 5);
  });
});

describe("findSectorGaps", () => {
  const ALL = [
    "Technology",
    "Financial Services",
    "Industrials",
    "Consumer Cyclical",
    "Healthcare",
    "Utilities",
    "Energy",
    "Real Estate",
    "Basic Materials",
    "Communication Services",
    "Consumer Defensive",
  ];

  it("持っていない業種を完全な穴として先に並べる", () => {
    const gaps = findSectorGaps(ALL, [
      { sector: "Technology", count: 20, pct: 30 },
      { sector: "Industrials", count: 17, pct: 14 },
      { sector: "Utilities", count: 1, pct: 1.2 },
    ]);

    // 完全な穴（0%）が先、その次に薄い Utilities
    expect(gaps[0].weightPct).toBe(0);
    expect(gaps[0].heldCount).toBe(0);
    const utilities = gaps.find(g => g.sector === "Utilities");
    expect(utilities?.heldCount).toBe(1);
    expect(utilities?.weightPct).toBeCloseTo(1.2, 5);
  });

  it("構成比が十分ある業種は穴に含めない", () => {
    const gaps = findSectorGaps(["Technology", "Industrials"], [
      { sector: "Technology", count: 20, pct: 30 },
      { sector: "Industrials", count: 17, pct: 14 },
    ]);

    expect(gaps).toHaveLength(0);
  });

  it("5% 未満の業種は薄いと判断する", () => {
    /*
     * 11 業種に均等配分すれば 1 業種 9% になるため、
     * その半分を下回るものは明らかに薄い。
     */
    const gaps = findSectorGaps(["Utilities", "Healthcare"], [
      { sector: "Utilities", count: 1, pct: 4.9 },
      { sector: "Healthcare", count: 8, pct: 5.1 },
    ]);

    expect(gaps.map(g => g.sector)).toEqual(["Utilities"]);
  });
});
