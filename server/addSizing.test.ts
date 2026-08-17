import { describe, expect, it } from "vitest";
import {
  ADD_STEPS,
  DEPLOYABLE_CASH_PCT,
  MAX_POSITION_SHARE_PCT,
  computeAddSizing,
} from "../shared/addSizing";

/** 実データ（2026/8 時点） */
const TOTAL = 858301338;
const INTEREST_ASSETS = 94056809;
const CASH = 1255302;

describe("買い増し金額の算定", () => {
  it("原資は現金性資産と預り金の半分（実データで約 4,765 万円）", () => {
    const s = computeAddSizing(TOTAL, INTEREST_ASSETS, CASH, 0)!;
    expect(s.deployableBase).toBeCloseTo(((INTEREST_ASSETS + CASH) * DEPLOYABLE_CASH_PCT) / 100, 0);
    expect(Math.round(s.deployableBase)).toBe(47656056);
  });

  it("1 段は原資を段数で割った額（実データで約 1,191 万円）", () => {
    const s = computeAddSizing(TOTAL, INTEREST_ASSETS, CASH, 0)!;
    expect(s.perStepBase).toBeCloseTo(s.deployableBase / ADD_STEPS, 5);
    expect(Math.round(s.perStepBase)).toBe(11914014);
  });

  it("構成比が小さい銘柄は 1 段分をそのまま提案する", () => {
    // 評価額 500 万円 = 全体の 0.58%。上限まで十分余地がある
    const s = computeAddSizing(TOTAL, INTEREST_ASSETS, CASH, 5_000_000)!;
    expect(s.currentSharePct).toBeCloseTo(0.58, 1);
    expect(s.suggestedBase).toBeCloseTo(s.perStepBase, 5);
    expect(s.atCap).toBe(false);
  });

  it("上限までの余地は買い増し後の構成比で計算する", () => {
    // 全体 1000 / 保有 40（4%）/ 上限 5%
    // x = (0.05*1000 - 40) / (1 - 0.05) = 10 / 0.95 = 10.526...
    const s = computeAddSizing(1000, 0, 0, 40)!;
    expect(s.roomToCapBase).toBeCloseTo(10.5263, 3);

    // 買い増した後に本当に 5% になるか（分母も増えることを織り込めているか）
    const after = ((40 + s.roomToCapBase) / (1000 + s.roomToCapBase)) * 100;
    expect(after).toBeCloseTo(MAX_POSITION_SHARE_PCT, 6);
  });

  it("上限に近い銘柄は 1 段分ではなく余地の分だけに絞る", () => {
    // 評価額 4,200 万円 = 全体の 4.89%。1 段（1,191 万円）を入れると上限超過
    const s = computeAddSizing(TOTAL, INTEREST_ASSETS, CASH, 42_000_000)!;
    expect(s.currentSharePct).toBeCloseTo(4.89, 1);
    expect(s.suggestedBase).toBeLessThan(s.perStepBase);
    expect(s.suggestedBase).toBeCloseTo(s.roomToCapBase, 5);
  });

  it("既に上限を超えている銘柄は買い増しを提案しない", () => {
    // 評価額 6,000 万円 = 全体の 6.99%。上限 5% を超えている
    const s = computeAddSizing(TOTAL, INTEREST_ASSETS, CASH, 60_000_000)!;
    expect(s.currentSharePct).toBeGreaterThan(MAX_POSITION_SHARE_PCT);
    expect(s.roomToCapBase).toBe(0);
    expect(s.suggestedBase).toBe(0);
    expect(s.atCap).toBe(true);
  });

  it("未保有銘柄は構成比 0 として扱う", () => {
    const s = computeAddSizing(TOTAL, INTEREST_ASSETS, CASH, 0)!;
    expect(s.currentSharePct).toBe(0);
    expect(s.atCap).toBe(false);
  });

  it("現金が無ければ提案額は 0 になる（借入を増やす前提にしない）", () => {
    const s = computeAddSizing(TOTAL, 0, 0, 5_000_000)!;
    expect(s.deployableBase).toBe(0);
    expect(s.suggestedBase).toBe(0);
    // 上限までの余地はあるが原資が無い、という状態を区別できる
    expect(s.roomToCapBase).toBeGreaterThan(0);
    expect(s.atCap).toBe(false);
  });

  it("現金が負（借越）でも原資を負にしない", () => {
    const s = computeAddSizing(TOTAL, -1000, -2000, 0)!;
    expect(s.deployableBase).toBe(0);
    expect(s.suggestedBase).toBe(0);
  });

  it("株式時価が無い・不正な場合は算定しない", () => {
    expect(computeAddSizing(0, INTEREST_ASSETS, CASH, 0)).toBeNull();
    expect(computeAddSizing(Number.NaN, INTEREST_ASSETS, CASH, 0)).toBeNull();
  });
});
