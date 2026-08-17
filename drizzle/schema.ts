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
    recurringDividend: decimal("recurringDividend", { precision: 18, scale: 6 }),
    /**
     * 月別の 1 株あたり配当額を JSON 配列で保存する（12 要素、添字 0 = 1 月）。
     * 月ごとに 12 列を作るより、配列 1 列の方がスキーマが単純で、
     * 「何月に集中しているか」を出す用途では十分に扱える。
     */
    monthlyDividends: json("monthlyDividends").$type<number[]>(),
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
    /**
     * 借入（信用取引）の残高。借入があると総評価額は実質の資産より大きく出るため、
     * 純資産の推移を後から復元できるように記録時点の値を残す。
     */
    borrowed: decimal("borrowed", { precision: 20, scale: 2 }),
    /** 借入を差し引いた純資産。totalValue - borrowed + 現金 */
    netAssets: decimal("netAssets", { precision: 20, scale: 2 }),
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
   * 1 HKD が何円か。富途香港口座の港股・港元基金の円換算に使う。
   */
  hkdJpyRate: decimal("hkdJpyRate", { precision: 12, scale: 4 }).default("19.0000").notNull(),
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

/**
 * 利息で増える現金性資産（貨幣市場基金・現金宝など）。
 *
 * 富途香港の「基金」タブにある貨幣市場基金は、株式ではなく現金に近い。
 * 年約 3.4% の利息が毎日付いて複利で増えるため、株式の含み損益に混ぜると
 * 「株で儲かったのか利息で増えたのか」が区別できなくなる。
 *
 * 株式（holdings）とは別のテーブルで持ち、収益も配当とは分けて集計する。
 * 配当は減配・無配のリスクがあるが、こちらは元本がほぼ動かず利率だけが変わる
 * という性質の違いがあり、同じ「収入」として足し合わせると判断を誤るため。
 */
export const interestAssets = mysqlTable(
  "interestAssets",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** どの証券口座で持っているか */
    broker: mysqlEnum("broker", BROKER_ENUM).notNull(),
    /** 商品名（例: 易方達(香港)美元貨幣市場基金） */
    name: varchar("name", { length: 160 }).notNull(),
    /** 建玉の通貨（USD / HKD / JPY など） */
    currency: varchar("currency", { length: 8 }).notNull(),
    /** 現在の評価額（現地通貨） */
    amount: decimal("amount", { precision: 20, scale: 2 }).notNull(),
    /**
     * 年換算利回り（%）。日次で利息が付く商品は変動するため、
     * 記録時点の目安として保持する。
     */
    annualRatePct: decimal("annualRatePct", { precision: 8, scale: 4 }),
    /** 前日の受取利息（現地通貨）。実績から利回りを検算するために持つ */
    dailyIncome: decimal("dailyIncome", { precision: 20, scale: 4 }),
    /** 累計収益（現地通貨）。買った時からの通算 */
    cumulativeIncome: decimal("cumulativeIncome", { precision: 20, scale: 2 }),
    /**
     * 利息が元本に組み入れられるか（複利）。
     * 複利なら将来の見込み額を複利で計算する。
     */
    compounding: boolean("compounding").default(true).notNull(),
    /** この情報を記録した時点（スクショの日時） */
    capturedAt: timestamp("capturedAt").defaultNow().notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userBrokerIdx: index("interestAssets_user_broker_idx").on(table.userId, table.broker),
  })
);
export type InterestAsset = typeof interestAssets.$inferSelect;
export type InsertBrokerBalance = typeof brokerBalances.$inferInsert;
export type InsertInterestAsset = typeof interestAssets.$inferInsert;

/**
 * 買い増しプラン（価格帯ごとの行動）。
 *
 * ユーザーは「この値段になったらこうする」という段組みで判断している。
 * 例（Marvell）:
 *   160〜170 ドル → 持有、急いで買い増さない
 *   145〜152 ドル → 小幅追加
 *   125〜138 ドル → ファンダメンタルズに問題がなければ主力で買い増す
 *   110 ドル以下  → 大口顧客の喪失や AI 受注の悪化を確認してから判断
 *
 * 目標価格を 1 点だけ持つ設計では表現できないため、銘柄ごとに複数段を持つ。
 * 段は AI が自動提案し、ユーザーが必要なら数字を直せる。
 */
export const priceBandPlans = mysqlTable(
  "priceBandPlans",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /**
     * 対象銘柄。holdings.id ではなく symbol で紐付ける。
     * 同じ銘柄を複数口座で持っていてもプランは 1 つで足りるため。
     */
    symbol: varchar("symbol", { length: 24 }).notNull(),
    /** 価格帯の通貨（銘柄の現地通貨）。換算した数字で判断すると注文に使えない */
    currency: varchar("currency", { length: 8 }).notNull(),
    /**
     * 保有銘柄の買い増し判断か、未保有銘柄の新規購入判断か。
     * 同じ仕組みを両方に使えるようにする。
     */
    scope: mysqlEnum("scope", ["HOLDING", "WATCHLIST"]).default("HOLDING").notNull(),
    /** 全体の考え方。なぜこの段組みにしたかの説明 */
    strategy: text("strategy"),
    /** 提案の根拠。数字だけ出しても信用できないため必ず持つ */
    rationale: text("rationale"),
    /** 生成に使ったモデル。後から精度を振り返るために残す */
    model: varchar("model", { length: 64 }),
    /** AI 提案をユーザーが手で直したか */
    editedByUser: boolean("editedByUser").default(false).notNull(),
    generatedAt: timestamp("generatedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userSymbolIdx: index("priceBandPlans_user_symbol_idx").on(table.userId, table.symbol),
  })
);

export type PriceBandPlan = typeof priceBandPlans.$inferSelect;
export type InsertPriceBandPlan = typeof priceBandPlans.$inferInsert;

/**
 * 価格帯の 1 段。
 *
 * 上限・下限はどちらも省略可能にする。「110 ドル以下」のように片側しか
 * 決まっていない段が実際に存在するため。
 */
export const priceBands = mysqlTable(
  "priceBands",
  {
    id: int("id").autoincrement().primaryKey(),
    planId: int("planId").notNull(),
    /** 帯の下限（この値以上）。null なら下限なし */
    lowerPrice: decimal("lowerPrice", { precision: 20, scale: 4 }),
    /** 帯の上限（この値以下）。null なら上限なし */
    upperPrice: decimal("upperPrice", { precision: 20, scale: 4 }),
    /**
     * その帯での行動の種類。表示の色分けと並び順に使う。
     * HOLD=様子見 / ADD_SMALL=小幅追加 / ADD_MAIN=主力で買い増す /
     * VERIFY=条件を確認してから判断 / REDUCE=減らす
     */
    action: mysqlEnum("action", ["HOLD", "ADD_SMALL", "ADD_MAIN", "VERIFY", "REDUCE"]).notNull(),
    /** ユーザーの言葉に近い行動の記述（例: 基本面未変時に主力で買い増す） */
    actionLabel: varchar("actionLabel", { length: 160 }).notNull(),
    /** その価格帯をそう判断する理由 */
    reason: text("reason"),
    /**
     * この帯に入ったときに確認すべき項目（JSON 配列）。
     * 例: ["大口顧客の喪失", "AI 受注の悪化"]
     * 帯に入るまでは照合しない（無駄な AI 呼び出しを避けるため）。
     */
    checkItems: json("checkItems").$type<string[]>(),
    /** 想定投資額（現地通貨）。段によって金額が違う */
    plannedAmount: decimal("plannedAmount", { precision: 20, scale: 2 }),
    /** 上の段から順に 0,1,2... 表示順の固定に使う */
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    planIdx: index("priceBands_plan_idx").on(table.planId),
  })
);

export type PriceBand = typeof priceBands.$inferSelect;
export type InsertPriceBand = typeof priceBands.$inferInsert;

/**
 * 確認項目に対するニュース照合の結果。
 *
 * 株価がその帯に入ったときだけ実行する。
 * 「該当情報が見つかったか」「見つかったなら何か」を残し、
 * 買え・売れの断定はしない（判断は本人がする）。
 */
export const bandCheckResults = mysqlTable(
  "bandCheckResults",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    bandId: int("bandId").notNull(),
    /** 確認項目の文言。band 側を編集しても当時の項目が分かるように複製して持つ */
    checkItem: varchar("checkItem", { length: 200 }).notNull(),
    /** 懸念に該当する情報が見つかったか */
    status: mysqlEnum("status", ["CLEAR", "CONCERN", "UNKNOWN"]).notNull(),
    /** 見つかった内容、または「見つからなかった」旨 */
    finding: text("finding").notNull(),
    /** 根拠にしたニュースの件数 */
    sourceCount: int("sourceCount").default(0).notNull(),
    /** 照合時の株価。後から見たときに状況を再現できるように */
    priceAtCheck: decimal("priceAtCheck", { precision: 20, scale: 4 }),
    model: varchar("model", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    bandIdx: index("bandCheckResults_band_idx").on(table.bandId),
  })
);

export type BandCheckResult = typeof bandCheckResults.$inferSelect;
export type InsertBandCheckResult = typeof bandCheckResults.$inferInsert;

/**
 * 買い増しプランの判定が変わった履歴。
 *
 * この画面は月に 1 回程度しか開かない前提のため、その間に株価が
 * 買い増し圏まで下がって戻っていても気付けない。判定が切り替わった
 * 時点を残しておけば「8/20 に打診買い圏に入り 8/25 に抜けた」と
 * 後から分かり、見逃しに気付ける。
 *
 * 株価更新のたびに全銘柄を比べ、前回と判定が違うときだけ 1 行足す。
 * 毎回記録すると 112 銘柄 × 1 日 2 回で年 8 万行になり、
 * かつ「変化した時点」が埋もれて読めなくなる。
 */
export const bandTransitions = mysqlTable(
  "bandTransitions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** 対象銘柄。プランと同じく symbol で紐付ける */
    symbol: varchar("symbol", { length: 24 }).notNull(),
    /**
     * 変化前の行動。初回の記録や、帯の外から入った場合は null。
     * 「null → ADD_SMALL」と「HOLD → ADD_SMALL」は意味が違うため区別する。
     */
    fromAction: mysqlEnum("fromAction", ["HOLD", "ADD_SMALL", "ADD_MAIN", "VERIFY", "REDUCE"]),
    /** 変化前の段の説明。段を編集しても当時の文言が残るよう複製して持つ */
    fromLabel: varchar("fromLabel", { length: 160 }),
    /** 変化後の行動。帯の外に出た場合は null */
    toAction: mysqlEnum("toAction", ["HOLD", "ADD_SMALL", "ADD_MAIN", "VERIFY", "REDUCE"]),
    toLabel: varchar("toLabel", { length: 160 }),
    /**
     * 帯の外にいるか。帯の外は action が null になるので、
     * 「上に抜けた」「下に抜けた」を別に持たないと区別できない。
     */
    outsideDirection: mysqlEnum("outsideDirection", ["ABOVE", "BELOW"]),
    /** 変化を検知したときの株価（現地通貨） */
    price: decimal("price", { precision: 20, scale: 4 }),
    /** 価格帯の通貨。表示のときに単位を間違えないように持つ */
    currency: varchar("currency", { length: 8 }),
    /**
     * 前回の判定からの株価の変化率（%）。
     * 「どれだけ動いて判定が変わったか」が分かる。
     */
    priceChangePct: decimal("priceChangePct", { precision: 10, scale: 4 }),
    /** ユーザーがこの変化を確認したか。未確認のものだけを出せるようにする */
    acknowledgedAt: timestamp("acknowledgedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userSymbolIdx: index("bandTransitions_user_symbol_idx").on(table.userId, table.symbol),
    createdAtIdx: index("bandTransitions_created_idx").on(table.userId, table.createdAt),
  })
);

export type BandTransition = typeof bandTransitions.$inferSelect;
export type InsertBandTransition = typeof bandTransitions.$inferInsert;

/**
 * AI が自動生成するレポート。
 *
 * 画面を月 1 回しか開かない使い方のため、こちらから見に行かなくても
 * 「今週見るべきことがあったか」が分かる形にする。
 *
 * 定期（WEEKLY）と臨時（EARNINGS / NEWS）を同じテーブルに入れる。
 * 定期は「何もなかった」ことにも意味があり（見なくてよいと分かる）、
 * 臨時は出来事が起きた時点で出す必要があるため発行のきっかけが違うが、
 * 読む側は同じ「レポート一覧」として扱いたい。
 */
export const aiReports = mysqlTable(
  "aiReports",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /**
     * WEEKLY   = 定期の定点観測
     * EARNINGS = 決算の前後
     * NEWS     = 重要ニュースが出たとき
     */
    kind: mysqlEnum("kind", ["WEEKLY", "EARNINGS", "NEWS"]).notNull(),
    /** 一覧に出す 1 行。中身を開かなくても要否が判断できる文にする */
    headline: varchar("headline", { length: 300 }).notNull(),
    /** 本文（Markdown） */
    body: text("body").notNull(),
    /**
     * 今回のレポートで扱った銘柄（JSON 配列）。
     * 「この銘柄について何が言われたか」を後から引けるようにする。
     */
    symbols: json("symbols").$type<string[]>(),
    /**
     * 判断を要する項目の件数。0 なら「今回は動く必要なし」。
     * 一覧で件数だけ見て開くかどうか決められるようにする。
     */
    actionCount: int("actionCount").default(0).notNull(),
    /** 対象期間の開始（WEEKLY のみ。臨時は null） */
    periodStart: timestamp("periodStart"),
    periodEnd: timestamp("periodEnd"),
    /** 臨時レポートの対象銘柄。決算・ニュース起点のとき使う */
    triggerSymbol: varchar("triggerSymbol", { length: 24 }),
    model: varchar("model", { length: 64 }),
    readAt: timestamp("readAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userKindIdx: index("aiReports_user_kind_idx").on(table.userId, table.kind),
    createdIdx: index("aiReports_created_idx").on(table.userId, table.createdAt),
  })
);

export type AiReport = typeof aiReports.$inferSelect;
export type InsertAiReport = typeof aiReports.$inferInsert;

/**
 * AI 実行履歴。
 *
 * 過去にログが残っておらず「いつ何をどう判断したのか」を後から追えなかった。
 * AI を呼ぶ処理はすべてここに記録する。成功・失敗の両方を残す。
 */
export const aiRunLogs = mysqlTable(
  "aiRunLogs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /** 何の処理か（例: price_band_plan / band_check / signal / news_analysis / ocr） */
    kind: varchar("kind", { length: 48 }).notNull(),
    /** 対象銘柄。銘柄に紐づかない処理は null */
    symbol: varchar("symbol", { length: 24 }),
    model: varchar("model", { length: 64 }),
    status: mysqlEnum("status", ["SUCCESS", "FAILED"]).notNull(),
    /** 処理にかかった時間（ミリ秒）。遅いモデルの特定に使う */
    durationMs: int("durationMs"),
    /** 結果の要約、または失敗時のエラー内容 */
    detail: text("detail"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userKindIdx: index("aiRunLogs_user_kind_idx").on(table.userId, table.kind),
    createdIdx: index("aiRunLogs_created_idx").on(table.createdAt),
  })
);

export type AiRunLog = typeof aiRunLogs.$inferSelect;
export type InsertAiRunLog = typeof aiRunLogs.$inferInsert;

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

/**
 * AI への相談（会話）。
 *
 * 購入判断はもともと外部の AI に相談して決めていた。そのやり取りは
 * どこにも残らないため「あの時なぜ買ったのか」を後から辿れない。
 * 相談をシステム内で行い、会話として保存する。
 *
 * 会話（consultations）と発言（consultationMessages）を分けているのは、
 * 1 回の相談が複数回のやり取りになるため。1 行に全文を詰めると
 * 続きの質問ができず、どこまでが AI の発言かも区別できない。
 */
export const consultations = mysqlTable(
  "consultations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    /**
     * 会話の題名。最初の質問から作る。
     * 一覧で中身を開かずに探せるようにするため。
     */
    title: varchar("title", { length: 200 }).notNull(),
    /**
     * 相談対象の銘柄。銘柄を決めずに全体を相談する場合は null。
     * 銘柄詳細から相談を始めたときにここが入る。
     */
    symbol: varchar("symbol", { length: 24 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    /** 最後に発言があった時刻。一覧を新しい順に並べるのに使う */
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userUpdatedIdx: index("consultations_user_updated_idx").on(table.userId, table.updatedAt),
    symbolIdx: index("consultations_symbol_idx").on(table.userId, table.symbol),
  })
);
export type Consultation = typeof consultations.$inferSelect;
export type InsertConsultation = typeof consultations.$inferInsert;

/**
 * 相談の中の 1 発言。
 *
 * `contextSnapshot` に、その時 AI へ渡した保有状況（レバレッジ・配当・
 * 業種の偏りなど）を残す。後から履歴を読み返したときに、当時どの前提で
 * その回答が出たのかが分からないと判断の妥当性を検証できない。
 * 株価も配当も変わるので、今の値で読むと結論が食い違って見える。
 */
export const consultationMessages = mysqlTable(
  "consultationMessages",
  {
    id: int("id").autoincrement().primaryKey(),
    consultationId: int("consultationId").notNull(),
    userId: int("userId").notNull(),
    /** USER = 自分の質問 / ASSISTANT = AI の回答 */
    role: mysqlEnum("role", ["USER", "ASSISTANT"]).notNull(),
    content: text("content").notNull(),
    /** AI へ渡した前提（JSON 文字列）。USER 発言では null */
    contextSnapshot: text("contextSnapshot"),
    /** 使ったモデル。後から品質を比べられるようにする */
    model: varchar("model", { length: 80 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    consultationIdx: index("consultationMessages_consultation_idx").on(
      table.consultationId,
      table.createdAt
    ),
  })
);
export type ConsultationMessage = typeof consultationMessages.$inferSelect;
export type InsertConsultationMessage = typeof consultationMessages.$inferInsert;

/**
 * 相談で出た提案と、それを実行したかどうか、その後どうなったか。
 *
 * なぜ必要か:
 * AI に結論を断定させる方針にしたため、その結論が当たったのか外れたのかを
 * 検証できなければ精度が上がらない。実行の有無は保有株数の変化から分かる
 * （買えばスクリーンショットの株数が増える）ので、提案時点の株数を記録して
 * 後から比べる。
 *
 * 相談の発言（consultationMessages）と分けているのは、1 回の相談で
 * 複数の銘柄に言及することがあり、銘柄ごとに実行の有無と結果が変わるため。
 */
export const consultOutcomes = mysqlTable(
  "consultOutcomes",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    consultationId: int("consultationId").notNull(),
    /** どの発言に対する提案か。回答を読み返せるようにする */
    messageId: int("messageId").notNull(),
    symbol: varchar("symbol", { length: 24 }).notNull(),
    /**
     * 提案の向き。BUY = 買い増しを勧めた / HOLD = 静観を勧めた /
     * REDUCE = 減らすことを勧めた / REPAY = 借入返済を勧めた
     */
    stance: mysqlEnum("stance", ["BUY", "HOLD", "REDUCE", "REPAY"]).notNull(),
    /** AI の結論の 1 文。後から一覧で読めるようにする */
    conclusion: text("conclusion").notNull(),
    /**
     * 提案時点の株数と株価。実行の有無と、その後の値動きを判定する基準。
     * 株価は現地通貨。円換算すると為替で結果が変わってしまう。
     */
    quantityAtAdvice: decimal("quantityAtAdvice", { precision: 20, scale: 4 }),
    priceAtAdvice: decimal("priceAtAdvice", { precision: 20, scale: 4 }),
    /**
     * 実行したか。null = まだ判定していない / true = 株数が増減した /
     * false = 変わらなかった
     */
    executed: boolean("executed"),
    /** 実行を検知した時刻 */
    executedAt: timestamp("executedAt"),
    /** 実行後の株数。何株買ったかを差分で出せる */
    quantityAfter: decimal("quantityAfter", { precision: 20, scale: 4 }),
    /**
     * 提案の当否。CORRECT / WRONG / UNCLEAR のいずれか。
     * 判定は株価の推移から機械的に出す（AI に判定させると甘くなる）。
     */
    verdict: mysqlEnum("verdict", ["CORRECT", "WRONG", "UNCLEAR"]),
    /** 判定時点の株価。何と比べたかを残す */
    priceAtVerdict: decimal("priceAtVerdict", { precision: 20, scale: 4 }),
    /** 判定した時刻 */
    verdictAt: timestamp("verdictAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userSymbolIdx: index("consult_outcomes_user_symbol_idx").on(table.userId, table.symbol),
    consultationIdx: index("consult_outcomes_consultation_idx").on(table.consultationId),
    pendingIdx: index("consult_outcomes_pending_idx").on(table.userId, table.executed),
  })
);
export type ConsultOutcome = typeof consultOutcomes.$inferSelect;
export type InsertConsultOutcome = typeof consultOutcomes.$inferInsert;
