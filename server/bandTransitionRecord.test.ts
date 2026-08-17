import { describe, expect, it } from "vitest";
import { classifyTransition, hasStateChanged } from "../shared/bandTransition";
import type { BandState } from "../shared/bandTransition";

/**
 * 記録処理のふるまいを、DB を使わずに検証する。
 *
 * recordTransitions は「前回の記録」と「今の判定」を比べて
 * 変化した銘柄だけ insert する。その判断部分を再現して確かめる。
 */
type Overview = {
  symbol: string;
  action: BandState["action"];
  actionLabel: string | null;
  outsideDirection: BandState["outsideDirection"];
  currentPrice: number | null;
};

type LastRecord = {
  symbol: string;
  toAction: BandState["action"];
  toLabel: string | null;
  outsideDirection: BandState["outsideDirection"];
  price: number | null;
};

/** サービス層と同じ手順で「記録すべき銘柄」を選ぶ */
function selectChanges(overview: Overview[], lastRecords: LastRecord[]) {
  const lastBySymbol = new Map(lastRecords.map(r => [r.symbol, r]));
  const out: {
    symbol: string;
    importance: string;
    priceChangePct: number | null;
  }[] = [];

  for (const row of overview) {
    const last = lastBySymbol.get(row.symbol) ?? null;
    const prev: BandState | null = last
      ? { action: last.toAction, label: last.toLabel, outsideDirection: last.outsideDirection }
      : null;
    const next: BandState = {
      action: row.action,
      label: row.actionLabel,
      outsideDirection: row.outsideDirection,
    };
    if (!hasStateChanged(prev, next)) continue;

    const lastPrice = last?.price ?? null;
    const priceChangePct =
      lastPrice !== null && lastPrice > 0 && row.currentPrice !== null
        ? ((row.currentPrice - lastPrice) / lastPrice) * 100
        : null;

    out.push({
      symbol: row.symbol,
      importance: classifyTransition(prev, next),
      priceChangePct,
    });
  }
  return out;
}

describe("判定変化の記録の選別", () => {
  it("初回はすべての銘柄を記録する（比較の基準がないため）", () => {
    const changes = selectChanges(
      [
        { symbol: "NKE", action: "ADD_SMALL", actionLabel: "打診買い", outsideDirection: null, currentPrice: 40.73 },
        { symbol: "MRVL", action: "HOLD", actionLabel: "静観", outsideDirection: null, currentPrice: 222 },
      ],
      [],
    );

    expect(changes.map(c => c.symbol)).toEqual(["NKE", "MRVL"]);
    // 前回の株価がないので変化率は出さない（0% と混同しない）
    expect(changes[0].priceChangePct).toBeNull();
  });

  it("同じ判定のままなら記録しない", () => {
    const changes = selectChanges(
      [{ symbol: "MRVL", action: "HOLD", actionLabel: "静観・保有継続", outsideDirection: null, currentPrice: 250 }],
      [{ symbol: "MRVL", toAction: "HOLD", toLabel: "静観・保有継続", outsideDirection: null, price: 222 }],
    );

    // 静観の帯の中で $222 → $250 に動いてもとるべき行動は変わらない
    expect(changes).toEqual([]);
  });

  it("判定が変わったら前回の株価からの変化率を添える", () => {
    const changes = selectChanges(
      [{ symbol: "NKE", action: "ADD_SMALL", actionLabel: "打診買い", outsideDirection: null, currentPrice: 40 }],
      [{ symbol: "NKE", toAction: "HOLD", toLabel: "静観", outsideDirection: null, price: 50 }],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].importance).toBe("HIGH");
    // 50 → 40 は -20%
    expect(changes[0].priceChangePct).toBeCloseTo(-20, 10);
  });

  it("株価が取れない銘柄でも判定の変化は記録する", () => {
    /*
     * 株価が取れないこと自体は判定の変化とは別問題。
     * 記録を落とすと、次に取れたときの比較の基準が古いままになる。
     */
    const changes = selectChanges(
      [{ symbol: "X", action: "ADD_MAIN", actionLabel: "主力買い増し", outsideDirection: null, currentPrice: null }],
      [{ symbol: "X", toAction: "HOLD", toLabel: "静観", outsideDirection: null, price: 100 }],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].priceChangePct).toBeNull();
  });

  it("帯の外に出入りした場合も記録する", () => {
    const changes = selectChanges(
      [{ symbol: "A", action: null, actionLabel: null, outsideDirection: "BELOW", currentPrice: 10 }],
      [{ symbol: "A", toAction: null, toLabel: null, outsideDirection: "ABOVE", price: 100 }],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].priceChangePct).toBeCloseTo(-90, 10);
  });
});
