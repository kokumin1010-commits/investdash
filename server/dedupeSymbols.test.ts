import { describe, expect, it } from "vitest";

/**
 * 同一銘柄を複数の証券口座で保有している場合の重複排除ロジック。
 *
 * 株価取得・ニュース取得・AI 分析はいずれも「銘柄単位」の処理なので、
 * 口座ごとに実行すると外部 API と AI 利用枠を無駄に消費する。
 * 実装（portfolio.ts / routers/portfolio.ts）と同じ手順を検証する。
 */

type Row = { id: number; symbol: string; broker: string; name: string };

const ROWS: Row[] = [
  { id: 1, symbol: "2267.T", broker: "moomoo_jp", name: "ヤクルト本社" },
  { id: 2, symbol: "2267.T", broker: "rakuten_ispeed", name: "ヤクルト本社" },
  { id: 3, symbol: "3436.T", broker: "moomoo_jp", name: "SUMCO" },
  { id: 4, symbol: "3436.T", broker: "rakuten_ispeed", name: "SUMCO" },
  { id: 5, symbol: "6920.T", broker: "moomoo_jp", name: "レーザーテック" },
];

/** 株価取得: シンボルの Set で重複を排除する */
function priceSymbols(rows: Row[], watch: { symbol: string }[] = []): string[] {
  return Array.from(new Set([...rows.map(r => r.symbol), ...watch.map(w => w.symbol)]));
}

/** AI 分析 / ニュース: シンボルごとに先頭 1 件を代表にする */
function representatives(rows: Row[]): Row[] {
  const bySymbol = new Map<string, Row>();
  for (const r of rows) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, r);
  }
  return Array.from(bySymbol.values());
}

describe("複数口座保有時の重複排除", () => {
  it("株価取得は銘柄数ぶんだけリクエストする", () => {
    // 5 レコードあるが銘柄は 3 種類
    expect(priceSymbols(ROWS)).toEqual(["2267.T", "3436.T", "6920.T"]);
  });

  it("ウォッチリストと保有が重複しても 1 回にまとまる", () => {
    const symbols = priceSymbols(ROWS, [{ symbol: "6920.T" }, { symbol: "7203.T" }]);
    expect(symbols).toEqual(["2267.T", "3436.T", "6920.T", "7203.T"]);
  });

  it("AI 分析の対象は銘柄ごとに 1 件になる", () => {
    const targets = representatives(ROWS);
    expect(targets).toHaveLength(3);
    expect(targets.map(t => t.symbol)).toEqual(["2267.T", "3436.T", "6920.T"]);
  });

  it("代表は最初に現れたレコード（一覧の並び順の先頭）になる", () => {
    const targets = representatives(ROWS);
    expect(targets[0].id).toBe(1);
    expect(targets[1].id).toBe(3);
  });

  it("重複がなければ件数は変わらない", () => {
    const single: Row[] = [{ id: 9, symbol: "8604.T", broker: "moomoo_jp", name: "野村" }];
    expect(representatives(single)).toHaveLength(1);
    expect(priceSymbols(single)).toEqual(["8604.T"]);
  });

  it("空でも落ちない", () => {
    expect(representatives([])).toEqual([]);
    expect(priceSymbols([])).toEqual([]);
  });

  it("38 レコード・33 銘柄の実データ構成では 33 件の分析になる", () => {
    // 実際の登録状況: moomoo 27 + 楽天 11 = 38 レコード、重複 5 銘柄 → 33 銘柄
    const rows: Row[] = [];
    for (let i = 0; i < 27; i += 1) {
      rows.push({ id: i + 1, symbol: `M${i}.T`, broker: "moomoo_jp", name: `m${i}` });
    }
    // 楽天 11 件のうち 5 件は moomoo と同じ銘柄
    for (let i = 0; i < 5; i += 1) {
      rows.push({ id: 100 + i, symbol: `M${i}.T`, broker: "rakuten_ispeed", name: `m${i}` });
    }
    for (let i = 0; i < 6; i += 1) {
      rows.push({ id: 200 + i, symbol: `R${i}.T`, broker: "rakuten_ispeed", name: `r${i}` });
    }
    expect(rows).toHaveLength(38);
    expect(representatives(rows)).toHaveLength(33);
  });
});
