import { lotSizeFor, lotSizeUncertain } from "./addShares";
import type { Market } from "./investing";

export type HoldingSignalAction = "ADD" | "HOLD" | "WATCH" | "REDUCE" | "EXIT";

/** 長期保有で売買ノイズを増やさないための最低構成比。 */
export const MIN_PARTIAL_SELL_WEIGHT_PCT = 0.05;
export const MIN_REMAINING_POSITION_WEIGHT_PCT = 0.1;

export type HoldingActionPlan = {
  direction: "BUY" | "NONE" | "REVIEW" | "SELL" | "EXIT";
  shares: number | null;
  amountLocal: number | null;
  amountBase: number | null;
  afterQuantity: number;
  afterWeightPct: number | null;
  accountCount: number;
  lotSize: number;
  lotUncertain: boolean;
  rationale: string;
};

export type HoldingActionPlanInput = {
  action: HoldingSignalAction;
  quantity: number;
  currentPrice: number | null;
  marketValueBase: number | null;
  currentWeightPct: number | null;
  market: Market;
  accountCount: number;
  concentrationCapPct?: number;
};

function noTrade(
  input: HoldingActionPlanInput,
  direction: HoldingActionPlan["direction"],
  rationale: string
): HoldingActionPlan {
  return {
    direction,
    shares: 0,
    amountLocal: 0,
    amountBase: 0,
    afterQuantity: input.quantity,
    afterWeightPct: input.currentWeightPct,
    accountCount: input.accountCount,
    lotSize: lotSizeFor(input.market),
    lotUncertain: lotSizeUncertain(input.market),
    rationale,
  };
}

/**
 * AI の action を、現在の実保有に対する実行目安へ変換する。
 *
 * 株数はモデルに自由生成させず、保有数量・構成比・市場単元から決定する。
 * ADD の買付量だけは価格帯と現金・レバレッジを使う別の sizing が担うため、
 * ここでは方向だけを返す。
 */
export function buildHoldingActionPlan(
  input: HoldingActionPlanInput
): HoldingActionPlan {
  const cap = input.concentrationCapPct ?? 5;
  const lot = lotSizeFor(input.market);
  const quantity = Math.max(0, input.quantity);

  if (input.action === "ADD") {
    return {
      ...noTrade(
        input,
        "BUY",
        "現在の価格帯・現金余力・IBKRリスクから買い増し量を計算します"
      ),
      shares: null,
      amountLocal: null,
      amountBase: null,
    };
  }
  if (input.action === "HOLD") {
    return noTrade(input, "NONE", "現在の保有を維持し、追加売買は行いません");
  }
  if (input.action === "WATCH") {
    return noTrade(
      input,
      "REVIEW",
      "確認条件が解消するまで現在の保有を維持し、追加売買は行いません"
    );
  }
  if (input.action === "EXIT") {
    const amountLocal =
      input.currentPrice === null ? null : quantity * input.currentPrice;
    return {
      direction: "EXIT",
      shares: quantity,
      amountLocal,
      amountBase: input.marketValueBase,
      afterQuantity: 0,
      afterWeightPct: input.currentWeightPct === null ? null : 0,
      accountCount: input.accountCount,
      lotSize: lot,
      lotUncertain: lotSizeUncertain(input.market),
      rationale: "保有全量を対象に退出を検討します",
    };
  }

  if (quantity <= 0) {
    return noTrade(input, "SELL", "売却対象の保有株数を確認できません");
  }

  const quarterShares = Math.floor((quantity * 0.25) / lot) * lot;
  const capShares =
    input.currentWeightPct !== null && input.currentWeightPct > cap
      ? Math.ceil((quantity * (1 - cap / input.currentWeightPct)) / lot) * lot
      : 0;
  const minimumExecutable = quantity >= lot ? lot : 0;
  const shares = Math.min(
    quantity,
    Math.max(quarterShares, capShares, minimumExecutable)
  );
  const soldRatio = shares / quantity;
  const afterQuantity = Math.max(0, quantity - shares);
  const amountLocal =
    input.currentPrice === null ? null : shares * input.currentPrice;
  const amountBase =
    input.marketValueBase === null ? null : input.marketValueBase * soldRatio;
  const afterWeightPct =
    input.currentWeightPct === null
      ? null
      : input.currentWeightPct * (1 - soldRatio);
  const soldWeightPct =
    input.currentWeightPct === null ? null : input.currentWeightPct * soldRatio;
  const wouldExit = afterQuantity <= 0;
  const leavesOddLot = lot > 1 && afterQuantity > 0 && afterQuantity < lot;
  const tradeTooSmall =
    soldWeightPct !== null && soldWeightPct < MIN_PARTIAL_SELL_WEIGHT_PCT;
  const remainderTooSmall =
    afterWeightPct !== null && afterWeightPct < MIN_REMAINING_POSITION_WEIGHT_PCT;

  if (wouldExit) {
    return noTrade(
      input,
      "REVIEW",
      "REDUCE を全売却へ自動変換しません。保有が1単元のみのため、継続保有か EXIT かを改めて確認します"
    );
  }
  if (leavesOddLot || tradeTooSmall || remainderTooSmall) {
    return noTrade(
      input,
      "REVIEW",
      leavesOddLot
        ? "売却後が最低売買単位未満になるため、機械的な一部売却は行いません"
        : tradeTooSmall
          ? "売却量がポートフォリオの0.05%未満で効果が小さいため、長期保有では売買を増やしません"
          : "売却後の残存比率が0.10%未満になるため、端数保有を作らず継続保有か EXIT かを確認します"
    );
  }

  return {
    direction: "SELL",
    shares,
    amountLocal,
    amountBase,
    afterQuantity,
    afterWeightPct,
    accountCount: input.accountCount,
    lotSize: lot,
    lotUncertain: lotSizeUncertain(input.market),
    rationale:
      capShares > quarterShares
        ? `集中度を ${cap.toFixed(1)}% 以下へ下げるため、必要株数を優先します`
        : "保有合計の25%を一部売却する初回目安です",
  };
}
