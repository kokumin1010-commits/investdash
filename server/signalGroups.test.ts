import { describe, expect, it } from "vitest";
import { groupBySignal, pickDefaultSignal } from "../shared/signalGroups";
import type { SignalGroupItem } from "../shared/signalGroups";

const item = (
  symbol: string,
  signalAction: SignalGroupItem["signalAction"],
  marketValueBase: number | null,
): SignalGroupItem => ({ symbol, signalAction, marketValueBase });

describe("シグナル別の銘柄一覧", () => {
  it("シグナルごとにまとめ、評価額の大きい順に並べる", () => {
    const r = groupBySignal([
      item("SMALL", "ADD", 200_000),
      item("BIG", "ADD", 20_000_000),
      item("MID", "ADD", 5_000_000),
      item("HELD", "HOLD", 999_999_999),
    ]);

    expect(r.get("ADD")!.map(x => x.symbol)).toEqual(["BIG", "MID", "SMALL"]);
    // 別のシグナルの銘柄は混ざらない
    expect(r.get("HOLD")!.map(x => x.symbol)).toEqual(["HELD"]);
  });

  it("シグナルが無い銘柄は含めない", () => {
    const r = groupBySignal([item("NOSIG", null, 10_000_000), item("A", "ADD", 1)]);

    expect([...r.keys()]).toEqual(["ADD"]);
    expect(r.get("ADD")!.map(x => x.symbol)).toEqual(["A"]);
  });

  it("評価額が取れていない銘柄は金額のある銘柄より後ろに置く", () => {
    const r = groupBySignal([item("UNKNOWN", "ADD", null), item("KNOWN", "ADD", 100)]);

    expect(r.get("ADD")!.map(x => x.symbol)).toEqual(["KNOWN", "UNKNOWN"]);
  });

  it("最初に開くのは判断が必要なシグナル（件数の多さでは決めない）", () => {
    /*
     * HOLD が 42 件で一番多くても、静観を既定にすると
     * 何もしなくてよい銘柄が最初に出てしまう。
     */
    const bySignal = new Map<string, unknown[]>([
      ["HOLD", new Array(42).fill(0)],
      ["WATCH", new Array(40).fill(0)],
      ["ADD", new Array(25).fill(0)],
    ]) as Map<never, unknown[]>;

    expect(pickDefaultSignal(bySignal)).toBe("ADD");
  });

  it("ADD が無ければ REDUCE、次に EXIT を優先する", () => {
    const only = (key: string) =>
      new Map<string, unknown[]>([[key, [0]], ["HOLD", [0, 0, 0]]]) as Map<never, unknown[]>;

    expect(pickDefaultSignal(only("REDUCE"))).toBe("REDUCE");
    expect(pickDefaultSignal(only("EXIT"))).toBe("EXIT");
    expect(pickDefaultSignal(only("WATCH"))).toBe("WATCH");
  });

  it("何もなければ null を返す", () => {
    expect(pickDefaultSignal(new Map())).toBeNull();
  });
});

