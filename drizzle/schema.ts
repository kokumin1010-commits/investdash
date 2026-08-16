import {
  boolean,
  decimal,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { BROKERS, MARKETS } from "../shared/investing";

/*
 * broker / market の候補は shared/investing.ts の定数を唯一の出典とする。
 * ここで文字列を再掲すると、口座や市場を追加したときにスキーマ側の更新が
 * 漏れて「型は通るが DB が受け付けない」状態になるため、定数から生成する。
 */
const BROKER_ENUM = BROKERS as unknown as [(typeof BROKERS)[number], ...(typeof BROKERS)[number][]];
const MARKET_ENUM = MARKETS as unknown as [(typeof MARKETS)[number], ...(typeof MARKETS)[number][]];
/**
 * Core user table backing auth flow.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** 意思決定シグナルの種別 */
export const SIGNAL_VALUES = ["ADD", "HOLD", "WATCH", "REDUCE", "EXIT"] as const;
export type SignalAction = (typeof SIGNAL_VALUES)[number];

/**
 * 保有ポジション。1 ユーザー × 1 銘柄で 1 行を維持する。
 * 金額は文字列 decimal で保持し、計算時に Number へ変換する。
 */
export const holdings = mysqlTable(
  "holdings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** Yahoo Finance シンボル（例: 7270.T / AAPL） */
    symbol: varchar("symbol", { length: 24 }).notNull(),
    /** 証券コード（日本株は 4 桁、米国株はティッカー） */
    tickerCode: varchar("tickerCode", { length: 16 }).notNull(),
    /** 表示名（ユーザー確認済みの名称。日本語可） */
    name: varchar("name", { length: 160 }).notNull(),
    market: mysqlEnum("market", MARKET_ENUM).default("JP").notNull(),
    currency: varchar("currency", { length: 8 }).default("JPY").notNull(),
    /** どの証券プラットフォームで保有しているか */
    broker: mysqlEnum("broker", BROKER_ENUM)
      .default("other")
      .notNull(),
    /** 保有株数 */
    quantity: decimal("quantity", { precision: 20, scale: 4 }).notNull(),
    /** 取得単価 */
    avgCost: decimal("avgCost", { precision: 20, scale: 4 }).notNull(),
    /** 直近取得した現在値（キャッシュ） */
    currentPrice: decimal("currentPrice", { precision: 20, scale: 4 }),
    /** 前日終値（日次変動率算出用） */
    previousClose: decimal("previousClose", { precision: 20, scale: 4 }),
    fiftyTwoWeekHigh: decimal("fiftyTwoWeekHigh", { precision: 20, scale: 4 }),
    fiftyTwoWeekLow: decimal("fiftyTwoWeekLow", { precision: 20, scale: 4 }),
    /** Yahoo Finance の英語セクター名 */
    sector: varchar("sector", { length: 80 }),
    industry: varchar("industry", { length: 120 }),
    /** 事業概要（プロファイル API から取得） */
    businessSummary: text("businessSummary"),
    website: varchar("website", { length: 255 }),
    /**
     * 1 株あたりの年間配当（現地通貨・税引前）。
     * 直近 12 か月の支払実績を合計したもので、株式分割の補正済み。
     * 0 は無配、null は未取得を意味するので区別して扱う。
     */
    annualDividend: decimal("annualDividend", { precision: 20, scale: 6 }),
    /** 直近 12 か月の配当支払回数（年 4 回なら四半期配当と分かる） */
    dividendCount: int("dividendCount"),
    /**
     * 特別配当（記念配当）が含まれているか。
     * 含まれる場合、年間配当は一時的に多く、来期も続くとは限らない。
     */
    hasSpecialDividend: boolean("hasSpecialDividend").default(false),
    /**
     * 特別配当を除いた年間配当の推定（現地通貨）。
     * 特別配当がなければ annualDividend と同じ値になる。
     */
    recurringDividend: decimal("recurringDividend", { precision: 20, scale: 6 }),
    /** 最後に配当が支払われた日（権利落ち日） */
    lastDividendDate: timestamp("lastDividendDate"),
    /** 最後の 1 回あたりの配当額（現地通貨） */
    lastDividendAmount: decimal("lastDividendAmount", { precision: 20, scale: 6 }),
    dividendUpdatedAt: timestamp("dividendUpdatedAt"),
    priceUpdatedAt: timestamp("priceUpdatedAt"),
    profileUpdatedAt: timestamp("profileUpdatedAt"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userSymbolIdx: index("holdings_user_symbol_idx").on(table.userId, table.symbol),
    /**
     * 同一銘柄を複数の証券口座で保有できる（例: ヤクルトを moomoo と楽天の両方で持つ）。
     * 保有の一意性は「ユーザー + シンボル + 口座」で判断するため、この組み合わせで引く。
     */
    userSymbolBrokerIdx: index("holdings_user_symbol_broker_idx").on(
      table.userId,
      table.symbol,
      table.broker
    ),
  })
);

export type Holding = typeof holdings.$inferSelect;
export type InsertHolding = typeof holdings.$inferInsert;

/**
 * 企業投資カード。保有銘柄 1 件に対して 1 枚。
 * 「なぜ買ったのか」を忘れないための記録層。
 */
export const investmentCards = mysqlTable(
  "investmentCards",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    holdingId: int("holdingId"),
    /** 保有と切り離しても引けるようシンボルも保持 */
    symbol: varchar("symbol", { length: 24 }).notNull(),
    /** 買付理由 */
    buyReason: text("buyReason"),
    /** コア投資ロジック */
    coreThesis: text("coreThesis"),
    /** バリュエーション前提 */
    valuationAssumption: text("valuationAssumption"),
    /** 想定フェアバリュー（1 株あたり） */
    fairValue: decimal("fairValue", { precision: 20, scale: 4 }),
    /** 主要決算数値（自由記述） */
    keyFinancials: text("keyFinancials"),
    /** エグジット条件 */
    exitConditions: text("exitConditions"),
    /** 想定リスク */
    risks: text("risks"),
    /** 投資期間の想定 */
    horizon: varchar("horizon", { length: 80 }),
    /** 確信度 1-5 */
    conviction: int("conviction"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userSymbolIdx: index("cards_user_symbol_idx").on(table.userId, table.symbol),
  })
);

export type InvestmentCard = typeof investmentCards.$inferSelect;
export type InsertInvestmentCard = typeof investmentCards.$inferInsert;

/**
 * ニュース記事と AI によるセンチメント評価。
 */
export const newsItems = mysqlTable(
  "newsItems",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    symbol: varchar("symbol", { length: 24 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    url: varchar("url", { length: 1024 }).notNull(),
    /** 重複排除キー（url のハッシュ） */
    urlHash: varchar("urlHash", { length: 64 }).notNull(),
    source: varchar("source", { length: 160 }),
    publishedAt: timestamp("publishedAt"),
    /** AI 判定：POSITIVE / NEGATIVE / NEUTRAL */
    sentiment: mysqlEnum("sentiment", ["POSITIVE", "NEGATIVE", "NEUTRAL"]),
    /** 影響度 0-100 */
    impactScore: int("impactScore"),
    /** AI による日本語要約 */
    summary: text("summary"),
    /** 判定理由 */
    reasoning: text("reasoning"),
    analyzedAt: timestamp("analyzedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userSymbolIdx: index("news_user_symbol_idx").on(table.userId, table.symbol),
    hashIdx: index("news_hash_idx").on(table.userId, table.urlHash),
  })
);

export type NewsItem = typeof newsItems.$inferSelect;
export type InsertNewsItem = typeof newsItems.$inferInsert;

/**
 * AI 意思決定シグナル。銘柄ごとに履歴として蓄積する。
 */
export const signals = mysqlTable(
  "signals",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    symbol: varchar("symbol", { length: 24 }).notNull(),
    action: mysqlEnum("action", SIGNAL_VALUES).notNull(),
    /** 確信度 0-100 */
    confidence: int("confidence"),
    /** 根拠テキスト（日本語） */
    rationale: text("rationale").notNull(),
    /** 判定に使った各要素のスコアと内訳 */
    factors: json("factors"),
    /** 生成時点の価格・損益率スナップショット */
    priceAtSignal: decimal("priceAtSignal", { precision: 20, scale: 4 }),
    pnlPctAtSignal: decimal("pnlPctAtSignal", { precision: 10, scale: 4 }),
    /** watchlist 銘柄のシグナルか */
    scope: mysqlEnum("scope", ["HOLDING", "WATCHLIST"]).default("HOLDING").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userSymbolIdx: index("signals_user_symbol_idx").on(table.userId, table.symbol),
  })
);

export type Signal = typeof signals.$inferSelect;
export type InsertSignal = typeof signals.$inferInsert;

/**
 * ウォッチリスト（購入検討銘柄）。
 */
export const watchlist = mysqlTable(
  "watchlist",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    symbol: varchar("symbol", { length: 24 }).notNull(),
    tickerCode: varchar("tickerCode", { length: 16 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    market: mysqlEnum("market", MARKET_ENUM).default("JP").notNull(),
    currency: varchar("currency", { length: 8 }).default("JPY").notNull(),
    currentPrice: decimal("currentPrice", { precision: 20, scale: 4 }),
    previousClose: decimal("previousClose", { precision: 20, scale: 4 }),
    /** 目標買付価格 */
    targetPrice: decimal("targetPrice", { precision: 20, scale: 4 }),
    /** 買付条件 */
    buyConditions: text("buyConditions"),
    /** 注目理由 */
    watchReason: text("watchReason"),
    /** 想定投資額 */
    plannedAmount: decimal("plannedAmount", { precision: 20, scale: 2 }),
    priority: mysqlEnum("priority", ["HIGH", "MEDIUM", "LOW"]).default("MEDIUM").notNull(),
    sector: varchar("sector", { length: 80 }),
    industry: varchar("industry", { length: 120 }),
    priceUpdatedAt: timestamp("priceUpdatedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userSymbolIdx: index("watchlist_user_symbol_idx").on(table.userId, table.symbol),
  })
);

export type WatchlistItem = typeof watchlist.$inferSelect;
export type InsertWatchlistItem = typeof watchlist.$inferInsert;

/**
 * スクリーンショット取込ジョブ。OCR 結果をユーザーが承認するまで保持する。
 */
export const importJobs = mysqlTable(
  "importJobs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** S3 上の画像キーと URL */
    fileKey: varchar("fileKey", { length: 512 }),
    imageUrl: varchar("imageUrl", { length: 1024 }),
    status: mysqlEnum("status", ["PENDING", "PARSED", "FAILED", "APPLIED"])
      .default("PENDING")
      .notNull(),
    /** OCR 抽出結果（行の配列） */
    parsed: json("parsed"),
    /** 口座サマリー（純資産・預り金など） */
    accountSummary: json("accountSummary"),
    errorMessage: text("errorMessage"),
    appliedCount: int("appliedCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdx: index("importjobs_user_idx").on(table.userId),
  })
);

export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = typeof importJobs.$inferInsert;

/**
 * 価格履歴スナップショット。ポートフォリオ推移グラフ用。
 */
export const portfolioSnapshots = mysqlTable(
  "portfolioSnapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** 基準通貨 JPY 換算の総評価額 */
    totalValue: decimal("totalValue", { precision: 20, scale: 2 }).notNull(),
    totalCost: decimal("totalCost", { precision: 20, scale: 2 }).notNull(),
    positionCount: int("positionCount").notNull(),
    capturedAt: timestamp("capturedAt").defaultNow().notNull(),
  },
  table => ({
    userIdx: index("snapshots_user_idx").on(table.userId),
  })
);

export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;

/**
 * ユーザー設定（為替レート・集中度しきい値など）。
 */
export const userSettings = mysqlTable("userSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  /** 表示基準通貨 */
  baseCurrency: varchar("baseCurrency", { length: 8 }).default("JPY").notNull(),
  /** USD/JPY レート（手動または自動取得） */
  usdJpyRate: decimal("usdJpyRate", { precision: 12, scale: 4 }).default("150.0000").notNull(),
  /**
   * SGD/JPY レート（手動または自動取得）。
   * IBKR シンガポール口座は基軸通貨が SGD で、借入額・維持証拠金も SGD 建て。
   * SGX 上場銘柄の評価額も SGD なので、円換算に直接レートが必要になる。
   */
  sgdJpyRate: decimal("sgdJpyRate", { precision: 12, scale: 4 }).default("115.0000").notNull(),
  /**
   * 為替レートを株価更新と同時に自動取得するか。
   * false にすると usdJpyRate / sgdJpyRate の手動設定値を使い続ける。
   */
  fxAutoUpdate: boolean("fxAutoUpdate").default(true).notNull(),
  /** 為替レートを最後に自動取得できた時刻。null なら未取得（手動値のまま） */
  fxRateUpdatedAt: timestamp("fxRateUpdatedAt"),
  /** 単一銘柄の集中度アラートしきい値（%） */
  concentrationThreshold: int("concentrationThreshold").default(20).notNull(),
  /** 単一セクターの集中度アラートしきい値（%） */
  sectorConcentrationThreshold: int("sectorConcentrationThreshold").default(35).notNull(),
  /** 現金残高（口座サマリーから） */
  cashBalance: decimal("cashBalance", { precision: 20, scale: 2 }).default("0.00").notNull(),
  autoNewsEnabled: boolean("autoNewsEnabled").default(true).notNull(),
  lastPriceSyncAt: timestamp("lastPriceSyncAt"),
  lastNewsSyncAt: timestamp("lastNewsSyncAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserSettings = typeof userSettings.$inferSelect;
export type InsertUserSettings = typeof userSettings.$inferInsert;

/**
 * 証券口座ごとの現金残高・借入・証拠金。
 *
 * 現物取引のみの口座（楽天 iSPEED、moomoo）では現金残高だけを持つが、
 * 信用取引を行う口座（IBKR）では借入がマイナスの現金として現れる。
 * 株式の時価をそのまま資産計上すると借入分だけ過大になるため、
 * 口座単位で負債を保持して純資産を算出できるようにする。
 *
 * 金額は口座の基軸通貨で保持し、`currency` に通貨コードを持つ。
 * 円換算はレートを用いて表示時に行う。
 */
export const brokerBalances = mysqlTable(
  "brokerBalances",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** 対象の証券プラットフォーム */
    broker: mysqlEnum("broker", BROKER_ENUM).notNull(),
    /** この口座の基軸通貨（IBKR シンガポールは SGD） */
    currency: varchar("currency", { length: 8 }).default("JPY").notNull(),
    /**
     * 現金残高。マイナスなら借入（信用取引の建玉分）。
     * IBKR の「現金」欄をそのまま入れる。
     */
    cashBalance: decimal("cashBalance", { precision: 20, scale: 2 }).default("0.00").notNull(),
    /**
     * 維持証拠金。追証の判定に使う。信用取引を使わない口座では 0。
     */
    maintenanceMargin: decimal("maintenanceMargin", { precision: 20, scale: 2 })
      .default("0.00")
      .notNull(),
    /** 月初来の支払利息（マイナス表記）。借入コストの把握に使う */
    interestMtd: decimal("interestMtd", { precision: 20, scale: 2 }).default("0.00").notNull(),
    /**
     * 借入の通貨別内訳（JSON）。
     * 例: {"JPY": -228720494.5, "SGD": 6585.22, "USD": 2495.02}
     * どの通貨で借りているかは金利と為替リスクの判断に必要。
     */
    currencyBreakdown: text("currencyBreakdown"),
    /** この情報を記録した時点（スクショの日時） */
    capturedAt: timestamp("capturedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userBrokerIdx: index("brokerBalances_user_broker_idx").on(table.userId, table.broker),
  })
);

export type BrokerBalance = typeof brokerBalances.$inferSelect;
export type InsertBrokerBalance = typeof brokerBalances.$inferInsert;

/**
 * 簡易パスコード認証。
 *
 * Manus OAuth の代わりに、4〜6 桁の数字だけでアクセスできるようにする。
 * 単一オーナー専用のツールなので 1 行のみを想定し、`ownerUserId` で
 * 既存の users 行（データの所有者）に紐付ける。
 *
 * パスコードは平文では保存せず、ソルト付き SHA-256 ハッシュで保持する。
 */
export const passcodeAuth = mysqlTable("passcodeAuth", {
  id: int("id").autoincrement().primaryKey(),
  /** このパスコードでアクセスできるデータの所有者（users.id） */
  ownerUserId: int("ownerUserId").notNull().unique(),
  /** ソルト付き SHA-256 ハッシュ（hex） */
  passcodeHash: varchar("passcodeHash", { length: 128 }).notNull(),
  /** ハッシュ計算に使うソルト（hex） */
  passcodeSalt: varchar("passcodeSalt", { length: 64 }).notNull(),
  /** 連続失敗回数。成功時に 0 に戻す */
  failedAttempts: int("failedAttempts").default(0).notNull(),
  /** ロック解除時刻。これを過ぎるまで検証を拒否する */
  lockedUntil: timestamp("lockedUntil"),
  lastUnlockedAt: timestamp("lastUnlockedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PasscodeAuth = typeof passcodeAuth.$inferSelect;
export type InsertPasscodeAuth = typeof passcodeAuth.$inferInsert;
