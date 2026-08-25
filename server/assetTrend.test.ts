import { describe, expect, it } from "vitest";
import { buildAssetTrend, resolveScale, type SnapshotInput } from "./services/assetTrend";

const snap = (
  date: string,
  value: number,
  cost: number,
  count: number,
  borrowed: number | null = null,
  netAssets: number | null = null
): SnapshotInput => ({
  // 既存テストの時刻文字列は画面上の日本時間として書かれている。
  // タイムゾーン指定が無い文字列を Node 実行環境の TZ に任せると結果が変わるため固定する。
  capturedAt: new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(date) ? date : `${date}+09:00`),
  totalValue: value,
  totalCost: cost,
  positionCount: count,
  borrowed,
  netAssets,
});

describe("buildAssetTrend", () => {
  it("記録が無いときは空を返す", () => {
    const r = buildAssetTrend([], "month");
    expect(r.points).toHaveLength(0);
    expect(r.snapshotCount).toBe(0);
    expect(r.priceOnlyChange).toBeNull();
  });

  it("同じ日に複数回記録があるとき、その日の最後の値を代表にする", () => {
    const rows = [
      snap("2026-08-16T01:00:00", 100, 90, 10),
      snap("2026-08-16T09:00:00", 120, 90, 10),
      snap("2026-08-16T17:00:00", 110, 90, 10),
    ];
    const r = buildAssetTrend(rows, "day");
    expect(r.points).toHaveLength(1);
    expect(r.points[0].value).toBe(110);
    // 丸める前の件数は保持する（利用者に「何件記録済み」と伝えるため）
    expect(r.snapshotCount).toBe(3);
  });

  it("UTC では日付が違っても JST の同じ日なら 1 点にまとめる", () => {
    const rows = [
      snap("2026-08-25T15:05:00.000Z", 100, 90, 10),
      snap("2026-08-26T14:55:00.000Z", 120, 90, 10),
    ];
    const r = buildAssetTrend(rows, "day");
    expect(r.points).toHaveLength(1);
    expect(r.points[0].date).toBe("8/26");
    expect(r.points[0].value).toBe(120);
  });

  it("UTC の月末より JST の暦月を優先する", () => {
    const rows = [
      snap("2026-07-31T14:55:00.000Z", 100, 90, 10),
      snap("2026-07-31T15:05:00.000Z", 120, 90, 10),
    ];
    expect(buildAssetTrend(rows, "month").points).toHaveLength(2);
  });

  it("月次では同じ月の記録が 1 点にまとまる", () => {
    const rows = [
      snap("2026-08-14T17:00:00", 100, 90, 10),
      snap("2026-08-15T17:00:00", 110, 90, 10),
      snap("2026-08-16T17:00:00", 120, 90, 10),
    ];
    expect(buildAssetTrend(rows, "month").points).toHaveLength(1);
    expect(buildAssetTrend(rows, "day").points).toHaveLength(3);
  });

  it("銘柄数が変わらない期間は値動きを計算する", () => {
    const rows = [
      snap("2026-08-14T17:00:00", 1000, 900, 10),
      snap("2026-08-15T17:00:00", 1050, 900, 10),
    ];
    const r = buildAssetTrend(rows, "day");
    expect(r.points[1].positionChanged).toBe(false);
    expect(r.points[1].priceChange).toBe(50);
    expect(r.priceOnlyChange).toBe(50);
  });

  it("買い増しがあっても銘柄数が同じなら取得原価の増加分を差し引く", () => {
    // 100 買い増して評価額が 130 増えた → 値動きは 30
    const rows = [
      snap("2026-08-14T17:00:00", 1000, 900, 10),
      snap("2026-08-15T17:00:00", 1130, 1000, 10),
    ];
    const r = buildAssetTrend(rows, "day");
    expect(r.points[1].priceChange).toBe(30);
  });

  it("銘柄数が変わった期間は値動きを出さない（分離できないため）", () => {
    const rows = [
      snap("2026-08-14T17:00:00", 1000, 900, 10),
      snap("2026-08-15T17:00:00", 5000, 4500, 51),
    ];
    const r = buildAssetTrend(rows, "day");
    expect(r.points[1].positionChanged).toBe(true);
    expect(r.points[1].positionDelta).toBe(41);
    expect(r.points[1].priceChange).toBeNull();
    expect(r.changedPointCount).toBe(1);
    // 分離できる期間が無いので全体の値動きも出せない
    expect(r.priceOnlyChange).toBeNull();
  });

  it("登録作業の期間を除いて値動きだけを合計する", () => {
    const rows = [
      snap("2026-08-14T17:00:00", 1000, 900, 10),
      // 銘柄追加（この区間は除外される）
      snap("2026-08-15T17:00:00", 5000, 4500, 51),
      // 値動きのみ +100
      snap("2026-08-16T17:00:00", 5100, 4500, 51),
      // 値動きのみ -30
      snap("2026-08-17T17:00:00", 5070, 4500, 51),
    ];
    const r = buildAssetTrend(rows, "day");
    expect(r.priceOnlyChange).toBe(70);
    expect(r.changedPointCount).toBe(1);
  });

  it("最初の点は比較対象が無いので変化なし扱いにする", () => {
    const r = buildAssetTrend([snap("2026-08-14T17:00:00", 1000, 900, 10)], "day");
    expect(r.points[0].positionChanged).toBe(false);
    expect(r.points[0].positionDelta).toBe(0);
    expect(r.points[0].priceChange).toBeNull();
  });

  it("純資産の記録がある点はそのまま持つ（借入がある口座の実質資産）", () => {
    const rows = [
      snap("2026-08-15T07:00:00", 767033570, 645542340, 103, 227483427, 539550143),
      snap("2026-08-16T08:00:00", 811563777, 682982529, 107, 227483427, 585335652),
    ];
    const r = buildAssetTrend(rows, "day");
    expect(r.points).toHaveLength(2);
    expect(r.points[1].netAssets).toBe(585335652);
    // 総評価額と純資産の差が借入額になっている
    expect(r.points[1].value - (r.points[1].netAssets ?? 0)).toBeCloseTo(226228125, 0);
  });

  it("古い記録は純資産が null（後から列を追加したため）", () => {
    const r = buildAssetTrend([snap("2026-08-14T17:00:00", 1000, 900, 10)], "day");
    expect(r.points[0].netAssets).toBeNull();
  });

  it("記録の最初と最後の時刻を返す", () => {
    const rows = [
      snap("2026-08-14T17:00:00", 1000, 900, 10),
      snap("2026-08-16T17:00:00", 1100, 900, 10),
    ];
    const r = buildAssetTrend(rows, "month");
    expect(r.firstAt?.toISOString()).toBe(new Date("2026-08-14T17:00:00+09:00").toISOString());
    expect(r.lastAt?.toISOString()).toBe(new Date("2026-08-16T17:00:00+09:00").toISOString());
  });

  it("順序が乱れた入力でも時系列に並べる", () => {
    const rows = [
      snap("2026-08-16T17:00:00", 1200, 900, 10),
      snap("2026-08-14T17:00:00", 1000, 900, 10),
      snap("2026-08-15T17:00:00", 1100, 900, 10),
    ];
    const r = buildAssetTrend(rows, "day");
    expect(r.points.map(p => p.value)).toEqual([1000, 1100, 1200]);
  });
});

describe("resolveScale", () => {
  it("月次で 2 点以上描けるならそのまま月次", () => {
    const rows = [
      snap("2026-07-31T17:00:00", 1000, 900, 10),
      snap("2026-08-16T17:00:00", 1100, 900, 10),
    ];
    expect(resolveScale(rows, "month")).toEqual({ scale: "month", fellBack: false });
  });

  it("同じ月に固まっていて月次では描けないとき日次に落とす", () => {
    // これが「12 件記録があるのにグラフが空」の状況
    const rows = [
      snap("2026-08-14T17:00:00", 1000, 900, 10),
      snap("2026-08-15T17:00:00", 1100, 900, 10),
      snap("2026-08-16T17:00:00", 1200, 900, 10),
    ];
    expect(resolveScale(rows, "month")).toEqual({ scale: "day", fellBack: true });
  });

  it("日次を明示的に選んだときは切り替えない", () => {
    const rows = [snap("2026-08-14T17:00:00", 1000, 900, 10)];
    expect(resolveScale(rows, "day")).toEqual({ scale: "day", fellBack: false });
  });

  it("記録が 1 件だけなら日次にしても描けないので切り替えない", () => {
    const rows = [snap("2026-08-14T17:00:00", 1000, 900, 10)];
    expect(resolveScale(rows, "month")).toEqual({ scale: "month", fellBack: false });
  });

  it("同じ日に複数回の記録しかない場合も切り替えない（日次でも 1 点）", () => {
    const rows = [
      snap("2026-08-16T01:00:00", 1000, 900, 10),
      snap("2026-08-16T17:00:00", 1100, 900, 10),
    ];
    expect(resolveScale(rows, "month")).toEqual({ scale: "month", fellBack: false });
  });

  it("実データの状況：同じ月に 13 件・3 日分ある場合、月次要求は日次に落ちて 3 点になる", () => {
    // 8/14 に 2 件、8/15 に 4 件、8/16 に 7 件（株価更新が 1 日に複数回走る）
    const rows = [
      snap("2026-08-14T07:00:00", 88961920, 70104000, 27),
      snap("2026-08-14T09:00:00", 88961920, 70104000, 27),
      snap("2026-08-15T07:00:00", 263320000, 191090000, 70),
      snap("2026-08-15T10:00:00", 263320000, 191090000, 70),
      snap("2026-08-15T14:00:00", 263320000, 191090000, 70),
      snap("2026-08-15T18:00:00", 263320000, 191090000, 70),
      snap("2026-08-16T07:00:00", 767033570, 645542340, 103),
      snap("2026-08-16T08:00:00", 811563777, 682982529, 107),
      snap(
        "2026-08-16T16:45:00",
        811563777,
        682982529,
        107,
        227483426.77,
        585335652.26
      ),
    ];
    const { scale, fellBack } = resolveScale(rows, "month");
    expect(scale).toBe("day");
    expect(fellBack).toBe(true);

    const r = buildAssetTrend(rows, scale);
    expect(r.points).toHaveLength(3);
    expect(r.snapshotCount).toBe(9);
    // 各日の最終記録が代表値になる
    expect(r.points[2].netAssets).toBeCloseTo(585335652.26, 0);
    // 27 → 70 → 107 と登録が続いた期間は値動きを出さない
    expect(r.points[1].positionDelta).toBe(43);
    expect(r.points[2].positionDelta).toBe(37);
    expect(r.priceOnlyChange).toBeNull();
    expect(r.changedPointCount).toBe(2);
  });
});
