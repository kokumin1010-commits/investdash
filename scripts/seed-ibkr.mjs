/**
 * IBKR（Interactive Brokers）シンガポール口座の保有 12 銘柄と負債情報を登録する。
 *
 * 元画面: IMG_7630（ポジション一覧）、IMG_7632/IMG_7633（残高）、IMG_7631（ORCL 詳細）
 * 詳細は docs/ibkr-source-data.md を参照。
 *
 * ## 通貨の扱い（最重要）
 *
 * この口座は基軸通貨が SGD だが、個別銘柄の株価は現地通貨で表示される。
 * ORCL 詳細画面の「150.77 USD」「185.1K SGD」という 2 つの表示から確定した。
 *   960 株 × 150.77 USD = 144,739 USD = 185.1K SGD → 1.279 SGD/USD（実勢と一致）
 *
 * したがって米国株 9 銘柄は USD、日本株 3 銘柄は JPY として登録する。
 * SGD はシステム内では扱わない（換算表示のためだけに使われている）。
 *
 * ## 信用取引（レバレッジ）
 *
 * 現金残高が −1,826,237.33 SGD（= 円で −228,720,494 円を借入）。
 * 株式時価をそのまま資産にすると約 2 億円過大になるため、
 * brokerBalances テーブルに借入・維持証拠金を記録して純資産を算出する。
 *
 * 実行: node scripts/seed-ibkr.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";
const BROKER = "ibkr";

/**
 * ティッカー / 銘柄名 / 保有数量 / 平均取得価額(現地通貨) / 市場
 *
 * 数量の K 表記は展開済み（1.10K → 1100、6.90K → 6900、2.00K → 2000、3.50K → 3500）。
 * K 表記は 3 桁に丸められているため、登録後に評価額で検算する。
 */
const ROWS = [
  // --- 米国株（USD） ---
  ["ORCL", "オラクル", 960, 126.64, "US"],
  ["PRU", "プルデンシャル・ファイナンシャル", 1100, 100.01, "US"],
  ["NVDA", "エヌビディア", 600, 193.65, "US"],
  ["TSLA", "テスラ", 360, 392.45, "US"],
  ["GOOGL", "アルファベット", 320, 354.44, "US"],
  ["AMZN", "アマゾン・ドット・コム", 420, 227.33, "US"],
  ["ACN", "アクセンチュア", 600, 169.93, "US"],
  ["MSFT", "マイクロソフト", 200, 393.22, "US"],
  ["AVGO", "ブロードコム", 240, 375.47, "US"],
  // --- 日本株（JPY） ---
  ["7203", "トヨタ自動車", 6900, 2891.9, "JP"],
  ["2768", "双日", 3500, 4851.6, "JP"],
  ["7974", "任天堂", 2000, 7215.8, "JP"],
];

/**
 * 残高タブから読み取った口座の負債・証拠金情報（SGD 建て）。
 * IMG_7633 の「サマリー」画面の値を使う（IMG_7632 と同一）。
 */
const BALANCE = {
  currency: "SGD",
  /** 有価証券総ポジション価値 */
  positionValue: 4027724.59,
  /** 現金残高。マイナスは借入 */
  cashBalance: -1826237.33,
  /** 維持証拠金 */
  maintenanceMargin: 844670.35,
  /** 月初来利息（支払い） */
  interestMtd: -1217.22,
  /** 借入している通貨と金額（通貨別残高から） */
  borrowedCurrency: "JPY",
  borrowedAmount: -228720494.5,
  /** 画面表示の純資産評価額。検算用 */
  reportedNetValue: 2204556.91,
};

async function call(path, body, token, method = "POST") {
  const url =
    method === "GET"
      ? `${BASE}/api/trpc/${path}${body === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: body }))}`}`
      : `${BASE}/api/trpc/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify({ json: body }) } : {}),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${path}: ${json.error.json.message}`);
  return json.result.data.json;
}

const { token } = await call("auth.unlock", { passcode: PASSCODE });

const rows = ROWS.map(([tickerCode, name, quantity, avgCost, market]) => ({
  name,
  tickerCode,
  /*
   * symbol は applyRows がそのまま使うため、ここで正しい形に変換する。
   * 日本株は Yahoo Finance の記法に合わせて .T を付ける必要がある。
   * これを付けないと 7203（IBKR）と 7203.T（楽天・moomoo）が
   * 別銘柄として登録され、合算されないうえ株価取得も失敗する。
   */
  symbol: market === "JP" ? `${tickerCode}.T` : tickerCode,
  market,
  quantity,
  avgCost,
  // 現在値は画面に無い（時価評価額は SGD 換算のため使わない）。株価 API から取得する
  currentPrice: null,
  marketValue: null,
  pnl: null,
  confidence: 100,
  mode: "NEW",
}));

console.log(`${rows.length} 銘柄を IBKR として登録します…`);
console.log(`  米国株: ${rows.filter(r => r.market === "US").length} 銘柄（USD）`);
console.log(`  日本株: ${rows.filter(r => r.market === "JP").length} 銘柄（JPY）`);

const result = await call(
  "import.applyRows",
  // 現金残高は口座別の負債として別途記録するため、ここでは渡さない
  { rows, cashBalance: null, formatId: BROKER },
  token
);
console.log(`\n新規 ${result.created} / 更新 ${result.updated} / スキップ ${result.skipped.length}`);
if (result.skipped.length) console.log("スキップ:", result.skipped);

console.log("\n口座の負債・証拠金情報を記録します…");
await call(
  "portfolio.saveBrokerBalance",
  {
    broker: BROKER,
    currency: BALANCE.currency,
    cashBalance: BALANCE.cashBalance,
    maintenanceMargin: BALANCE.maintenanceMargin,
    interestMtd: BALANCE.interestMtd,
    borrowedCurrency: BALANCE.borrowedCurrency,
    borrowedAmount: BALANCE.borrowedAmount,
    reportedPositionValue: BALANCE.positionValue,
    reportedNetValue: BALANCE.reportedNetValue,
  },
  token
);

console.log("\n株価を取得します…");
const sync = await call("portfolio.syncPrices", {}, token);
console.log(`更新 ${sync.updated} 件 / 失敗 ${sync.failed.length} 件`);
if (sync.failed.length) console.log("失敗:", sync.failed);

const overview = await call("portfolio.overview", undefined, token, "GET");
console.log(
  `\n登録後: ${overview.groups.length} 銘柄 / ${overview.positions.length} 口座レコード`
);
console.log(`総評価額: ${Math.round(overview.summary.totalValueBase).toLocaleString()} 円`);
for (const b of overview.brokers ?? []) {
  console.log(`  ${b.label}: ${b.count} 銘柄 / ${Math.round(b.value).toLocaleString()} 円`);
}
