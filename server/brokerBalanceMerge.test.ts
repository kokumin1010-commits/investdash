/**
 * 口座残高の部分更新時に、通貨別内訳と検算値が失われないことを検証する。
 *
 * 設定画面からは借入額と維持証拠金だけを直すことが多い。そのとき
 * currencyBreakdown（借入の通貨別内訳・画面表示の検算値）を上書きで
 * null にしてしまうと、後から検算できなくなる。
 */
import { describe, expect, it } from "vitest";

/**
 * ルーター内のマージ処理と同じ関数。
 * 実装は server/routers/portfolio.ts の saveBrokerBalance にあり、
 * ここではその判断ロジックだけを取り出して検証する。
 */
function mergeBreakdown(
  existingJson: string | null,
  incoming: Record<string, number>
): string | null {
  let merged = incoming;
  if (existingJson) {
    try {
      const prev = JSON.parse(existingJson) as Record<string, number>;
      merged = { ...prev, ...incoming };
    } catch {
      // 壊れた JSON は引き継がない
    }
  }
  return Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;
}

const EXISTING = JSON.stringify({
  JPY: -228720494.5,
  __reportedPositionValue: 4027724.59,
  __reportedNetValue: 2204556.91,
});

describe("口座残高の内訳マージ", () => {
  it("借入額だけを更新したとき、既存の通貨別内訳と検算値を保持する", () => {
    const result = mergeBreakdown(EXISTING, {});
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(parsed.JPY).toBe(-228720494.5);
    expect(parsed.__reportedPositionValue).toBe(4027724.59);
    expect(parsed.__reportedNetValue).toBe(2204556.91);
  });

  it("同じキーが渡された場合は新しい値で上書きする", () => {
    const result = mergeBreakdown(EXISTING, { __reportedPositionValue: 4100000 });
    const parsed = JSON.parse(result!);
    expect(parsed.__reportedPositionValue).toBe(4100000);
    // 渡されなかったキーは元の値が残る
    expect(parsed.JPY).toBe(-228720494.5);
  });

  it("新しい通貨の借入を追加できる", () => {
    const result = mergeBreakdown(EXISTING, { USD: -50000 });
    const parsed = JSON.parse(result!);
    expect(parsed.USD).toBe(-50000);
    expect(parsed.JPY).toBe(-228720494.5);
  });

  it("既存の記録がなく入力も空なら null を返す", () => {
    expect(mergeBreakdown(null, {})).toBeNull();
  });

  it("既存の JSON が壊れていても今回の入力は保存できる", () => {
    const result = mergeBreakdown("{壊れた", { JPY: -1000 });
    const parsed = JSON.parse(result!);
    expect(parsed.JPY).toBe(-1000);
  });
});
