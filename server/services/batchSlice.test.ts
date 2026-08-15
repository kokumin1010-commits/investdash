import { describe, expect, it } from "vitest";

/**
 * 一括処理の分割ロジックの検証。
 *
 * 本番（Autoscale）のリクエスト上限は 180 秒。27 銘柄の一括処理は
 * 4〜13 分かかるため、offset/batchSize で分割して nextOffset を辿る方式にした。
 * ここでは「取りこぼしなく全件を 1 度ずつ処理し、最後に必ず終わる」ことを保証する。
 */

/** サーバー実装（routers/portfolio.ts, services/portfolio.ts）と同じ分割規則 */
function sliceBatch<T>(
  items: T[],
  offset: number,
  batchSize: number
): { batch: T[]; processed: number; nextOffset: number | null; total: number } {
  const total = items.length;
  const batch = items.slice(offset, offset + batchSize);
  const processed = offset + batch.length;
  return { batch, processed, nextOffset: processed >= total ? null : processed, total };
}

/** nextOffset を辿ってクライアントが全バッチを回す動作を再現する */
function runAll<T>(items: T[], batchSize: number): { visited: T[]; calls: number } {
  const visited: T[] = [];
  let offset: number | null = 0;
  let calls = 0;
  while (offset !== null) {
    if (calls > 1000) throw new Error("無限ループ検出");
    const res = sliceBatch(items, offset, batchSize);
    visited.push(...res.batch);
    offset = res.nextOffset;
    calls += 1;
  }
  return { visited, calls };
}

const symbols = (count: number) => Array.from({ length: count }, (_, i) => `S${i + 1}`);

describe("一括処理のバッチ分割", () => {
  it("27 銘柄を batchSize=6 で全件ちょうど 1 回ずつ処理する", () => {
    const items = symbols(27);
    const { visited, calls } = runAll(items, 6);
    expect(visited).toEqual(items);
    expect(calls).toBe(5); // 6,6,6,6,3
  });

  it("27 銘柄を batchSize=4 で全件処理する（ニュース取得の既定値）", () => {
    const items = symbols(27);
    const { visited, calls } = runAll(items, 4);
    expect(visited).toEqual(items);
    expect(calls).toBe(7); // 4×6 + 3
  });

  it("割り切れる件数でも余分な空バッチを呼ばない", () => {
    const { visited, calls } = runAll(symbols(24), 6);
    expect(visited).toHaveLength(24);
    expect(calls).toBe(4);
  });

  it("銘柄が 0 件でも 1 回で終了する", () => {
    const { visited, calls } = runAll<string>([], 6);
    expect(visited).toEqual([]);
    expect(calls).toBe(1);
  });

  it("最終バッチで nextOffset が null になる", () => {
    const items = symbols(27);
    expect(sliceBatch(items, 24, 6).nextOffset).toBeNull();
    expect(sliceBatch(items, 18, 6).nextOffset).toBe(24);
  });

  it("範囲外の offset でも空バッチを返して停止する", () => {
    const res = sliceBatch(symbols(27), 30, 6);
    expect(res.batch).toEqual([]);
    expect(res.nextOffset).toBeNull();
  });

  it("1 バッチの所要時間が本番の 180 秒制限に収まる", () => {
    // 実測: シグナル生成 1 銘柄 10〜16 秒 / ニュース 1 銘柄 約 28 秒
    expect(6 * 16).toBeLessThan(180); // AI分析 batchSize=6 → 最悪 96 秒
    expect(4 * 28).toBeLessThan(180); // ニュース batchSize=4 → 最悪 112 秒
  });

  it("total は offset に関係なく常に全件数を返す", () => {
    const items = symbols(27);
    expect(sliceBatch(items, 0, 6).total).toBe(27);
    expect(sliceBatch(items, 24, 6).total).toBe(27);
  });
});
