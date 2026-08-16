/**
 * 渣打銀行 シンガポール（SC Mobile Trading）の読み取り値と登録値を検証する。
 *
 * 実画面 4 枚から読み取った値が画面のセクション小計と整合するか、
 * 平均取得単価の逆算方法が妥当かをテストで固定しておく。
 * 原本データは docs/sc-sg-holdings-source.md にある。
 */
import { describe, expect, it } from "vitest";
import { BROKER_BASE_CURRENCY, BROKER_LABELS, BROKER_SHORT, BROKERS } from "../shared/investing";

/** 実画面から読み取った 10 銘柄。scripts/seed-sc-sg.mjs と同じ値 */
const ROWS = [
  { code: "3769", suffix: "JP", qty: 300, price: 10150.0, pl: 793628.01, plPct: 35.35 },
  { code: "7270", suffix: "JP", qty: 800, price: 2583.0, pl: -310468.8, plPct: -13.08, avgCostShown: 2965.92 },
  { code: "9449", suffix: "JP", qty: 400, price: 4343.0, pl: 561385.6, plPct: 47.89 },
  { code: "C38U", suffix: "SG", qty: 7300, price: 2.43, pl: 653.74, plPct: 3.84 },
  { code: "C6L", suffix: "SG", qty: 500, price: 7.05, pl: 325.24, plPct: 10.19 },
  { code: "CJLU", suffix: "SG", qty: 32000, price: 0.975, pl: 3230.56, plPct: 11.58 },
  { code: "D05", suffix: "SG", qty: 300, price: 75.53, pl: 8673.55, plPct: 62.24 },
  { code: "F34", suffix: "SG", qty: 27400, price: 3.75, pl: 20214.35, plPct: 24.56 },
  { code: "U11", suffix: "SG", qty: 1800, price: 41.8, pl: 2593.34, plPct: 3.58 },
  { code: "Z74", suffix: "SG", qty: 11100, price: 4.45, pl: 12000.33, plPct: 32.18 },
] as const;

/** 市場サフィックスから symbol・market・currency を決める（seed スクリプトと同じ規則） */
function resolve(suffix: string, code: string) {
  switch (suffix) {
    case "JP":
      return { symbol: `${code}.T`, market: "JP", currency: "JPY" };
    case "SG":
      return { symbol: `${code}.SI`, market: "SG", currency: "SGD" };
    case "US":
      return { symbol: code, market: "US", currency: "USD" };
    default:
      throw new Error(`未知のサフィックス: ${suffix}`);
  }
}

/** 平均取得単価: 表示があれば使い、なければ損益率から逆算する */
function avgCostOf(row: (typeof ROWS)[number]) {
  if ("avgCostShown" in row && row.avgCostShown !== undefined) return row.avgCostShown;
  return row.pl / (row.plPct / 100) / row.qty;
}

describe("渣打銀行の口座定義", () => {
  it("口座一覧に登録されている", () => {
    expect(BROKERS).toContain("sc_sg");
  });

  it("基軸通貨は SGD", () => {
    expect(BROKER_BASE_CURRENCY.sc_sg).toBe("SGD");
  });

  it("ラベルが設定されている", () => {
    expect(BROKER_LABELS.sc_sg).toBe("渣打銀行 シンガポール");
    expect(BROKER_SHORT.sc_sg).toBe("渣打");
  });
});

describe("渣打銀行の読み取り値", () => {
  it("10 銘柄（日本株 3・SGX 7）である", () => {
    expect(ROWS).toHaveLength(10);
    expect(ROWS.filter(r => r.suffix === "JP")).toHaveLength(3);
    expect(ROWS.filter(r => r.suffix === "SG")).toHaveLength(7);
  });

  it("symbol が重複しない", () => {
    const symbols = ROWS.map(r => resolve(r.suffix, r.code).symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it("日本株には .T、SGX 銘柄には .SI を付ける", () => {
    // サフィックスが無いと他口座の同一銘柄と合算されず株価取得も失敗する
    expect(resolve("JP", "7270").symbol).toBe("7270.T");
    expect(resolve("SG", "D05").symbol).toBe("D05.SI");
  });

  it("SGX の評価額の合計が画面のセクション小計と一致する", () => {
    const total = ROWS.filter(r => r.suffix === "SG").reduce((s, r) => s + r.price * r.qty, 0);
    // 画面表示: SGD 302,508.00
    expect(total).toBeCloseTo(302508.0, 2);
  });

  it("SGX の含み損益の合計が画面のセクション小計と一致する", () => {
    const total = ROWS.filter(r => r.suffix === "SG").reduce((s, r) => s + r.pl, 0);
    // 画面表示: SGD 47,691.11。セントまで一致するので読み取り漏れがない
    expect(total).toBeCloseTo(47691.11, 2);
  });

  it("東証の評価額と含み損益が画面の丸め表示と整合する", () => {
    const jp = ROWS.filter(r => r.suffix === "JP");
    const value = jp.reduce((s, r) => s + r.price * r.qty, 0);
    const pl = jp.reduce((s, r) => s + r.pl, 0);
    // 画面表示: JPY 6.85M / +JPY 1.04M（百万単位に丸められている）
    expect(value / 1_000_000).toBeCloseTo(6.85, 2);
    expect(pl / 1_000_000).toBeCloseTo(1.04, 2);
  });

  it("口座合計が画面表示と一致する（画面のレートで換算）", () => {
    // 画面が使っているレートは TSE 小計から逆算できる
    const jpyTotal = ROWS.filter(r => r.suffix === "JP").reduce((s, r) => s + r.price * r.qty, 0);
    const screenRate = jpyTotal / 54761.41;
    const sgdTotal = ROWS.filter(r => r.suffix === "SG").reduce((s, r) => s + r.price * r.qty, 0);
    expect(jpyTotal / screenRate + sgdTotal).toBeCloseTo(357269.41, 1);
    // 画面は前営業日レートを使っているため約 125.06 になる
    expect(screenRate).toBeCloseTo(125.06, 1);
  });
});

describe("平均取得単価の逆算", () => {
  it("損益率からの逆算が画面表示値に近い（SUBARU で検証）", () => {
    const subaru = ROWS.find(r => r.code === "7270")!;
    const byRate = subaru.pl / (subaru.plPct / 100) / subaru.qty;
    /*
     * 画面の Avg Price は 2,965.9200。逆算値は 2,967.0183 で誤差 0.037%。
     * 損益率が小数第 2 位までの表示なのでこの程度の差は原理的に残る。
     * 0.1% 以内であれば取得原価の記録として十分と判断している。
     */
    expect(Math.abs(byRate - 2965.92) / 2965.92).toBeLessThan(0.001);
    expect(byRate).toBeGreaterThan(2965);
    expect(byRate).toBeLessThan(2968);
  });

  it("現在値から求める方法より誤差が小さい", () => {
    const subaru = ROWS.find(r => r.code === "7270")!;
    const truth = 2965.92;
    const byRate = subaru.pl / (subaru.plPct / 100) / subaru.qty;
    const byPrice = (subaru.price * subaru.qty - subaru.pl) / subaru.qty;
    // 現在値は遅延かつ丸められているため誤差が大きくなる
    expect(Math.abs(byRate - truth)).toBeLessThan(Math.abs(byPrice - truth));
  });

  it("画面に Avg Price がある銘柄は逆算せず表示値を使う", () => {
    const subaru = ROWS.find(r => r.code === "7270")!;
    expect(avgCostOf(subaru)).toBe(2965.92);
  });

  it("すべての銘柄で平均単価が正の有限値になる", () => {
    for (const row of ROWS) {
      const avg = avgCostOf(row);
      expect(Number.isFinite(avg)).toBe(true);
      expect(avg).toBeGreaterThan(0);
    }
  });

  it("含み損の銘柄では平均単価が現在値を上回る", () => {
    const loss = ROWS.filter(r => r.pl < 0);
    expect(loss.length).toBeGreaterThan(0);
    for (const row of loss) {
      expect(avgCostOf(row)).toBeGreaterThan(row.price);
    }
  });

  it("含み益の銘柄では平均単価が現在値を下回る", () => {
    for (const row of ROWS.filter(r => r.pl > 0)) {
      expect(avgCostOf(row)).toBeLessThan(row.price);
    }
  });
});
