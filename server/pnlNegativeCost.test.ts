/**
 * 取得原価がマイナスの銘柄の扱い。
 *
 * 富途香港で AMD を 150 株保有しているが、オプションのプレミアム受取が
 * 購入代金を上回ったため総取得原価が −5,773.16 ドル（1 株 −38.4877 ドル）になっている。
 * この状態で率を計算すると含み益 +82,931.66 に対して −1,436% となり、
 * 利益が出ているのに大きな損失として並んでしまう。
 *
 * 率は出さず「原価回収済み」と表示する方針（利用者合意済み）が
 * 実装で守られていることを検証する。
 */
import { describe, expect, it } from "vitest";
import { calcPnlPct, isCostRecovered, pnlLabel } from "../shared/pnlLabel";

describe("取得原価がマイナスの銘柄の損益率", () => {
  /** 富途香港の AMD の実データ */
  const AMD = {
    quantity: 150,
    currentPrice: 514.39,
    avgCost: -38.4877,
    reportedPnl: 82931.66,
  };

  it("実データで市場価値と原価の整合が取れる", () => {
    const marketValue = AMD.quantity * AMD.currentPrice;
    const costValue = AMD.quantity * AMD.avgCost;
    // 画面表示の市值 77,158.50
    expect(marketValue).toBeCloseTo(77158.5, 2);
    // 逆算した総原価 −5,773.16
    expect(costValue).toBeCloseTo(-5773.155, 2);
    // 市值 − 原価 が画面の含み益と一致する
    expect(marketValue - costValue).toBeCloseTo(AMD.reportedPnl, 1);
  });

  it("原価がマイナスなら率を出さない", () => {
    const marketValue = AMD.quantity * AMD.currentPrice;
    const costValue = AMD.quantity * AMD.avgCost;
    const pnl = marketValue - costValue;
    expect(calcPnlPct(pnl, costValue)).toBeNull();
  });

  it("素朴に割ると符号が反転してしまうことを確認する（回帰防止）", () => {
    const costValue = AMD.quantity * AMD.avgCost;
    const pnl = AMD.quantity * AMD.currentPrice - costValue;
    // 含み益なのに率がマイナスになる。この値を画面に出してはいけない
    const naive = (pnl / costValue) * 100;
    expect(naive).toBeLessThan(-1000);
    expect(pnl).toBeGreaterThan(0);
  });

  it("原価が 0 でも率を出さない", () => {
    expect(calcPnlPct(1000, 0)).toBeNull();
  });

  it("損益額が未取得なら率も出ない", () => {
    expect(calcPnlPct(null, 10000)).toBeNull();
  });

  it("通常の銘柄は従来どおり率を出す", () => {
    // 富途香港の UNH: 90 株・現価 401.73・成本 277.508 → 画面表示 +44.76%
    const quantity = 90;
    const marketValue = quantity * 401.73;
    const costValue = quantity * 277.508;
    const pct = calcPnlPct(marketValue - costValue, costValue);
    expect(pct).not.toBeNull();
    expect(pct!).toBeCloseTo(44.76, 1);
  });

  it("原価回収済みの判定は原価がマイナスのときだけ true", () => {
    expect(isCostRecovered(-5773.16)).toBe(true);
    expect(isCostRecovered(0)).toBe(false);
    expect(isCostRecovered(10000)).toBe(false);
    expect(isCostRecovered(null)).toBe(false);
    expect(isCostRecovered(undefined)).toBe(false);
  });

  it("率が出せない場合のラベルは「含み損益」になる（含み損と誤読させない）", () => {
    // 率が null のとき「含み損」と出ると利益が出ているのに損失に見えてしまう
    expect(pnlLabel(null)).toBe("含み損益");
  });
});
