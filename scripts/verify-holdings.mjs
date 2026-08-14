/**
 * 登録された保有データと、moomoo の元画面に写っていた値を照合する。
 * 元画面の値はスクリーンショットから読み取った実測値をハードコードしている。
 *
 * 実行: node scripts/verify-holdings.mjs
 */
import dotenv from "dotenv";
dotenv.config();
import mysql from "mysql2/promise";

/**
 * moomoo 日本版の画面に表示されていた値（正解データ）
 * marketValue = 評価額, pnl = 評価損益, price = 現在値
 * 取得単価は画面右端で切れているため（評価額 − 損益）÷ 株数 で逆算して照合する
 */
const EXPECTED = [
  // 1 枚目（IMG_7555）
  { sheet: 1, symbol: "7270.T", name: "SUBARU", qty: 1900, marketValue: 4859250, pnl: -1580450, price: 2557.5 },
  { sheet: 1, symbol: "9023.T", name: "東京地下鉄", qty: 3500, marketValue: 5096000, pnl: -418250, price: 1456.0 },
  { sheet: 1, symbol: "3653.T", name: "モルフォ", qty: 2400, marketValue: 1639200, pnl: -412800, price: 683.0 },
  { sheet: 1, symbol: "6526.T", name: "ソシオネクスト", qty: 300, marketValue: 597450, pnl: -103200, price: 1991.5 },
  { sheet: 1, symbol: "2267.T", name: "ヤクルト本社", qty: 400, marketValue: 1153800, pnl: -83000, price: 2884.5 },
  { sheet: 1, symbol: "4661.T", name: "オリエンタルランド", qty: 100, marketValue: 300100, pnl: -70800, price: 3001.0 },
  { sheet: 1, symbol: "4755.T", name: "楽天グループ", qty: 200, marketValue: 152280, pnl: -39940, price: 761.4 },

  // 2 枚目（IMG_7597）。キヤノンは 2 枚目の方が新しいのでこちらを採用
  { sheet: 2, symbol: "7751.T", name: "キヤノン", qty: 400, marketValue: 1862400, pnl: -30400, price: 4656.0 },
  { sheet: 2, symbol: "4901.T", name: "富士フイルムホールディングス", qty: 400, marketValue: 1331600, pnl: 8600, price: 3329.0 },
  { sheet: 2, symbol: "8410.T", name: "セブン銀行", qty: 7100, marketValue: 2386310, pnl: 33560, price: 336.1 },
  { sheet: 2, symbol: "7267.T", name: "本田技研工業", qty: 1500, marketValue: 2487000, pnl: 105750, price: 1658.0 },
  { sheet: 2, symbol: "9202.T", name: "ANAホールディングス", qty: 600, marketValue: 1875600, pnl: 142250, price: 3126.0 },
  { sheet: 2, symbol: "9432.T", name: "NTT", qty: 17500, marketValue: 2847250, pnl: 176750, price: 162.7 },
  { sheet: 2, symbol: "4005.T", name: "住友化学", qty: 2500, marketValue: 1326250, pnl: 216760, price: 530.5 },
  { sheet: 2, symbol: "7261.T", name: "マツダ", qty: 2600, marketValue: 3039400, pnl: 283400, price: 1169.0 },
  { sheet: 2, symbol: "8053.T", name: "住友商事", qty: 400, marketValue: 716400, pnl: 389600, price: 1791.0 },
  { sheet: 2, symbol: "4911.T", name: "資生堂", qty: 700, marketValue: 2489900, pnl: 600150, price: 3557.0 },
  { sheet: 2, symbol: "3778.T", name: "さくらインターネット", qty: 800, marketValue: 3096000, pnl: 628000, price: 3870.0 },

  // 3 枚目（IMG_7598）。さくらインターネットは 2 枚目と重複するため除外
  { sheet: 3, symbol: "8031.T", name: "三井物産", qty: 400, marketValue: 1930000, pnl: 640000, price: 4825.0 },
  { sheet: 3, symbol: "8473.T", name: "SBIホールディングス", qty: 1200, marketValue: 3684000, pnl: 1267200, price: 3070.0 },
  { sheet: 3, symbol: "2768.T", name: "双日", qty: 1600, marketValue: 9094400, pnl: 1400200, price: 5684.0 },
  { sheet: 3, symbol: "3436.T", name: "SUMCO", qty: 700, marketValue: 2744000, pnl: 1923908.82, price: 3920.0 },
  { sheet: 3, symbol: "6920.T", name: "レーザーテック", qty: 100, marketValue: 3882000, pnl: 2311000, price: 38820.0 },
  { sheet: 3, symbol: "8411.T", name: "みずほフィナンシャルグループ", qty: 500, marketValue: 4310000, pnl: 2542000, price: 8620.0 },
  { sheet: 3, symbol: "6752.T", name: "パナソニックホールディングス", qty: 800, marketValue: 3776800, pnl: 2600800, price: 4721.0 },
  { sheet: 3, symbol: "4919.T", name: "ミルボン", qty: 3000, marketValue: 9750000, pnl: 2745000, price: 3250.0 },
  { sheet: 3, symbol: "8604.T", name: "野村ホールディングス", qty: 7900, marketValue: 12403000, pnl: 3457840, price: 1570.0 },
];

const fmt = n =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("ja-JP", { maximumFractionDigits: 2 });

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute(
  "SELECT symbol, name, quantity, avgCost, currentPrice, sector FROM holdings"
);
await conn.end();

const bySymbol = new Map(rows.map(r => [r.symbol, r]));

let issues = 0;
let checked = 0;

console.log("=== 元画面 vs 登録データの照合 ===");
console.log("株数・取得単価・銘柄名を照合する。現在値は取込後に株価更新が走るため参考表示のみ。\n");
console.log("枚 コード     銘柄                     株数   取得単価  取込時値    最新値      変動  判定");
console.log("─".repeat(96));

for (const e of EXPECTED) {
  const actual = bySymbol.get(e.symbol);
  if (!actual) {
    console.log(`${e.sheet}  ${e.symbol.padEnd(9)} ${e.name}: 登録されていません  ✗`);
    issues++;
    continue;
  }

  const qty = Number(actual.quantity);
  const avgCost = Number(actual.avgCost);
  const price = Number(actual.currentPrice);

  // 元画面の評価額・損益から、あるべき取得単価を逆算
  const expectedAvgCost = (e.marketValue - e.pnl) / e.qty;

  const problems = [];
  if (qty !== e.qty) problems.push(`株数 ${qty} ≠ ${e.qty}`);
  // 取得単価は小数 2 位に丸めているため誤差 0.01 まで許容
  if (Math.abs(avgCost - expectedAvgCost) > 0.01) {
    problems.push(`取得単価 ${avgCost} ≠ ${expectedAvgCost.toFixed(4)}`);
  }
  if (actual.name !== e.name) {
    problems.push(`銘柄名「${actual.name}」→「${e.name}」`);
  }

  // 現在値は取込後の株価更新で変わるため、乖離を参考表示するだけにする。
  // ただし桁違い（10 倍以上）は取り違えの疑いがあるので不一致として扱う。
  const drift = price - e.price;
  if (price > 0 && (price / e.price > 10 || e.price / price > 10)) {
    problems.push(`現在値が桁違い ${price} vs ${e.price}`);
  }

  checked++;
  const line =
    `${e.sheet}  ${e.symbol.padEnd(9)} ${e.name.padEnd(16, "　").slice(0, 16)}` +
    `${String(e.qty).padStart(7)} ${expectedAvgCost.toFixed(2).padStart(9)} ` +
    `${String(e.price).padStart(9)} ${price.toFixed(1).padStart(9)} ` +
    `${((drift >= 0 ? "+" : "") + drift.toFixed(1)).padStart(9)}`;

  if (problems.length === 0) {
    console.log(`${line}  ✓`);
  } else {
    console.log(`${line}  ✗`);
    problems.forEach(p => console.log(`     └ ${p}`));
    issues++;
  }
}

// 元画面に無い銘柄が混ざっていないか
for (const r of rows) {
  if (!EXPECTED.some(e => e.symbol === r.symbol)) {
    console.log(`?  ${r.symbol} ${r.name}: 元画面に存在しない銘柄  ✗`);
    issues++;
  }
}

// 合計値の確認
const totalValue = rows.reduce((s, r) => s + Number(r.quantity) * Number(r.currentPrice), 0);
const totalCost = rows.reduce((s, r) => s + Number(r.quantity) * Number(r.avgCost), 0);
const expectedTotal = EXPECTED.reduce((s, e) => s + e.marketValue, 0);
const expectedPnl = EXPECTED.reduce((s, e) => s + e.pnl, 0);

console.log("\n=== 合計 ===");
console.log(`銘柄数              : 登録 ${rows.length} / 元画面 ${EXPECTED.length} ${rows.length === EXPECTED.length ? "✓" : "✗"}`);
console.log(`取得原価合計        : ${fmt(Math.round(totalCost))} 円`);
console.log(`評価額合計（最新）  : ${fmt(Math.round(totalValue))} 円`);
console.log(`評価額合計（取込時）: ${fmt(expectedTotal)} 円`);
console.log(`含み損益（最新）    : ${fmt(Math.round(totalValue - totalCost))} 円（${(((totalValue - totalCost) / totalCost) * 100).toFixed(2)}%）`);
console.log(`含み損益（取込時）  : ${fmt(expectedPnl)} 円`);

// 業種が取得できているか
const noSector = rows.filter(r => !r.sector);
console.log(`\n業種未取得    : ${noSector.length === 0 ? "なし ✓" : noSector.map(r => r.symbol).join(", ")}`);

console.log(`\n=== 結果: ${issues === 0 ? `${checked} 銘柄すべて一致 ✓` : `${issues} 件の不一致 ✗`} ===`);
process.exit(issues === 0 ? 0 : 1);
