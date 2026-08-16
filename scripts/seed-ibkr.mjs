/**
 * IBKR（Interactive Brokers）シンガポール口座の保有 51 銘柄と負債情報を登録する。
 *
 * 元画面: ポジション一覧 5 枚（時価評価額の降順で複数画面にまたがる）、残高 2 枚。
 * 読み取り原本は docs/ibkr-holdings-source.md、口座サマリーは docs/ibkr-source-data.md。
 *
 * ## 通貨の扱い（最重要）
 *
 * この口座は基軸通貨が SGD だが、個別銘柄の平均価格・現在値は現地通貨で表示される。
 * ORCL 詳細画面の「150.77 USD」「185.1K SGD」という 2 つの表示から確定した。
 *   960 株 × 150.77 USD = 144,739 USD = 185.1K SGD → 1.279 SGD/USD（実勢と一致）
 *
 * したがって取り込むのは「数量」と「平均価格（現地通貨）」だけで、
 * 画面の時価評価額（SGD 換算）は使わない。通貨は取引所コードから決める。
 *   TSEJ → JPY / NYSE・NASDAQ → USD / SGX → SGD
 *
 * ## 信用取引（レバレッジ）
 *
 * 現金残高が −1,826,237.33 SGD（うち JPY で −228,720,494 円を借入）。
 * 株式時価をそのまま資産にすると 2 億円以上過大になるため、
 * brokerBalances テーブルに借入・維持証拠金を記録して純資産を算出する。
 *
 * ## 冪等性
 *
 * import.applyRows は「同じ symbol × 同じ broker」があれば更新するため、
 * 再実行しても重複しない。既存 12 銘柄はこのスクリプトの実行で更新される。
 *
 * 実行: node scripts/seed-ibkr.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";
const BROKER = "ibkr";

/**
 * ティッカー / 取引所 / 銘柄名 / 数量 / 平均価格（現地通貨）
 *
 * 数量の K 表記は展開済み（6.90K → 6900、88.40K → 88400 など）。
 * K 表記は 3 桁に丸められている可能性があるため、登録後に評価額で検算する。
 * 並びは元画面（時価評価額の降順）のまま維持し、読み取り原本と突き合わせやすくする。
 */
const ROWS = [
  ["ORCL", "NYSE", "オラクル", 960, 126.64],
  ["PRU", "NYSE", "プルデンシャル・ファイナンシャル", 1100, 100.01],
  ["NVDA", "NASDAQ.NMS", "エヌビディア", 600, 193.65],
  ["7203", "TSEJ", "トヨタ自動車", 6900, 2891.9],
  ["2768", "TSEJ", "双日", 3500, 4851.6],
  ["TSLA", "NASDAQ.NMS", "テスラ", 360, 392.45],
  ["7974", "TSEJ", "任天堂", 2000, 7215.8],
  ["GOOGL", "NASDAQ.NMS", "アルファベット", 320, 354.44],
  ["AMZN", "NASDAQ.NMS", "アマゾン・ドット・コム", 420, 227.33],
  ["ACN", "NYSE", "アクセンチュア", 600, 169.93],
  ["MSFT", "NASDAQ.NMS", "マイクロソフト", 200, 393.22],
  ["AVGO", "NASDAQ.NMS", "ブロードコム", 240, 375.47],
  ["6724", "TSEJ", "セイコーエプソン", 4600, 2139.1],
  ["MRVL", "NASDAQ.NMS", "マーベル・テクノロジー", 400, 188.51],
  /*
   * M44U は Mapletree Logistics Trust。当初「Mapletree Pan Asia Commercial
   * Trust」と記録していたが、そちらは N2IU で別銘柄。株価 API の名称と
   * 画面の評価額（88,400 株 × 1.17 SGD = 103,428 SGD ≒ 画面 103,400）が
   * 一致することを確認した。
   */
  ["M44U", "SGX", "Mapletree Logistics Trust", 88400, 1.17],
  ["5411", "TSEJ", "JFEホールディングス", 7000, 2021.3],
  ["9432", "TSEJ", "日本電信電話（NTT）", 70000, 148.5],
  ["8058", "TSEJ", "三菱商事", 2300, 4422.4],
  ["CJLU", "SGX", "NetLink NBN Trust", 86600, 0.912],
  ["8309", "TSEJ", "三井住友トラストグループ", 6000, 1351.1],
  ["8001", "TSEJ", "伊藤忠商事", 5000, 1898.4],
  ["9508", "TSEJ", "九州電力", 5000, 1707.8],
  ["KHC", "NASDAQ.NMS", "クラフト・ハインツ", 2300, 25.54],
  ["MRK", "NYSE", "メルク", 400, 87.45],
  ["UNH", "NYSE", "ユナイテッドヘルス・グループ", 130, 276.02],
  ["8604", "TSEJ", "野村ホールディングス", 5000, 1510.7],
  ["6902", "TSEJ", "デンソー", 4000, 1864.0],
  ["8473", "TSEJ", "SBIホールディングス", 2500, 2962.2],
  ["BMY", "NYSE", "ブリストル・マイヤーズ スクイブ", 700, 48.53],
  ["5938", "TSEJ", "LIXIL", 3900, 1826.1],
  ["5401", "TSEJ", "日本製鉄", 10000, 534.9],
  /*
   * 373A は LIPPS（美容室運営）。当初「東京メトロ」と推測していたが、
   * 東京メトロは 9023 で別銘柄。画面の時価評価額 52,062 SGD に対し
   * 373A.T の現在値 1,474 円 × 4,400 株 = 52,066 SGD で一致することを確認した。
   */
  ["373A", "TSEJ", "LIPPS", 4400, 1756.9],
  ["ANET", "NYSE", "アリスタネットワークス", 200, 166.85],
  ["F34", "SGX", "Wilmar International", 12500, 2.93],
  ["BLK", "NYSE", "ブラックロック", 30, 1053.97],
  ["NKE", "NYSE", "ナイキ", 800, 59.7],
  ["2733", "TSEJ", "あらた", 2000, 3142.2],
  ["ALAB", "NASDAQ.NMS", "アステラ・ラボ", 100, 302.01],
  ["DIS", "NYSE", "ウォルト・ディズニー", 300, 107.5],
  ["PYPL", "NASDAQ.NMS", "ペイパル", 500, 40.66],
  ["RIO", "NYSE", "リオ・ティント", 300, 81.58],
  ["5801", "TSEJ", "古河電気工業", 1100, 3484.8],
  ["U11", "SGX", "United Overseas Bank (UOB)", 800, 34.38],
  ["8002", "TSEJ", "丸紅", 800, 4867.1],
  ["PFE", "NYSE", "ファイザー", 900, 26.89],
  ["9449", "TSEJ", "GMOインターネットグループ", 800, 2932.2],
  ["9CI", "SGX", "CapitaLand Investment", 9700, 2.64],
  ["9104", "TSEJ", "商船三井", 500, 4565.6],
  ["D05", "SGX", "DBS Group Holdings", 300, 48.78],
  ["AJBU", "SGX", "Keppel DC REIT", 6200, 2.31],
  ["UPS", "NYSE", "ユナイテッド・パーセル・サービス", 92, 83.98],
];

/**
 * 残高タブから読み取った口座の負債・証拠金情報（SGD 建て）。
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

/**
 * 取引所コードから Yahoo Finance のシンボル・市場・通貨を決める。
 *
 * shared/investing.ts の resolveByExchange と同じ規則。スクリプトは
 * TypeScript を読み込まないため、ここに最小限の実装を置く。
 * 規則を変える場合は両方を直す必要がある。
 */
function resolve(tickerCode, exchange) {
  const code = tickerCode.trim().toUpperCase();
  const ex = exchange.trim().toUpperCase();
  if (ex === "TSEJ") return { symbol: `${code}.T`, market: "JP", currency: "JPY" };
  if (ex === "SGX") return { symbol: `${code}.SI`, market: "SG", currency: "SGD" };
  return { symbol: code, market: "US", currency: "USD" };
}

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

const rows = ROWS.map(([tickerCode, exchange, name, quantity, avgCost]) => {
  const { symbol, market } = resolve(tickerCode, exchange);
  return {
    name,
    tickerCode,
    /*
     * symbol は applyRows がそのまま使う。日本株に .T を付けないと
     * 7203（IBKR）と 7203.T（楽天・moomoo）が別銘柄として登録され、
     * 合算されないうえ株価取得も失敗する。
     */
    symbol,
    market,
    quantity,
    avgCost,
    // 現在値は画面に無い（時価評価額は SGD 換算のため使わない）。株価 API から取得する
    currentPrice: null,
    marketValue: null,
    pnl: null,
    confidence: 100,
    mode: "NEW",
  };
});

// 同じ銘柄を二重に登録しないよう、読み取り漏れ・重複を先に検出する
const dupes = rows
  .map(r => r.symbol)
  .filter((s, i, arr) => arr.indexOf(s) !== i);
if (dupes.length > 0) {
  throw new Error(`読み取り原本に重複があります: ${Array.from(new Set(dupes)).join(", ")}`);
}

console.log(`${rows.length} 銘柄を IBKR として登録します…`);
for (const m of ["JP", "US", "SG"]) {
  console.log(`  ${m}: ${rows.filter(r => r.market === m).length} 銘柄`);
}

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
console.log(`株式時価: ${Math.round(overview.summary.totalValueBase).toLocaleString()} 円`);
console.log(`借入合計: ${Math.round(overview.summary.totalBorrowedBase).toLocaleString()} 円`);
console.log(`純資産　: ${Math.round(overview.summary.netAssetsBase).toLocaleString()} 円`);
for (const b of overview.brokers ?? []) {
  console.log(`  ${b.label}: ${b.count} 銘柄 / ${Math.round(b.value).toLocaleString()} 円`);
}
