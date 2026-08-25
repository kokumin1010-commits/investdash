/**
 * Restore the 27 moomoo Japan holdings verified against IMG_7555/7597/7598.
 * Source of truth: docs/holdings-verification.md and scripts/verify-holdings.mjs.
 */
import dotenv from "dotenv";

dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";

const POSITIONS = [
  ["7270", "SUBARU", 1900, 4859250, -1580450, 2557.5],
  ["9023", "東京地下鉄", 3500, 5096000, -418250, 1456],
  ["3653", "モルフォ", 2400, 1639200, -412800, 683],
  ["6526", "ソシオネクスト", 300, 597450, -103200, 1991.5],
  ["2267", "ヤクルト本社", 400, 1153800, -83000, 2884.5],
  ["4661", "オリエンタルランド", 100, 300100, -70800, 3001],
  ["4755", "楽天グループ", 200, 152280, -39940, 761.4],
  ["7751", "キヤノン", 400, 1862400, -30400, 4656],
  ["4901", "富士フイルムホールディングス", 400, 1331600, 8600, 3329],
  ["8410", "セブン銀行", 7100, 2386310, 33560, 336.1],
  ["7267", "本田技研工業", 1500, 2487000, 105750, 1658],
  ["9202", "ANAホールディングス", 600, 1875600, 142250, 3126],
  ["9432", "NTT", 17500, 2847250, 176750, 162.7],
  ["4005", "住友化学", 2500, 1326250, 216760, 530.5],
  ["7261", "マツダ", 2600, 3039400, 283400, 1169],
  ["8053", "住友商事", 400, 716400, 389600, 1791],
  ["4911", "資生堂", 700, 2489900, 600150, 3557],
  ["3778", "さくらインターネット", 800, 3096000, 628000, 3870],
  ["8031", "三井物産", 400, 1930000, 640000, 4825],
  ["8473", "SBIホールディングス", 1200, 3684000, 1267200, 3070],
  ["2768", "双日", 1600, 9094400, 1400200, 5684],
  ["3436", "SUMCO", 700, 2744000, 1923908.82, 3920],
  ["6920", "レーザーテック", 100, 3882000, 2311000, 38820],
  ["8411", "みずほフィナンシャルグループ", 500, 4310000, 2542000, 8620],
  ["6752", "パナソニックホールディングス", 800, 3776800, 2600800, 4721],
  ["4919", "ミルボン", 3000, 9750000, 2745000, 3250],
  ["8604", "野村ホールディングス", 7900, 12403000, 3457840, 1570],
];

async function call(path, body, token) {
  const response = await fetch(`${BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ json: body }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(`${path}: ${payload.error.json.message}`);
  return payload.result.data.json;
}

const { token } = await call("auth.unlock", { passcode: PASSCODE });
const rows = POSITIONS.map(([code, name, quantity, marketValue, pnl, currentPrice]) => ({
  name,
  tickerCode: code,
  symbol: `${code}.T`,
  market: "JP",
  quantity,
  avgCost: Math.round(((marketValue - pnl) / quantity) * 100) / 100,
  currentPrice,
  marketValue,
  pnl,
  confidence: 100,
  mode: "NEW",
}));

const result = await call(
  "import.applyRows",
  { rows, cashBalance: 1255302, formatId: "moomoo_jp" },
  token
);

console.log(
  JSON.stringify(
    { source: "moomoo_verified", requested: rows.length, ...result },
    null,
    2
  )
);
