export type MarketTemperatureLevel =
  | "NORMAL"
  | "WATCH"
  | "CORRECTION"
  | "SHARP_DROP"
  | "UNAVAILABLE";

export type MarketTemperatureWindow = "DAY" | "WEEK" | "MONTH";

export type MarketTemperatureInput = {
  dayPct: number | null;
  weekPct: number | null;
  monthPct: number | null;
};

export type MarketTemperatureTrigger = {
  window: MarketTemperatureWindow;
  changePct: number;
  thresholdPct: number;
};

export type MarketTemperatureResult = {
  level: MarketTemperatureLevel;
  label: string;
  guidance: string;
  trigger: MarketTemperatureTrigger | null;
  availableWindowCount: number;
};

type Thresholds = Record<MarketTemperatureWindow, number>;

/**
 * InvestDash 内の固定運用基準。
 *
 * 市場全体の公式な「暴落」定義ではなく、ユーザー自身の保有株（株価＋為替）の
 * 下落を見て、待機資金と買い候補を確認するタイミングを揃えるための基準である。
 */
export const MARKET_TEMPERATURE_THRESHOLDS: Record<
  Exclude<MarketTemperatureLevel, "NORMAL" | "UNAVAILABLE">,
  Thresholds
> = {
  WATCH: { DAY: -1.5, WEEK: -3, MONTH: -5 },
  CORRECTION: { DAY: -3, WEEK: -7, MONTH: -10 },
  SHARP_DROP: { DAY: -5, WEEK: -10, MONTH: -15 },
};

const LABELS: Record<MarketTemperatureLevel, string> = {
  NORMAL: "通常範囲",
  WATCH: "弱含み",
  CORRECTION: "調整局面",
  SHARP_DROP: "大幅下落",
  UNAVAILABLE: "判定待ち",
};

const GUIDANCE: Record<MarketTemperatureLevel, string> = {
  NORMAL: "急落シグナルはありません。既定の月次入金と分割投資計画を維持します。",
  WATCH: "弱含みです。次回入金を急いで使い切らず、候補銘柄の価格帯を確認します。",
  CORRECTION:
    "調整局面です。待機資金を確保し、優先候補を一括ではなく分割購入で検討します。",
  SHARP_DROP:
    "大幅下落です。まずIBKRの追証余地と現金余力を確認し、段階的な投入だけを検討します。",
  UNAVAILABLE:
    "市場値動きの実記録が不足しています。純資産差だけから暴落とは判定しません。",
};

const WINDOWS: Array<{
  window: MarketTemperatureWindow;
  key: keyof MarketTemperatureInput;
}> = [
  { window: "DAY", key: "dayPct" },
  { window: "WEEK", key: "weekPct" },
  { window: "MONTH", key: "monthPct" },
];

const LEVEL_ORDER: Array<Exclude<MarketTemperatureLevel, "NORMAL" | "UNAVAILABLE">> = [
  "SHARP_DROP",
  "CORRECTION",
  "WATCH",
];

/**
 * 1日・7日・30日のうち、最も厳しい実測値で温度を決める。
 * null は「0%」に補わず、単に判定対象から除外する。
 */
export function classifyMarketTemperature(
  input: MarketTemperatureInput
): MarketTemperatureResult {
  const available = WINDOWS.flatMap(item => {
    const value = input[item.key];
    return value === null || !Number.isFinite(value)
      ? []
      : [{ window: item.window, changePct: value }];
  });

  if (available.length === 0) {
    return {
      level: "UNAVAILABLE",
      label: LABELS.UNAVAILABLE,
      guidance: GUIDANCE.UNAVAILABLE,
      trigger: null,
      availableWindowCount: 0,
    };
  }

  for (const level of LEVEL_ORDER) {
    const thresholds = MARKET_TEMPERATURE_THRESHOLDS[level];
    const triggered = available
      .filter(item => item.changePct <= thresholds[item.window])
      .map(item => ({
        ...item,
        thresholdPct: thresholds[item.window],
        severityRatio:
          Math.abs(item.changePct) / Math.max(Math.abs(thresholds[item.window]), 0.01),
      }))
      .sort((a, b) => b.severityRatio - a.severityRatio)[0];

    if (triggered) {
      return {
        level,
        label: LABELS[level],
        guidance: GUIDANCE[level],
        trigger: {
          window: triggered.window,
          changePct: triggered.changePct,
          thresholdPct: triggered.thresholdPct,
        },
        availableWindowCount: available.length,
      };
    }
  }

  return {
    level: "NORMAL",
    label: LABELS.NORMAL,
    guidance: GUIDANCE.NORMAL,
    trigger: null,
    availableWindowCount: available.length,
  };
}
