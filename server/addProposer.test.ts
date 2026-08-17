import { describe, expect, it } from "vitest";
import { computeAddSizing } from "../shared/addSizing";
import {
  buildProposalPrompt,
  clampAmount,
  reconcileStance,
  stripStancePrefix,
  type ProposalTarget,
} from "./services/addProposer";
import type { ConsultContext } from "./services/consultContext";

const TOTAL = 858301338;
const INTEREST = 94056809;
const CASH = 1255302;

/** 構成比 0.58%（上限まで余地あり）の状態 */
const sizingRoomy = computeAddSizing(TOTAL, INTEREST, CASH, 5_000_000)!;
/** 構成比 4.89%（上限に近い）の状態 */
const sizingTight = computeAddSizing(TOTAL, INTEREST, CASH, 42_000_000)!;
/** 構成比 6.99%（上限超過）の状態 */
const sizingCapped = computeAddSizing(TOTAL, INTEREST, CASH, 60_000_000)!;

describe("提案金額の丸め込み", () => {
  it("範囲内の金額はそのまま採る", () => {
    const r = clampAmount(5_000_000, sizingRoomy);
    expect(r.amount).toBe(5_000_000);
    expect(r.adjusted).toBe(false);
  });

  it("1 回分の目安を超える金額は目安まで下げる", () => {
    const r = clampAmount(50_000_000, sizingRoomy);
    expect(r.amount).toBe(Math.round(sizingRoomy.suggestedBase));
    expect(r.adjusted).toBe(true);
  });

  it("上限に近い銘柄では余地の分まで下げる", () => {
    const r = clampAmount(11_000_000, sizingTight);
    expect(r.amount).toBe(Math.round(sizingTight.roomToCapBase));
    expect(r.adjusted).toBe(true);
  });

  it("上限に達している銘柄では金額を持たせない", () => {
    const r = clampAmount(3_000_000, sizingCapped);
    expect(r.amount).toBeNull();
    expect(r.adjusted).toBe(true);
  });

  it("金額なし・0・負の値は金額なしとして扱う", () => {
    expect(clampAmount(null, sizingRoomy).amount).toBeNull();
    expect(clampAmount(0, sizingRoomy).amount).toBeNull();
    expect(clampAmount(-100, sizingRoomy).amount).toBeNull();
    expect(clampAmount(Number.NaN, sizingRoomy).amount).toBeNull();
  });
});

describe("結論と金額の整合", () => {
  it("上限に達している銘柄は BUY でも見送りに変える", () => {
    const r = reconcileStance("BUY", 3_000_000, sizingCapped);
    expect(r.stance).toBe("SKIP");
    expect(r.amount).toBeNull();
  });

  it("BUY で金額が出せない場合は待ちに変える", () => {
    const r = reconcileStance("BUY", null, sizingRoomy);
    expect(r.stance).toBe("WAIT");
  });

  it("WAIT / SKIP には金額を持たせない", () => {
    expect(reconcileStance("WAIT", 5_000_000, sizingRoomy).amount).toBeNull();
    expect(reconcileStance("SKIP", 5_000_000, sizingRoomy).amount).toBeNull();
  });

  it("BUY で金額が範囲内ならそのまま通す", () => {
    const r = reconcileStance("BUY", 5_000_000, sizingRoomy);
    expect(r.stance).toBe("BUY");
    expect(r.amount).toBe(5_000_000);
  });
});

const ctx: ConsultContext = {
  totalValueJpy: TOTAL,
  cashJpy: CASH,
  borrowedJpy: 227496210,
  netAssetsJpy: 726117238,
  leverage: 1.18,
  usdJpyRate: 159.31,
  annualDividendJpy: 20033968,
  dividendYieldPct: 2.33,
  annualInterestJpy: 3934238,
  borrowRatePct: 1.73,
  interestAssetsJpy: INTEREST,
  interestIncomeJpy: 3252763,
  interestRatePct: 3.46,
  carrySpreadPct: 1.73,
  brokerLeverage: [],
  positionCount: 112,
  sectors: [{ sector: "情報技術", sharePct: 28.4 }],
  markets: [{ market: "JP", sharePct: 52.3 }],
  topHoldings: [],
  focus: null,
  focusSymbol: "CDNS",
  addZone: [],
  focusNews: [],
  pastConsults: [],
  focusCard: null,
  adviceRecord: { judged: 0, correct: 0, wrong: 0, byStance: [], symbolHistory: [] },
  builtAt: "2026-08-18",
};

const target: ProposalTarget = {
  symbol: "CDNS",
  name: "Cadence Design Systems, Inc.",
  currency: "USD",
  currentPrice: 324.18,
  held: false,
  bandLabel: "静観し押し目を待つ",
  nextGapPct: -2.8,
  nextActionLabel: "初回打診買いを検討",
  watchTargetPrice: null,
  concernCount: 0,
};

describe("提案の指示文", () => {
  it("結論の文頭に付く記号を取り除く（バッジと二重になるため）", () => {
    // 実測で返ってきた形をそのまま入力にする
    expect(stripStancePrefix("BUY。取得単価を下げ、構成比を適正化するため、買い増しを実行する。")).toBe(
      "取得単価を下げ、構成比を適正化するため、買い増しを実行する。"
    );
    expect(
      stripStancePrefix("WAIT。取得単価をわずかに上回る水準であり、調整を待つべきです。")
    ).toBe("取得単価をわずかに上回る水準であり、調整を待つべきです。");
    expect(stripStancePrefix("SKIP: 構成比が上限に達しています。")).toBe(
      "構成比が上限に達しています。"
    );
  });

  it("記号が無い結論はそのまま残す", () => {
    const s = "現在値は打診買いの目安まであと2.8%乖離しているため、押し目を待ちます。";
    expect(stripStancePrefix(s)).toBe(s);
  });

  it("文中の BUY は消さない（文頭のみ対象）", () => {
    const s = "他の銘柄の BUY 判定より優先度は低いです。";
    expect(stripStancePrefix(s)).toBe(s);
  });

  it("金額の範囲を明示する（AI に自由に決めさせない）", () => {
    const text = buildProposalPrompt(target, sizingRoomy, ctx);
    expect(text).toContain("1 回分の目安");
    expect(text).toContain("までに追加できる額");
    expect(text).toContain("実際に提案してよい上限");
  });

  it("未保有であることと判定を伝える", () => {
    const text = buildProposalPrompt(target, sizingRoomy, ctx);
    expect(text).toContain("まだ持っていない");
    expect(text).toContain("静観し押し目を待つ");
    expect(text).toContain("次の段まで -2.8%");
  });

  it("上限に達している場合は買い増しを勧められないと明記する", () => {
    const text = buildProposalPrompt(target, sizingCapped, ctx);
    expect(text).toContain("上限");
    expect(text).toContain("買い増しは勧められない");
    expect(text).not.toContain("実際に提案してよい上限");
  });

  it("ニュースが無い場合は推測を禁じる", () => {
    const text = buildProposalPrompt(target, sizingRoomy, ctx);
    expect(text).toContain("推測で補わないこと");
  });

  it("投資カードの降りる条件を渡す", () => {
    const withCard: ConsultContext = {
      ...ctx,
      focusCard: {
        coreThesis: "EDA の二強",
        exitConditions: "売上成長率が 2 四半期連続でマイナス",
        risks: null,
        valuationAssumption: null,
      },
    };
    const text = buildProposalPrompt(target, sizingRoomy, withCard);
    expect(text).toContain("降りる条件: 売上成長率が 2 四半期連続でマイナス");
  });

  it("借入金利と現金利回りを含む（現金を株に替える判断に必要）", () => {
    const text = buildProposalPrompt(target, sizingRoomy, ctx);
    expect(text).toContain("借入の実効金利");
    expect(text).toContain("3.46%");
  });
});
