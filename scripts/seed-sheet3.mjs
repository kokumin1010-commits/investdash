/**
 * 3 枚目のスクリーンショット（IMG_7598）に写っていた銘柄を登録する。
 * AI の利用枠が一時的に上限に達したため、画面から読み取った値を直接投入する。
 *
 * 取得単価は画面右端で切れているため (評価額 − 評価損益) ÷ 株数 で逆算している。
 *
 * 実行: node scripts/seed-sheet3.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";

/** 画面に写っていた値 */
const SHEET3 = [
  { code: "8031", name: "三井物産", qty: 400, marketValue: 1930000, pnl: 640000, price: 4825.0 },
  { code: "8473", name: "SBIホールディングス", qty: 1200, marketValue: 3684000, pnl: 1267200, price: 3070.0 },
  { code: "2768", name: "双日", qty: 1600, marketValue: 9094400, pnl: 1400200, price: 5684.0 },
  { code: "3436", name: "SUMCO", qty: 700, marketValue: 2744000, pnl: 1923908.82, price: 3920.0 },
  { code: "6920", name: "レーザーテック", qty: 100, marketValue: 3882000, pnl: 2311000, price: 38820.0 },
  { code: "8411", name: "みずほフィナンシャルグループ", qty: 500, marketValue: 4310000, pnl: 2542000, price: 8620.0 },
  { code: "6752", name: "パナソニックホールディングス", qty: 800, marketValue: 3776800, pnl: 2600800, price: 4721.0 },
  { code: "4919", name: "ミルボン", qty: 3000, marketValue: 9750000, pnl: 2745000, price: 3250.0 },
  { code: "8604", name: "野村ホールディングス", qty: 7900, marketValue: 12403000, pnl: 3457840, price: 1570.0 },
];

/** 小数第 2 位で丸める（OCR 側の後処理と同じ扱い） */
const round2 = n => Math.round(n * 100) / 100;

async function call(path, body, token) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ json: body }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${path}: ${json.error.json.message}`);
  return json.result.data.json;
}

const { token } = await call("auth.unlock", { passcode: PASSCODE });

const rows = SHEET3.map(s => {
  const avgCost = round2((s.marketValue - s.pnl) / s.qty);
  return {
    name: s.name,
    tickerCode: s.code,
    symbol: `${s.code}.T`,
    market: "JP",
    quantity: s.qty,
    avgCost,
    currentPrice: s.price,
    marketValue: s.marketValue,
    pnl: s.pnl,
    confidence: 100,
    mode: "NEW",
  };
});

console.log("登録する銘柄:");
for (const r of rows) {
  console.log(`  ${r.symbol} ${r.name.padEnd(16, "　")} ${String(r.quantity).padStart(6)}株 @ ${r.avgCost}`);
}

const result = await call("import.applyRows", { rows, cashBalance: null }, token);
console.log(`\n新規 ${result.created} / 更新 ${result.updated} / スキップ ${result.skipped.length}`);

// 株価と業種を取得して最新化する
const sync = await call("portfolio.syncPrices", {}, token);
console.log(`株価更新: ${sync.updated} 件成功${sync.failed.length ? ` / 失敗 ${sync.failed.join(", ")}` : ""}`);
