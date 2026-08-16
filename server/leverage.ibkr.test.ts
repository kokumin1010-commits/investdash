/**
 * IBKR シンガポール口座（信用取引）の実データでレバレッジ計算を検証する。
 *
 * 画面が表示している数値と一致することを確かめるのが目的。
 * 数式を変えたときに実口座の数字がずれたら気付けるようにしている。
 */
import { describe, expect, it } from "vitest";
import { computeBrokerLeverage, marginRiskLevel } from "./services/leverage";

/** 2026/8/16 の残高タブの実測値（SGD） */
const IBKR = {
  broker: "ibkr",
  currency: "SGD",
  positionValue: 4027724.59,
  cashBalance: -1826237.33,
  maintenanceMargin: 844670.35,
  interestMtd: -1217.22,
};

describe("IBKR 実データのレバレッジ", () => {
  const l = computeBrokerLeverage(IBKR);

  it("借入額を現金残高のマイナスから取り出す", () => {
    expect(l.borrowed).toBeCloseTo(1826237.33, 2);
    expect(l.freeCash).toBe(0);
    expect(l.isMargin).toBe(true);
  });

  it("純資産が画面表示の 2,204,557 SGD と一致する", () => {
    expect(l.netValue).toBeCloseTo(2201487.26, 2);
    // 画面の純資産評価額 2,204,557 SGD との差は 0.2% 未満（撮影時点の値動き）
    expect(Math.abs(l.netValue - 2204556.91) / 2204556.91).toBeLessThan(0.002);
  });

  it("レバレッジが画面の計算値 1.83 倍と一致する", () => {
    expect(l.leverage).not.toBeNull();
    expect(l.leverage!).toBeCloseTo(1.83, 2);
  });

  it("証拠金余力が維持証拠金を引いた額になる", () => {
    expect(l.marginCushion).toBeCloseTo(2201487.26 - 844670.35, 2);
    expect(l.marginRatioPct).not.toBeNull();
    // 維持証拠金の 2.6 倍の純資産がある
    expect(l.marginRatioPct!).toBeGreaterThan(250);
  });

  it("追証までの下落余地が 33% 台になり CAUTION と判定される", () => {
    expect(l.dropToMarginCallPct).not.toBeNull();
    expect(l.dropToMarginCallPct!).toBeGreaterThan(33);
    expect(l.dropToMarginCallPct!).toBeLessThan(34);
    expect(marginRiskLevel(l)).toBe("CAUTION");
  });
});

describe("現物のみの口座", () => {
  const l = computeBrokerLeverage({
    broker: "rakuten_ispeed",
    currency: "JPY",
    positionValue: 176164586,
    cashBalance: 0,
    maintenanceMargin: 0,
    interestMtd: 0,
  });

  it("借入なしと判定し、レバレッジは 1 倍になる", () => {
    expect(l.isMargin).toBe(false);
    expect(l.borrowed).toBe(0);
    expect(l.leverage).toBe(1);
  });

  it("追証の概念がないため下落余地は null、リスクは SAFE", () => {
    expect(l.dropToMarginCallPct).toBeNull();
    expect(l.marginCushion).toBeNull();
    expect(marginRiskLevel(l)).toBe("SAFE");
  });
});

describe("危険水域の判定", () => {
  it("純資産が維持証拠金を下回ると DANGER", () => {
    const l = computeBrokerLeverage({
      broker: "ibkr",
      currency: "SGD",
      positionValue: 1000000,
      cashBalance: -900000,
      maintenanceMargin: 200000,
      interestMtd: 0,
    });
    // 純資産 100,000 < 維持証拠金 200,000
    expect(l.marginCushion).toBeLessThan(0);
    expect(marginRiskLevel(l)).toBe("DANGER");
  });

  it("債務超過ではレバレッジを算出せず null を返す", () => {
    const l = computeBrokerLeverage({
      broker: "ibkr",
      currency: "SGD",
      positionValue: 1000000,
      cashBalance: -1200000,
      maintenanceMargin: 200000,
      interestMtd: 0,
    });
    expect(l.netValue).toBeLessThan(0);
    expect(l.leverage).toBeNull();
    expect(marginRiskLevel(l)).toBe("DANGER");
  });

  it("下落余地 15% なら WARNING", () => {
    const l = computeBrokerLeverage({
      broker: "ibkr",
      currency: "SGD",
      positionValue: 1000000,
      cashBalance: -600000,
      maintenanceMargin: 250000,
      interestMtd: 0,
    });
    // 純資産 400,000 − 維持証拠金 250,000 = 150,000 → 株式時価の 15%
    expect(l.dropToMarginCallPct).toBeCloseTo(15, 5);
    expect(marginRiskLevel(l)).toBe("WARNING");
  });
});
