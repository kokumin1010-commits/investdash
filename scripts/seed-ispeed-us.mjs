/**
 * 楽天証券 iSPEED の米国株スクショ（IMG_7624 / IMG_7625）から
 * 読み取った米国株を登録する。
 *
 * 2 枚の画像は HMY〜MSFT が重複しているため、ティッカーで重複を排除している。
 * PYPL は同一口座内で建玉が 2 行に分かれていたため、ユーザー確認のうえ合算する。
 *   88 株 @65.7896 + 268 株 @72.4699 = 356 株 @70.8186（加重平均）
 *
 * 米国株なので symbol はティッカーそのまま（日本株の .T サフィックスは付けない）、
 * market は "US"、通貨は株価 API の返す USD が入る。
 *
 * 実行: node scripts/seed-ispeed-us.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";
const BROKER = "rakuten_ispeed";

/** ティッカー / 銘柄名 / 保有数量 / 平均取得価額(USD) / 現在値(USD) */
const ROWS = [
  // --- IMG_7624 ---
  ["AAPL", "アップル", 30, 180.3933, 305.93],
  ["ADBE", "アドビ", 8, 464.12, 264.02],
  ["AMD", "アドバンスト・マイクロ・デバイセズ", 10, 89.549, 514.39],
  ["AMZN", "アマゾン・ドット・コム", 52, 165.6165, 262.65],
  ["AXP", "アメリカン・エキスプレス", 3, 245.3733, 342.48],
  ["CVS", "CVSヘルス", 100, 70.8651, 97.16],
  ["EL", "エスティローダー", 10, 92.113, 86.1],
  ["GOOGL", "アルファベット", 20, 154.1773, 345.9],
  ["HMY", "ハーモニー・ゴールド・マイニング", 54, 5.759, 19.44],
  ["INTC", "インテル", 469, 20.4243, 102.5],
  ["MSFT", "マイクロソフト", 6, 377.257, 495.4],
  // --- IMG_7625 ---
  ["NVDA", "エヌビディア", 5, 99.8416, 225.16],
  ["ORCL", "オラクル", 1, 88.4744, 150.52],
  ["PFE", "ファイザー", 150, 24.6009, 26.79],
  // PYPL は 2 建玉を合算（ユーザー確認済み）
  ["PYPL", "ペイパル", 356, 70.8186, 61.66],
  ["QQQ", "インベスコ QQQ トラスト", 16, 437.6414, 731.07],
  ["UNH", "ユナイテッドヘルス・グループ", 118, 301.8863, 401.73],
  ["V", "ビザ", 1, 228.8, 364.15],
  ["VOO", "バンガード S&P 500 ETF", 9, 459.99, 713.61],
];

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

// PYPL の加重平均を検算しておく
const pypl = (88 * 65.7896 + 268 * 72.4699) / 356;
console.log(`PYPL の加重平均取得単価: ${pypl.toFixed(4)}（スクリプト値 70.8186）`);

const rows = ROWS.map(([tickerCode, name, quantity, avgCost, currentPrice]) => ({
  name,
  tickerCode,
  // 米国株は .T のようなサフィックスを付けない
  symbol: tickerCode,
  market: "US",
  quantity,
  avgCost,
  currentPrice,
  // 評価額と評価損益は画面に無いため計算で導く（検証済みの方法）
  marketValue: quantity * currentPrice,
  pnl: quantity * currentPrice - quantity * avgCost,
  confidence: 100,
  mode: "NEW",
}));

// 元画面の合計損益（ドル）と照合できるよう、読み取り値ベースの合計を出す
const totalPnlUsd = rows.reduce((s, r) => s + r.pnl, 0);
console.log(`読み取り値からの合計損益: ${totalPnlUsd.toFixed(2)} ドル（画面表示 +74,746.57 ドル）`);

console.log(`\n${rows.length} 銘柄を ${BROKER}（米国株）として登録します…`);
const result = await call(
  "import.applyRows",
  { rows, cashBalance: null, formatId: BROKER },
  token
);
console.log(`新規 ${result.created} / 更新 ${result.updated} / スキップ ${result.skipped.length}`);
if (result.skipped.length) console.log("スキップ:", result.skipped);

console.log("\n株価を取得します…");
const sync = await call("portfolio.syncPrices", {}, token);
console.log(`更新 ${sync.updated} 件 / 失敗 ${sync.failed.length} 件`);
if (sync.failed.length) console.log("失敗:", sync.failed);

const overview = await call("portfolio.overview", undefined, token, "GET");
console.log(
  `\n登録後: ${overview.groups.length} 銘柄 / ${overview.positions.length} 口座レコード`
);
console.log(`総評価額: ${Math.round(overview.summary.totalValueBase).toLocaleString()} 円`);
for (const c of overview.currencies ?? []) {
  console.log(`  ${c.key}: ${c.count} 銘柄 / ${c.pct.toFixed(1)}%`);
}
