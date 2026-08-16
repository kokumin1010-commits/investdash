/**
 * 渣打銀行 シンガポール（SC Mobile Trading）の保有 10 銘柄を登録する。
 *
 * 原本データは docs/sc-sg-holdings-source.md に記録した実画面 4 枚の読み取り値。
 * この口座は現物のみで信用取引は使っていないため、brokerBalances への記録は行わない。
 *
 * 平均取得単価は畳んだカードには表示されないため損益率から逆算する。
 *   取得原価 = 含み損益 ÷ (損益率 ÷ 100)
 *   平均単価 = 取得原価 ÷ 数量
 * 「現在値 × 数量 − 含み損益」より誤差が小さい（詳細は原本ドキュメント参照）。
 *
 * 実行: node scripts/seed-sc-sg.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";
const BROKER = "sc_sg";

/**
 * 画面の読み取り値。avgCost は損益率から逆算するため、
 * ここには画面に出ている値（数量・現在値・含み損益・損益率）だけを持たせる。
 * 並びは元画面の順（TSE → SGX）を維持し、原本と突き合わせやすくする。
 */
const ROWS = [
  // 東証（TSE）3 銘柄
  { code: "3769", suffix: "JP", name: "GMOペイメントゲートウェイ", qty: 300, price: 10150.0, pl: 793628.01, plPct: 35.35 },
  // SUBARU のみカードが展開されており Avg Price が読める。逆算せず表示値を使う
  { code: "7270", suffix: "JP", name: "SUBARU", qty: 800, price: 2583.0, pl: -310468.8, plPct: -13.08, avgCostShown: 2965.92 },
  { code: "9449", suffix: "JP", name: "GMOインターネットグループ", qty: 400, price: 4343.0, pl: 561385.6, plPct: 47.89 },

  // シンガポール取引所（SGX）7 銘柄
  { code: "C38U", suffix: "SG", name: "CapitaLand Integrated Commercial Trust", qty: 7300, price: 2.43, pl: 653.74, plPct: 3.84 },
  { code: "C6L", suffix: "SG", name: "シンガポール航空", qty: 500, price: 7.05, pl: 325.24, plPct: 10.19 },
  { code: "CJLU", suffix: "SG", name: "NetLink NBN Trust", qty: 32000, price: 0.975, pl: 3230.56, plPct: 11.58 },
  { code: "D05", suffix: "SG", name: "DBS グループ・ホールディングス", qty: 300, price: 75.53, pl: 8673.55, plPct: 62.24 },
  { code: "F34", suffix: "SG", name: "ウィルマー・インターナショナル", qty: 27400, price: 3.75, pl: 20214.35, plPct: 24.56 },
  { code: "U11", suffix: "SG", name: "ユナイテッド・オーバーシーズ銀行", qty: 1800, price: 41.8, pl: 2593.34, plPct: 3.58 },
  { code: "Z74", suffix: "SG", name: "シングテル", qty: 11100, price: 4.45, pl: 12000.33, plPct: 32.18 },
];

/** 画面のセクション小計（検算用） */
const EXPECTED = {
  tseValueSgd: 54761.41,
  tsePlSgd: 8352.18,
  sgxValueSgd: 302508.0,
  sgxPlSgd: 47691.11,
  totalSgd: 357269.41,
  totalPlSgd: 56043.29,
};

/** 市場サフィックスから symbol・market・currency を決める */
function resolve(row) {
  switch (row.suffix) {
    case "JP":
      // 日本株は .T を付けないと他口座の同一銘柄と合算されず株価取得も失敗する
      return { symbol: `${row.code}.T`, market: "JP", currency: "JPY" };
    case "SG":
      return { symbol: `${row.code}.SI`, market: "SG", currency: "SGD" };
    case "US":
      return { symbol: row.code, market: "US", currency: "USD" };
    default:
      throw new Error(`未知のサフィックス: ${row.suffix}`);
  }
}

/**
 * 平均取得単価を求める。
 * 画面に Avg Price が出ている銘柄はその値を使い、それ以外は損益率から逆算する。
 */
function avgCostOf(row) {
  if (row.avgCostShown !== undefined) {
    return { value: row.avgCostShown, source: "画面表示" };
  }
  const cost = row.pl / (row.plPct / 100);
  return { value: cost / row.qty, source: "逆算" };
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

const rows = ROWS.map(row => {
  const { symbol, market } = resolve(row);
  const { value: avgCost } = avgCostOf(row);
  return {
    name: row.name,
    tickerCode: row.code,
    symbol,
    market,
    quantity: row.qty,
    avgCost: Number(avgCost.toFixed(4)),
    // 現在値は株価 API から取得する（画面の値は遅延値のため）
    currentPrice: null,
    marketValue: null,
    pnl: null,
    confidence: 100,
    mode: "NEW",
  };
});

// 読み取り原本の重複を先に検出する
const dupes = rows.map(r => r.symbol).filter((s, i, arr) => arr.indexOf(s) !== i);
if (dupes.length > 0) {
  throw new Error(`読み取り原本に重複があります: ${Array.from(new Set(dupes)).join(", ")}`);
}

console.log(`${rows.length} 銘柄を渣打銀行として登録します…`);
for (const m of ["JP", "SG", "US"]) {
  const n = rows.filter(r => r.market === m).length;
  if (n > 0) console.log(`  ${m}: ${n} 銘柄`);
}

console.log("\n平均取得単価の算出内容:");
for (const row of ROWS) {
  const { symbol } = resolve(row);
  const { value, source } = avgCostOf(row);
  console.log(`  ${symbol.padEnd(9)} ${String(row.qty).padStart(7)} 株 @ ${value.toFixed(4)} (${source})`);
}

const result = await call(
  "import.applyRows",
  // 現物のみの口座なので現金残高・負債の記録は行わない
  { rows, cashBalance: null, formatId: BROKER },
  token
);
console.log(`\n新規 ${result.created} / 更新 ${result.updated} / スキップ ${result.skipped.length}`);
if (result.skipped.length) console.log("スキップ:", result.skipped);

console.log("\n株価を取得します…");
const sync = await call("portfolio.syncPrices", {}, token);
console.log(`更新 ${sync.updated} 件 / 失敗 ${sync.failed.length} 件`);
if (sync.failed.length) console.log("失敗:", sync.failed);

const overview = await call("portfolio.overview", undefined, token, "GET");
console.log(`\n登録後: ${overview.groups.length} 銘柄 / ${overview.positions.length} 口座レコード`);
for (const b of overview.brokers ?? []) {
  console.log(`  ${b.label}: ${b.count} 銘柄 / ${Math.round(b.value).toLocaleString()} 円`);
}

/*
 * 検算: 渣打分だけを取り出し、口座合計を画面表示（SGD 357,269.41）と比較する。
 * 円換算されているため SGD/JPY レートで割り戻す。
 */
const settings = await call("portfolio.settings", undefined, token, "GET");
const sgdJpy = Number(settings.sgdJpyRate);
const sc = (overview.brokers ?? []).find(b => b.key === BROKER);
if (sc && Number.isFinite(sgdJpy) && sgdJpy > 0) {
  const valueSgd = sc.value / sgdJpy;
  const plSgd = sc.pnl / sgdJpy;
  const diff = ((valueSgd - EXPECTED.totalSgd) / EXPECTED.totalSgd) * 100;
  console.log(`\n=== 検算（SGD/JPY = ${sgdJpy}）===`);
  console.log(`評価額: ${valueSgd.toFixed(2)} SGD（画面 ${EXPECTED.totalSgd}）差 ${diff.toFixed(2)}%`);
  console.log(`含み益: ${plSgd.toFixed(2)} SGD（画面 ${EXPECTED.totalPlSgd}）`);
  console.log(
    "※ 画面は前営業日レート（約 125.06 JPY/SGD）で換算しているため、レート差の分だけずれる"
  );
}
