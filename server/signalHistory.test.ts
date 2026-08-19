import { describe, expect, it } from "vitest";
import {
  buildSignalHistory,
  changePointsOnly,
  dedupeSignals,
  type SignalHistoryInput,
} from "../shared/signalHistory";

/** 新しい順の履歴を作る簡易ヘルパー */
function sig(
  id: number,
  action: string,
  price: number | null,
  iso: string,
  confidence: number | null = 70
): SignalHistoryInput {
  return {
    id,
    action,
    confidence,
    rationale: `${action} の理由`,
    priceAtSignal: price,
    createdAt: new Date(iso),
  };
}

describe("dedupeSignals", () => {
  it("同じ判定・同じ分の記録は 1 件に畳む", () => {
    // 実データで観測: 8/18 22:46 に同じ ADD が 2 件入っていた
    const rows = [
      sig(1, "ADD", 5655, "2026-08-18T22:46:10"),
      sig(2, "ADD", 5655, "2026-08-18T22:46:40"),
    ];
    expect(dedupeSignals(rows)).toHaveLength(1);
  });

  it("判定が違えば同じ分でも残す", () => {
    const rows = [
      sig(1, "ADD", 5655, "2026-08-18T22:46:10"),
      sig(2, "HOLD", 5655, "2026-08-18T22:46:40"),
    ];
    expect(dedupeSignals(rows)).toHaveLength(2);
  });

  it("株価が違えば残す（同じ判定でも別の局面の判断のため）", () => {
    const rows = [
      sig(1, "HOLD", 5600, "2026-08-17T22:37:00"),
      sig(2, "HOLD", 5684, "2026-08-17T22:37:30"),
    ];
    expect(dedupeSignals(rows)).toHaveLength(2);
  });

  it("分が違えば残す", () => {
    const rows = [
      sig(1, "HOLD", 5684, "2026-08-16T22:24:00"),
      sig(2, "HOLD", 5684, "2026-08-16T22:23:00"),
    ];
    expect(dedupeSignals(rows)).toHaveLength(2);
  });
});

describe("buildSignalHistory", () => {
  it("1 つ前の判定を付け、変化した記録に印を立てる", () => {
    const rows = [
      sig(3, "ADD", 5423, "2026-08-19T19:49:00"),
      sig(2, "HOLD", 5600, "2026-08-17T22:37:00"),
      sig(1, "WATCH", 5684, "2026-08-15T15:55:00"),
    ];
    const built = buildSignalHistory(rows, 5423);
    expect(built[0].prevAction).toBe("HOLD");
    expect(built[0].changed).toBe(true);
    expect(built[1].prevAction).toBe("WATCH");
    expect(built[1].changed).toBe(true);
    // 最古の記録は比較対象がないので変化と見なさない
    expect(built[2].prevAction).toBeNull();
    expect(built[2].changed).toBe(false);
  });

  it("判定が変わっていない記録は changed が false", () => {
    const rows = [
      sig(2, "HOLD", 5600, "2026-08-17T22:37:00"),
      sig(1, "HOLD", 5684, "2026-08-15T22:21:00"),
    ];
    const built = buildSignalHistory(rows, 5423);
    expect(built[0].changed).toBe(false);
  });

  it("当時株価から今までの変化率を出す", () => {
    const rows = [sig(1, "HOLD", 5000, "2026-08-15T22:21:00")];
    const built = buildSignalHistory(rows, 5500);
    expect(built[0].priceChangePct).toBeCloseTo(10, 6);
  });

  it("当時株価が下がっている場合は負の変化率になる", () => {
    const rows = [sig(1, "HOLD", 5655, "2026-08-18T22:46:00")];
    const built = buildSignalHistory(rows, 5423);
    expect(built[0].priceChangePct).toBeCloseTo(((5423 - 5655) / 5655) * 100, 6);
    expect(built[0].priceChangePct! < 0).toBe(true);
  });

  it("当時株価が無い記録は変化率を出さない（0% と出すと動いていないと誤解される）", () => {
    const rows = [sig(1, "HOLD", null, "2026-08-15T22:21:00")];
    expect(buildSignalHistory(rows, 5423)[0].priceChangePct).toBeNull();
  });

  it("今の株価が取れていない場合も変化率を出さない", () => {
    const rows = [sig(1, "HOLD", 5000, "2026-08-15T22:21:00")];
    expect(buildSignalHistory(rows, null)[0].priceChangePct).toBeNull();
  });

  it("当時株価が 0 の場合は割り算をしない", () => {
    const rows = [sig(1, "HOLD", 0, "2026-08-15T22:21:00")];
    expect(buildSignalHistory(rows, 5423)[0].priceChangePct).toBeNull();
  });

  it("文字列で来た株価も扱える（DB の decimal は文字列で返る）", () => {
    const rows: SignalHistoryInput[] = [
      { ...sig(1, "HOLD", null, "2026-08-15T22:21:00"), priceAtSignal: "5000.0000" },
    ];
    expect(buildSignalHistory(rows, 5500)[0].priceChangePct).toBeCloseTo(10, 6);
  });

  it("重複を除いた後に前後関係を付ける（重複が挟まると変化を取り違える）", () => {
    const rows = [
      sig(3, "ADD", 5655, "2026-08-18T22:46:40"),
      sig(2, "ADD", 5655, "2026-08-18T22:46:10"),
      sig(1, "HOLD", 5600, "2026-08-17T22:37:00"),
    ];
    const built = buildSignalHistory(rows, 5423);
    expect(built).toHaveLength(2);
    // 重複を除かないと「ADD の前は ADD」になり変化が見えなくなる
    expect(built[0].prevAction).toBe("HOLD");
    expect(built[0].changed).toBe(true);
  });

  it("空の履歴でも落ちない", () => {
    expect(buildSignalHistory([], 5423)).toEqual([]);
  });
});

describe("changePointsOnly", () => {
  it("判定が変わった記録だけを残す", () => {
    const rows = [
      sig(4, "ADD", 5423, "2026-08-19T19:49:00"),
      sig(3, "HOLD", 5600, "2026-08-17T22:37:00"),
      sig(2, "HOLD", 5684, "2026-08-16T22:24:00"),
      sig(1, "WATCH", 5684, "2026-08-15T15:55:00"),
    ];
    const points = changePointsOnly(buildSignalHistory(rows, 5423));
    expect(points.map(p => p.action)).toEqual(["ADD", "HOLD"]);
  });

  it("一度も変わっていなければ空になる", () => {
    const rows = [
      sig(2, "HOLD", 5600, "2026-08-17T22:37:00"),
      sig(1, "HOLD", 5684, "2026-08-15T22:21:00"),
    ];
    expect(changePointsOnly(buildSignalHistory(rows, 5423))).toEqual([]);
  });
});
