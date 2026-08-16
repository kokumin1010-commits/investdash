/**
 * 信用取引（レバレッジ）の指標計算。
 *
 * 現物取引だけの口座（楽天 iSPEED、moomoo）では株式の時価がそのまま資産になるが、
 * 借入をして株を買っている口座（IBKR）では借入分を差し引かないと資産が過大になる。
 * 例: 株式 4,027,724 SGD に対し借入 1,826,237 SGD なら、実質の資産は 2,204,557 SGD。
 *
 * また借入がある口座では株価下落時に追証（追加保証金）のリスクがあるため、
 * 証拠金維持率と「あと何 % 下がると追証か」を算出する。
 */

import type { MarginRisk } from "../../shared/investing";

export type BrokerLeverageInput = {
  /** 証券プラットフォーム */
  broker: string;
  /** 口座の基軸通貨 */
  currency: string;
  /** 株式の時価総額（口座通貨） */
  positionValue: number;
  /** 現金残高（口座通貨）。マイナスなら借入 */
  cashBalance: number;
  /** 維持証拠金（口座通貨）。信用を使わない口座では 0 */
  maintenanceMargin: number;
  /** 月初来の支払利息（口座通貨、マイナス表記） */
  interestMtd: number;
};

export type BrokerLeverage = {
  broker: string;
  currency: string;
  positionValue: number;
  /** 借入額（正の数で表す）。借入がなければ 0 */
  borrowed: number;
  /** 余剰現金（借入がない場合の現金残高）。借入がある場合は 0 */
  freeCash: number;
  /** 純資産 = 株式時価 + 現金残高（現金がマイナスなら差し引かれる） */
  netValue: number;
  /**
   * レバレッジ倍率 = 株式時価 ÷ 純資産。
   * 1.0 なら現物のみ、2.0 なら純資産の 2 倍の株を持っている。
   * 純資産が 0 以下（追証状態）なら null。
   */
  leverage: number | null;
  /** 借入があるか。false なら現物のみで追証リスクはない */
  isMargin: boolean;
  maintenanceMargin: number;
  /** 証拠金余力 = 純資産 − 維持証拠金。マイナスなら追証 */
  marginCushion: number | null;
  /**
   * 証拠金維持率 = 純資産 ÷ 維持証拠金 × 100。
   * 100% を下回ると追証。維持証拠金が 0 なら null。
   */
  marginRatioPct: number | null;
  /**
   * 追証に至るまでの株価下落率（%）。
   * 株式時価が x% 下がると純資産も同額減るため、
   * 余力 ÷ 株式時価 で求まる。借入がなければ null。
   */
  dropToMarginCallPct: number | null;
  /** 月初来の支払利息（負値） */
  interestMtd: number;
};

/**
 * 1 口座分のレバレッジ指標を計算する。
 */
export function computeBrokerLeverage(input: BrokerLeverageInput): BrokerLeverage {
  const { broker, currency, positionValue, cashBalance, maintenanceMargin, interestMtd } = input;

  // 現金がマイナスなら借入。プラスなら余剰現金として扱う
  const borrowed = cashBalance < 0 ? -cashBalance : 0;
  const freeCash = cashBalance > 0 ? cashBalance : 0;
  const isMargin = borrowed > 0;

  // 純資産は株式時価に現金残高を足したもの（借入はマイナスなので差し引かれる）
  const netValue = positionValue + cashBalance;

  /*
   * レバレッジ倍率。純資産が 0 以下だと計算が意味を持たない（すでに債務超過）ため
   * null を返し、画面側で警告として扱えるようにする。
   */
  const leverage = netValue > 0 ? positionValue / netValue : null;

  const marginCushion = maintenanceMargin > 0 ? netValue - maintenanceMargin : null;
  const marginRatioPct = maintenanceMargin > 0 ? (netValue / maintenanceMargin) * 100 : null;

  /*
   * 追証までの下落余地。
   * 株式時価が d% 下落すると純資産は positionValue × d% 減る。
   * 純資産が維持証拠金と等しくなる d を求めると、
   *   netValue − positionValue × d = maintenanceMargin
   *   d = (netValue − maintenanceMargin) / positionValue
   * 借入がない口座では追証が発生しないため null。
   */
  const dropToMarginCallPct =
    isMargin && maintenanceMargin > 0 && positionValue > 0
      ? Math.max(0, ((netValue - maintenanceMargin) / positionValue) * 100)
      : null;

  return {
    broker,
    currency,
    positionValue,
    borrowed,
    freeCash,
    netValue,
    leverage,
    isMargin,
    maintenanceMargin,
    marginCushion,
    marginRatioPct,
    dropToMarginCallPct,
    interestMtd,
  };
}

/**
 * 追証リスクの警告レベル。
 *
 * 証拠金維持率が下がるほど危険。下落余地が小さいほど警告を強める。
 * しきい値は一般的な信用取引の目安に合わせている。
 */
/*
 * 型とラベルは shared/investing.ts に置き、画面と共通で使う。
 * ここで別に定義すると、片方だけ増やしたときに表示が欠ける。
 */
export type MarginRiskLevel = MarginRisk;

export function marginRiskLevel(l: BrokerLeverage): MarginRiskLevel {
  if (!l.isMargin) return "SAFE";
  // 既に純資産が維持証拠金を下回っている（追証発生中）
  if (l.marginCushion !== null && l.marginCushion <= 0) return "DANGER";
  const drop = l.dropToMarginCallPct;
  if (drop === null) return "SAFE";
  if (drop < 10) return "DANGER";
  if (drop < 20) return "WARNING";
  if (drop < 35) return "CAUTION";
  return "SAFE";
}
