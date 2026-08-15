/**
 * 米国株の登録内容を元画面（IMG_7624 / IMG_7625）と照合する。
 *
 * 元画面の合計損益は「+74,746.57 ドル（+13,383,716 円）」。
 * この 2 つの値から画面が使っている為替レートも逆算して確認する。
 *
 * 実行: node scripts/verify-ispeed-us.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";

/** 元画面の読み取り値: ティッカー / 数量 / 取得単価 / 現在値 */
const EXPECTED = [
  ["AAPL", 30, 180.3933, 305.93],
  ["ADBE", 8, 464.12, 264.02],
  ["AMD", 10, 89.549, 514.39],
  ["AMZN", 52, 165.6165, 262.65],
  ["AXP", 3, 245.3733, 342.48],
  ["CVS", 100, 70.8651, 97.16],
  ["EL", 10, 92.113, 86.1],
  ["GOOGL", 20, 154.1773, 345.9],
  ["HMY", 54, 5.759, 19.44],
  ["INTC", 469, 20.4243, 102.5],
  ["MSFT", 6, 377.257, 495.4],
  ["NVDA", 5, 99.8416, 225.16],
  ["ORCL", 1, 88.4744, 150.52],
  ["PFE", 150, 24.6009, 26.79],
  ["PYPL", 356, 70.8186, 61.66],
  ["QQQ", 16, 437.6414, 731.07],
  ["UNH", 118, 301.8863, 401.73],
  ["V", 1, 228.8, 364.15],
  ["VOO", 9, 459.99, 713.61],
];

/** 画面表示の合計損益 */
const SCREEN_PNL_USD = 74746.57;
const SCREEN_PNL_JPY = 13383716;

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
const overview = await call("portfolio.overview", undefined, token, "GET");

// 米国株の楽天口座レコードだけを抜き出す
const us = overview.positions.filter(p => p.market === "US" && p.broker === "rakuten_ispeed");
console.log(`登録済みの米国株: ${us.length} 銘柄（期待値 ${EXPECTED.length}）\n`);

let mismatch = 0;
const rows = [];
for (const [ticker, qty, cost, price] of EXPECTED) {
  const found = us.find(p => p.symbol === ticker);
  if (!found) {
    console.log(`NG   ${ticker}: 登録されていない`);
    mismatch += 1;
    continue;
  }
  const qtyOk = Math.abs(found.quantity - qty) < 0.0001;
  // 取得単価は小数第 4 位まで一致することを求める
  const costOk = Math.abs(found.avgCost - cost) < 0.0001;
  if (!qtyOk || !costOk) {
    console.log(
      `NG   ${ticker}: 株数 ${found.quantity}（期待 ${qty}） / 取得単価 ${found.avgCost}（期待 ${cost}）`
    );
    mismatch += 1;
  }
  rows.push({
    ティッカー: ticker,
    銘柄: found.name,
    株数: found.quantity,
    取得単価: found.avgCost,
    現在値: found.currentPrice,
    通貨: found.currency,
    "損益(USD)": found.pnl === null ? null : Math.round(found.pnl * 100) / 100,
  });
}

console.table(rows);

// 画面の合計損益と照合する（取得時点の株価で計算した値）
const screenBasedPnl = EXPECTED.reduce((s, [, q, c, p]) => s + q * p - q * c, 0);
console.log(`\n=== 元画面との照合 ===`);
console.log(`画面表示の合計損益      : ${SCREEN_PNL_USD.toLocaleString()} ドル`);
console.log(`読み取り値からの計算値  : ${screenBasedPnl.toFixed(2)} ドル`);
console.log(
  `差                      : ${(screenBasedPnl - SCREEN_PNL_USD).toFixed(2)} ドル（${(((screenBasedPnl - SCREEN_PNL_USD) / SCREEN_PNL_USD) * 100).toFixed(4)}%）`
);
console.log(`\n画面が使っている為替レート（逆算）: ${(SCREEN_PNL_JPY / SCREEN_PNL_USD).toFixed(2)} 円/ドル`);

// 現在の株価での損益（株価更新後の値なので画面とは一致しない）
const nowPnl = us.reduce((s, p) => s + (p.pnl ?? 0), 0);
console.log(`最新株価での合計損益    : ${nowPnl.toFixed(2)} ドル（株価更新後のため画面と異なる）`);

console.log(`\n不一致: ${mismatch} 件`);
