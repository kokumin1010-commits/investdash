/**
 * 楽天証券 iSPEED の保有銘柄を登録する。
 *
 * IMG_7614（取得単価ビュー）を OCR で読み取り、整合性チェック 22 項目すべて
 * 誤差 0.00% を確認済みの値をそのまま投入する。
 * 検証記録は docs/ispeed-verification.md を参照。
 *
 * moomoo と重複する 5 銘柄（ヤクルト・SUMCO・住友化学・オリエンタルランド・資生堂）は
 * 口座が違うため別レコードとして登録され、moomoo 側のデータは保持される。
 *
 * 実行: node scripts/seed-ispeed.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";

/**
 * IMG_7614 から読み取った値。
 * 銘柄名は iSPEED 上で省略されていたものを証券コードから補完済み。
 */
const ISPEED = [
  { code: "2267", name: "ヤクルト本社", qty: 1800, avgCost: 2394.5, price: 2881.5 },
  { code: "3249", name: "産業ファンド投資法人", qty: 3, avgCost: 116973.33, price: 136900 },
  { code: "3436", name: "SUMCO", qty: 1100, avgCost: 1137.37, price: 3920 },
  { code: "4005", name: "住友化学", qty: 10000, avgCost: 350.29, price: 530.5 },
  { code: "4063", name: "信越化学工業", qty: 400, avgCost: 4341.16, price: 6372 },
  { code: "4425", name: "Kudan", qty: 500, avgCost: 1483.85, price: 1672 },
  { code: "4661", name: "オリエンタルランド", qty: 200, avgCost: 3493.2, price: 2966.5 },
  { code: "4689", name: "LINEヤフー", qty: 2000, avgCost: 422.66, price: 506.3 },
  { code: "4751", name: "サイバーエージェント", qty: 200, avgCost: 997.27, price: 1266 },
  { code: "4816", name: "東映アニメーション", qty: 200, avgCost: 3535.17, price: 2828 },
  { code: "4911", name: "資生堂", qty: 600, avgCost: 2570.37, price: 3557 },
];

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

const rows = ISPEED.map(s => ({
  name: s.name,
  tickerCode: s.code,
  symbol: `${s.code}.T`,
  market: "JP",
  quantity: s.qty,
  avgCost: s.avgCost,
  currentPrice: s.price,
  // 評価額と評価損益は画面に無いため計算で導く（検証済みの方法）
  marketValue: s.qty * s.price,
  pnl: s.qty * s.price - s.qty * s.avgCost,
  confidence: 100,
  mode: "NEW",
}));

console.log("楽天証券 iSPEED に登録する銘柄:");
for (const r of rows) {
  console.log(
    `  ${r.symbol} ${r.name.padEnd(14, "　")} ${String(r.quantity).padStart(6)}株 @ ${r.avgCost}`
  );
}

// formatId を渡すことで broker=rakuten_ispeed として登録される
const result = await call("import.applyRows", { rows, cashBalance: null, formatId: "rakuten_ispeed" }, token);
console.log(`\n新規 ${result.created} / 更新 ${result.updated} / スキップ ${result.skipped.length}`);
if (result.skipped.length) console.log("スキップ:", result.skipped);

const sync = await call("portfolio.syncPrices", {}, token);
console.log(`株価更新: ${sync.updated} 件成功${sync.failed.length ? ` / 失敗 ${sync.failed.join(", ")}` : ""}`);
