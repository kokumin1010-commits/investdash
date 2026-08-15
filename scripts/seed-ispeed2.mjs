/**
 * 楽天証券 iSPEED の追加スクショ（IMG_7620 / IMG_7621 / IMG_7623）から
 * 読み取った 26 銘柄を登録する。
 *
 * 3 枚の画像は表示範囲が重複しているため、銘柄コードで重複を排除している。
 * トヨタ自動車（7203）は同一口座内で建玉が 2 行に分かれていたため、
 * ユーザー確認のうえ合算して 1 レコードとして登録する。
 *   700 株 @2,852.80 + 7,400 株 @2,555.46 = 8,100 株 @2,581.16（加重平均）
 *
 * 実行: node scripts/seed-ispeed2.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";
const BROKER = "rakuten_ispeed";

/** 出典画像つきの読み取り結果。tickerCode / name / quantity / avgCost / currentPrice */
const ROWS = [
  // --- IMG_7620 ---
  ["4927", "ポーラ・オルビスホールディングス", 1700, 1195.89, 1408.5],
  ["4933", "I-ne", 700, 1356.41, 1447],
  ["5332", "TOTO", 100, 4063.75, 6631],
  ["6367", "ダイキン工業", 100, 15860.13, 21255],
  ["6594", "ニデック", 800, 2833.45, 2772],
  ["6752", "パナソニックホールディングス", 600, 1828.06, 4721],
  ["6902", "デンソー", 2600, 1835.93, 1955],
  ["6963", "ローム", 100, 1606.38, 5016],
  ["7110", "クラシコム", 1000, 1200.44, 2021],
  ["7201", "日産自動車", 6000, 398.27, 330],
  // --- 7203 は 2 行を合算（ユーザー確認済み） ---
  ["7203", "トヨタ自動車", 8100, 2581.16, 3020],
  // --- IMG_7621 ---
  ["7261", "マツダ", 7000, 1153.53, 1169],
  ["7267", "本田技研工業", 3300, 1360.32, 1658],
  ["7735", "SCREENホールディングス", 800, 5369.59, 14275],
  ["7741", "HOYA", 100, 18134.43, 26645],
  ["8001", "伊藤忠商事", 2300, 1603.91, 2064.5],
  ["8002", "丸紅", 300, 2097.5, 4930],
  ["8031", "三井物産", 2300, 2929.72, 4825],
  ["8035", "東京エレクトロン", 100, 23895.13, 59130],
  ["8053", "住友商事", 400, 806.48, 1791],
  ["8058", "三菱商事", 900, 2588.17, 4769],
  // --- IMG_7623 ---
  ["8309", "三井住友トラスト・ホールディングス", 2000, 1055.5, 1737],
  ["8473", "SBIホールディングス", 700, 2864.57, 3070],
  ["8591", "オリックス", 400, 2893.95, 6376],
  ["8604", "野村ホールディングス", 6000, 1053.5, 1570],
  ["9432", "日本電信電話", 20000, 155.55, 162.7],
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

// トヨタの加重平均を検算しておく
const check = (700 * 2852.8 + 7400 * 2555.46) / 8100;
console.log(`トヨタの加重平均取得単価: ${check.toFixed(2)}（スクリプト値 2581.16）`);

const rows = ROWS.map(([tickerCode, name, quantity, avgCost, currentPrice]) => ({
  name,
  tickerCode,
  symbol: `${tickerCode}.T`,
  market: "JP",
  quantity,
  avgCost,
  currentPrice,
  // 評価額と評価損益は画面に無いため計算で導く（検証済みの方法）
  marketValue: quantity * currentPrice,
  pnl: quantity * currentPrice - quantity * avgCost,
  confidence: 100,
  mode: "NEW",
}));

console.log(`\n${rows.length} 銘柄を ${BROKER} として登録します…`);
const result = await call(
  "import.applyRows",
  { rows, cashBalance: null, formatId: BROKER },
  token
);
console.log(`新規 ${result.created} / 更新 ${result.updated} / スキップ ${result.skipped.length}`);
if (result.skipped.length) console.log("スキップ:", result.skipped);

// 株価と業種を取得する
console.log("\n株価を取得します…");
const sync = await call("portfolio.syncPrices", {}, token);
console.log(`更新 ${sync.updated} 件 / 失敗 ${sync.failed.length} 件`);
if (sync.failed.length) console.log("失敗:", sync.failed);

const overview = await call("portfolio.overview", undefined, token, "GET");
console.log(
  `\n登録後: ${overview.groups.length} 銘柄 / ${overview.positions.length} 口座レコード`
);
console.log(`複数口座で保有: ${overview.groups.filter(g => g.isSplit).length} 銘柄`);
console.log(`総評価額: ${Math.round(overview.summary.totalValueBase).toLocaleString()} 円`);
