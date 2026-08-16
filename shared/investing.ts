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

export type Market = "JP" | "US" | "SG" | "OTHER";

/* ------------------------------------------------------------------ *
 * 証券プラットフォーム（どの口座で保有しているか）
 * ------------------------------------------------------------------ */

export const BROKERS = ["moomoo_jp", "rakuten_ispeed", "futu", "ibkr", "sc_sg", "other"] as const;
export type Broker = (typeof BROKERS)[number];

export const BROKER_LABELS: Record<Broker, string> = {
  moomoo_jp: "moomoo 日本版",
  rakuten_ispeed: "楽天証券 iSPEED",
  futu: "富途牛牛 / Futu",
  ibkr: "IBKR シンガポール",
  sc_sg: "渣打銀行 シンガポール",
  other: "その他",
};

/** 一覧やカードに載せる短い表記 */
export const BROKER_SHORT: Record<Broker, string> = {
  moomoo_jp: "moomoo",
  rakuten_ispeed: "楽天",
  futu: "富途",
  ibkr: "IBKR",
  sc_sg: "渣打",
  other: "その他",
};

/**
 * プラットフォームごとの配色。各社のブランドカラーに寄せ、
 * 一覧をざっと眺めたときに口座の違いが色で判別できるようにする。
 */
export const BROKER_STYLES: Record<Broker, string> = {
  moomoo_jp: "bg-orange-500/15 text-orange-600 border-orange-500/30 dark:text-orange-400",
  rakuten_ispeed: "bg-red-500/15 text-red-600 border-red-500/30 dark:text-red-400",
  futu: "bg-blue-500/15 text-blue-600 border-blue-500/30 dark:text-blue-400",
  ibkr: "bg-violet-500/15 text-violet-600 border-violet-500/30 dark:text-violet-400",
  sc_sg: "bg-teal-500/15 text-teal-700 border-teal-500/30 dark:text-teal-400",
  other: "bg-muted text-muted-foreground border-border",
};

/** 円グラフなど Tailwind クラスが使えない場所向けの実色 */
export const BROKER_HEX: Record<Broker, string> = {
  moomoo_jp: "#f97316",
  rakuten_ispeed: "#dc2626",
  futu: "#2563eb",
  ibkr: "#7c3aed",
  sc_sg: "#0d9488",
  other: "#94a3b8",
};

/**
 * 口座の基軸通貨。表示や検算の基準になる。
 * IBKR シンガポールは SGD 建てで集計される。
 */
export const BROKER_BASE_CURRENCY: Record<Broker, string> = {
  moomoo_jp: "JPY",
  rakuten_ispeed: "JPY",
  futu: "HKD",
  ibkr: "SGD",
  sc_sg: "SGD",
  other: "JPY",
};

export function brokerLabel(broker?: string | null): string {
  if (!broker) return BROKER_LABELS.other;
  return BROKER_LABELS[broker as Broker] ?? BROKER_LABELS.other;
}

export function brokerShort(broker?: string | null): string {
  if (!broker) return BROKER_SHORT.other;
  return BROKER_SHORT[broker as Broker] ?? BROKER_SHORT.other;
}

export function brokerStyle(broker?: string | null): string {
  if (!broker) return BROKER_STYLES.other;
  return BROKER_STYLES[broker as Broker] ?? BROKER_STYLES.other;
}

export function brokerHex(broker?: string | null): string {
  if (!broker) return BROKER_HEX.other;
  return BROKER_HEX[broker as Broker] ?? BROKER_HEX.other;
}

/** OCR のフォーマット ID を保有銘柄の broker 値へ変換する */
export function brokerFromFormatId(formatId?: string | null): Broker {
  switch (formatId) {
    case "moomoo_jp":
      return "moomoo_jp";
    case "rakuten_ispeed":
      return "rakuten_ispeed";
    case "futu":
      return "futu";
    case "ibkr":
      return "ibkr";
    case "sc_sg":
      return "sc_sg";
    default:
      return "other";
  }
}

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
    /*
     * Yahoo Finance のサフィックスから市場を判定する。
     * .T = 東証、.SI = シンガポール取引所（SGX）。
     */
    const market: Market = suffix === "T" ? "JP" : suffix === "SI" ? "SG" : "OTHER";
    return { symbol: input, tickerCode: code, market };
  }

  // 4桁（または末尾がアルファベットの日本株コード、例: 130A）
  if (/^[0-9]{4}$/.test(input) || /^[0-9]{3}[0-9A-Z]$/.test(input)) {
    return { symbol: `${input}.T`, tickerCode: input, market: "JP" };
  }

  return { symbol: input, tickerCode: input, market: "US" };
}

export function marketLabel(market: Market): string {
  if (market === "JP") return "日本株";
  if (market === "US") return "米国株";
  if (market === "SG") return "シンガポール株";
  return "その他";
}

/** 市場ごとの取引通貨 */
export const MARKET_CURRENCY: Record<Market, string> = {
  JP: "JPY",
  US: "USD",
  SG: "SGD",
  OTHER: "USD",
};

/**
 * 証券アプリが表示する取引所コードから市場・通貨・Yahoo Finance シンボルを決める。
 *
 * IBKR は 1 つの口座に複数国の銘柄が混在し、銘柄コードの隣に取引所を表示する。
 * 例: `ORCL NYSE`（米ドル）/ `7203 TSEJ`（円）/ `D05 SGX`（シンガポールドル）。
 * コードの形だけでは通貨を決められないため、取引所コードを手がかりにする。
 */
export function resolveByExchange(
  tickerCode: string,
  exchange: string
): { symbol: string; tickerCode: string; market: Market; currency: string } {
  const code = tickerCode.trim().toUpperCase();
  const ex = exchange.trim().toUpperCase();

  // 東証。Yahoo Finance では 4 桁コード + .T
  if (ex === "TSEJ" || ex === "TSE" || ex === "JPX") {
    return { symbol: `${code}.T`, tickerCode: code, market: "JP", currency: "JPY" };
  }

  // シンガポール取引所。Yahoo Finance では英数字コード + .SI
  if (ex === "SGX" || ex === "SES") {
    return { symbol: `${code}.SI`, tickerCode: code, market: "SG", currency: "SGD" };
  }

  // 米国市場はサフィックスなし
  if (ex.startsWith("NYSE") || ex.startsWith("NASDAQ") || ex === "AMEX" || ex === "ARCA") {
    return { symbol: code, tickerCode: code, market: "US", currency: "USD" };
  }

  // 未知の取引所は既存の推測ロジックに委ねる
  const guessed = normalizeSymbol(code);
  return { ...guessed, currency: MARKET_CURRENCY[guessed.market] };
}

/**
 * 国・市場別の表示色。証券口座の色（オレンジ・赤・青）と混同しないよう、
 * 意図的に別の色相（緑系・藍系）を選んでいる。
 */
export const MARKET_HEX: Record<Market, string> = {
  JP: "#0f766e",
  US: "#4338ca",
  SG: "#b45309",
  OTHER: "#94a3b8",
};

export function marketHex(market?: string | null): string {
  if (!market) return MARKET_HEX.OTHER;
  return MARKET_HEX[market as Market] ?? MARKET_HEX.OTHER;
}

/** 市場フィルタの選択肢。null は「すべて」 */
export const MARKETS: readonly Market[] = ["JP", "US", "SG", "OTHER"] as const;

/* ------------------------------------------------------------------ *
 * 信用取引（レバレッジ）の追証リスク表示
 *
 * 判定ロジック本体は server/services/leverage.ts にある。ここには
 * 画面表示用のラベルと配色だけを置く（クライアントはサーバーコードを
 * import できないため）。
 * ------------------------------------------------------------------ */

export type MarginRisk = "SAFE" | "CAUTION" | "WARNING" | "DANGER";

export const MARGIN_RISK_LABELS: Record<MarginRisk, string> = {
  SAFE: "余力あり",
  CAUTION: "注意",
  WARNING: "警戒",
  DANGER: "危険",
};

/** 危険度が上がるほど強い色にする。損益の赤緑とは別系統（緑→琥珀→橙→赤）で表す */
export const MARGIN_RISK_STYLES: Record<MarginRisk, string> = {
  SAFE: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  CAUTION: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  WARNING: "border-orange-500/50 text-orange-600 dark:text-orange-400",
  DANGER: "border-red-500/60 text-red-600 dark:text-red-400",
};

/* ------------------------------------------------------------------ *
 * 配当と借入金利の比較（キャリー判定）
 *
 * 借金をして株を買っている場合、配当で利息を賄えているかどうかで
 * 「持っているだけで現金が増えるか減るか」が変わる。
 * 判定ロジックは server/services/marginInterest.ts にある。
 * ------------------------------------------------------------------ */

export type CarryVerdictCode = "POSITIVE" | "THIN" | "NEGATIVE";

export const CARRY_VERDICT_LABELS: Record<CarryVerdictCode, string> = {
  POSITIVE: "配当で金利を賄えている",
  THIN: "ぎりぎり賄えている",
  NEGATIVE: "配当だけでは足りない",
};

export const CARRY_VERDICT_STYLES: Record<CarryVerdictCode, string> = {
  POSITIVE: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  THIN: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  NEGATIVE: "border-orange-500/50 text-orange-600 dark:text-orange-400",
};

/** 判定の意味を一文で説明する。数字だけでは何をすべきか伝わらないため */
export const CARRY_VERDICT_NOTES: Record<CarryVerdictCode, string> = {
  POSITIVE:
    "受け取る配当が支払う利息を上回っているため、保有を続けるだけで現金が増えます。",
  THIN:
    "配当と利息がほぼ同額です。減配や金利上昇があると逆転するため、余裕は小さい状態です。",
  NEGATIVE:
    "配当だけでは利息を賄えていません。差額は株価の上昇で回収する必要があります。",
};
/**
 * URL クエリの market パラメータを検証して市場コードに変換する。
 * 不正な値や未指定は null（すべて表示）とする。
 */
export function parseMarketFilter(value: string | null | undefined): Market | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  return (MARKETS as readonly string[]).includes(upper) ? (upper as Market) : null;
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
