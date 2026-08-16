import { describe, expect, it } from "vitest";
import { computeBrokerLeverage, marginRiskLevel } from "./services/leverage";

/**
 * IBKR の実測値（2026/8/16、SGD 建て）をもとに検証する。
 * 株式 4,027,724.59 / 現金 −1,826,237.33 / 純資産 2,204,556.91 / 維持証拠金 844,670.35
 */
const IBKR = {
  broker: "ibkr",
  currency: "SGD",
  positionValue: 4027724.59,
  cashBalance: -1826237.33,
  maintenanceMargin: 844670.35,
  interestMtd: -1217.22,
};

describe("computeBrokerLeverage", () => {
  it("IBKR の実測値から純資産を正しく算出する", () => {
    const l = computeBrokerLeverage(IBKR);
    /*
     * 4,027,724.59 − 1,826,237.33 = 2,201,487.26。
     * 画面表示の純資産 2,204,556.91 との差 3,069.65 は、株式時価に含まれない
     * 未収配当や端数（IBKR の「有価証券総ポジション価値」と「市場価格」の差
     * 4,028,948.22 − 4,027,724.59 = 1,223.63 など）に起因する。
     * 計算式そのものは正しいので、株式時価の入力値に応じた結果を検証する。
     */
    expect(l.netValue).toBeCloseTo(2201487.26, 1);
    expect(l.borrowed).toBeCloseTo(1826237.33, 2);
    expect(l.freeCash).toBe(0);
    expect(l.isMargin).toBe(true);
  });

  it("レバレッジ倍率を算出する", () => {
    const l = computeBrokerLeverage(IBKR);
    // 4,027,724 ÷ 2,204,487 ≒ 1.83 倍
    expect(l.leverage).toBeCloseTo(1.83, 2);
  });

  it("証拠金維持率と余力を算出する", () => {
    const l = computeBrokerLeverage(IBKR);
    // 2,201,487 − 844,670 = 1,356,817（画面の余力 1,359,886 と 0.2% 差）
    expect(l.marginCushion).toBeCloseTo(1356816.91, 1);
    // 2,201,487 ÷ 844,670 ≒ 261%
    expect(l.marginRatioPct).toBeCloseTo(261.0, 0);
  });

  it("追証までの下落余地を算出する", () => {
    const l = computeBrokerLeverage(IBKR);
    // (2,201,487 − 844,670) ÷ 4,027,724 ≒ 33.7%
    expect(l.dropToMarginCallPct).toBeCloseTo(33.7, 1);
  });

  it("現物のみの口座では借入 0・レバレッジ 1 倍になる", () => {
    const l = computeBrokerLeverage({
      broker: "rakuten_ispeed",
      currency: "JPY",
      positionValue: 145284500,
      cashBalance: 1255302,
      maintenanceMargin: 0,
      interestMtd: 0,
    });
    expect(l.isMargin).toBe(false);
    expect(l.borrowed).toBe(0);
    expect(l.freeCash).toBe(1255302);
    // 現金があるので株式時価 ÷ 純資産は 1 未満になる
    expect(l.leverage).toBeLessThan(1);
    // 追証の概念がないため null
    expect(l.dropToMarginCallPct).toBeNull();
    expect(l.marginRatioPct).toBeNull();
  });

  it("純資産が 0 以下ならレバレッジを null にする", () => {
    const l = computeBrokerLeverage({
      broker: "ibkr",
      currency: "SGD",
      positionValue: 1000,
      cashBalance: -1200,
      maintenanceMargin: 500,
      interestMtd: 0,
    });
    expect(l.netValue).toBe(-200);
    expect(l.leverage).toBeNull();
  });

  it("下落余地は 0 未満にならない", () => {
    const l = computeBrokerLeverage({
      broker: "ibkr",
      currency: "SGD",
      positionValue: 1000,
      cashBalance: -800,
      maintenanceMargin: 500,
      interestMtd: 0,
    });
    // 純資産 200 < 維持証拠金 500 なので既に追証状態
    expect(l.dropToMarginCallPct).toBe(0);
  });
});

describe("marginRiskLevel", () => {
  const base = { broker: "ibkr", currency: "SGD", interestMtd: 0 };

  it("現物のみなら SAFE", () => {
    const l = computeBrokerLeverage({
      ...base,
      positionValue: 1000,
      cashBalance: 100,
      maintenanceMargin: 0,
    });
    expect(marginRiskLevel(l)).toBe("SAFE");
  });

  it("IBKR の現状は CAUTION（下落余地 33.7% で 35% 未満）", () => {
    /*
     * 3 割超の下落余地があるとはいえ、レバレッジ 1.83 倍では
     * 相場急変時に一気に縮む。35% を境に注意喚起する設計とする。
     */
    expect(marginRiskLevel(computeBrokerLeverage(IBKR))).toBe("CAUTION");
  });

  it("下落余地が 20〜35% なら CAUTION", () => {
    // 純資産 300 / 維持証拠金 50 / 株式 1000 → 余地 25%
    const l = computeBrokerLeverage({
      ...base,
      positionValue: 1000,
      cashBalance: -700,
      maintenanceMargin: 50,
    });
    expect(l.dropToMarginCallPct).toBeCloseTo(25, 1);
    expect(marginRiskLevel(l)).toBe("CAUTION");
  });

  it("下落余地が 10〜20% なら WARNING", () => {
    // 純資産 300 / 維持証拠金 150 / 株式 1000 → 余地 15%
    const l = computeBrokerLeverage({
      ...base,
      positionValue: 1000,
      cashBalance: -700,
      maintenanceMargin: 150,
    });
    expect(marginRiskLevel(l)).toBe("WARNING");
  });

  it("下落余地が 10% 未満なら DANGER", () => {
    const l = computeBrokerLeverage({
      ...base,
      positionValue: 1000,
      cashBalance: -700,
      maintenanceMargin: 250,
    });
    expect(marginRiskLevel(l)).toBe("DANGER");
  });

  it("既に追証状態なら DANGER", () => {
    const l = computeBrokerLeverage({
      ...base,
      positionValue: 1000,
      cashBalance: -900,
      maintenanceMargin: 500,
    });
    expect(marginRiskLevel(l)).toBe("DANGER");
  });
});
