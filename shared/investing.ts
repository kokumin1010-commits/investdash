/**
 * 投資ドメインの共通定義。クライアント／サーバー双方から参照する。
 */

export const SIGNAL_ACTIONS = ["ADD", "HOLD", "WATCH", "REDUCE", "EXIT"] as const;
export type SignalAction = (typeof SIGNAL_ACTIONS)[number];

export const SIGNAL_LABELS: Record<SignalAction, string> = {
  ADD: "買い増し検討",
  HOLD: "継続保有",
  WATCH: "注視",
  REDUCE: "一部売却検討",
  EXIT: "撤退検討",
};

export const SIGNAL_SHORT: Record<SignalAction, string> = {
  ADD: "ADD",
  HOLD: "HOLD",
  WATCH: "WATCH",
  REDUCE: "REDUCE",
  EXIT: "EXIT",
};

/** バッジ色（Tailwind クラス）。トークンに依存せず視認性を担保する。 */
export const SIGNAL_STYLES: Record<SignalAction, string> = {
  ADD: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  HOLD: "bg-sky-500/15 text-sky-600 border-sky-500/30 dark:text-sky-400",
  WATCH: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  REDUCE: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400",
  EXIT: "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
};

export type Sentiment = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  POSITIVE: "ポジティブ",
  NEGATIVE: "ネガティブ",
  NEUTRAL: "中立",
};

export const SENTIMENT_STYLES: Record<Sentiment, string> = {
  POSITIVE: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400",
  NEGATIVE: "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
  NEUTRAL: "bg-muted text-muted-foreground border-border",
};

export function sentimentLabel(s?: Sentiment | string | null): string {
  if (!s) return "未分析";
  return SENTIMENT_LABELS[s as Sentiment] ?? "未分析";
}

/** 影響度スコアの区分ラベル */
export function impactLabel(score?: number | null): string {
  if (score === null || score === undefined) return "—";
  if (score >= 80) return "非常に高い";
  if (score >= 50) return "高い";
  if (score >= 20) return "中程度";
  return "低い";
}

export const WATCH_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type WatchPriority = (typeof WATCH_PRIORITIES)[number];

export const PRIORITY_LABELS: Record<WatchPriority, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

export const PRIORITY_STYLES: Record<WatchPriority, string> = {
  HIGH: "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
  MEDIUM: "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400",
  LOW: "bg-muted text-muted-foreground border-border",
};

export type Market = "JP" | "US" | "OTHER";

/** Yahoo Finance の英語セクター名 → 日本語表示名 */
export const SECTOR_JA: Record<string, string> = {
  Technology: "情報技術",
  "Consumer Cyclical": "一般消費財",
  "Consumer Defensive": "生活必需品",
  Industrials: "資本財・工業",
  Healthcare: "ヘルスケア",
  "Financial Services": "金融",
  Energy: "エネルギー",
  "Basic Materials": "素材",
  "Communication Services": "通信サービス",
  Utilities: "公共事業",
  "Real Estate": "不動産",
};

export function sectorJa(sector?: string | null): string {
  if (!sector) return "未分類";
  return SECTOR_JA[sector] ?? sector;
}

/** セクター別の配色（円グラフ・凡例で共通利用） */
export const SECTOR_COLORS = [
  "#2f6f4e",
  "#c2703d",
  "#3d6d8f",
  "#8f6d3d",
  "#6d4a7c",
  "#3f7f7a",
  "#a8553f",
  "#4b5f8a",
  "#7c6a3d",
  "#5a7c4b",
  "#8a4b6a",
  "#5f5f5f",
] as const;

/**
 * ユーザー入力（4桁コード / ティッカー / .T 付き）を Yahoo Finance シンボルに正規化する。
 */
export function normalizeSymbol(raw: string): { symbol: string; tickerCode: string; market: Market } {
  const input = raw.trim().toUpperCase();
  if (!input) return { symbol: "", tickerCode: "", market: "JP" };

  // すでにサフィックス付き
  if (input.includes(".")) {
    const [code, suffix] = input.split(".");
    const market: Market = suffix === "T" ? "JP" : "OTHER";
    return { symbol: input, tickerCode: code, market };
  }

  // 4桁（または末尾がアルファベットの日本株コード、例: 130A）
  if (/^[0-9]{4}$/.test(input) || /^[0-9]{3}[0-9A-Z]$/.test(input)) {
    return { symbol: `${input}.T`, tickerCode: input, market: "JP" };
  }

  return { symbol: input, tickerCode: input, market: "US" };
}

export function marketLabel(market: Market): string {
  return market === "JP" ? "日本株" : market === "US" ? "米国株" : "その他";
}

/** 通貨付きで金額を整形する */
export function formatMoney(
  value: number | null | undefined,
  currency = "JPY",
  opts: { compact?: boolean } = {}
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const fractionDigits = currency === "JPY" ? 0 : 2;
  if (opts.compact && Math.abs(value) >= 10000) {
    return new Intl.NumberFormat("ja-JP", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** 免責文（全画面共通で使用） */
export const DISCLAIMER =
  "本アプリが表示する分析・シグナルは、公開情報を自動整理した情報提供であり、投資助言ではありません。最終的な投資判断はご自身の責任で行ってください。";
