/**
 * iSPEED 追加 26 銘柄が元画面（IMG_7620 / 7621 / 7623）どおりに登録されたか照合する。
 *
 * 実行: node scripts/verify-ispeed2.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";

/** 元画面の値（コード, 名称, 株数, 取得単価, 現在値） */
const EXPECTED = [
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
  ["7203", "トヨタ自動車", 8100, 2581.16, 3020],
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
const ov = await call("portfolio.overview", undefined, token, "GET");

// 楽天口座のレコードだけを対象に照合する
const rakuten = new Map();
for (const p of ov.positions) {
  if (p.broker === "rakuten_ispeed") rakuten.set(p.tickerCode, p);
}

let ng = 0;
console.log("コード  銘柄                                   株数        取得単価     判定");
for (const [code, name, qty, cost] of EXPECTED) {
  const p = rakuten.get(code);
  if (!p) {
    console.log(`${code}  ${name.padEnd(20, "　")}  未登録`);
    ng += 1;
    continue;
  }
  const qtyOk = Math.abs(p.quantity - qty) < 1e-6;
  const costOk = Math.abs(p.avgCost - cost) < 0.01;
  const nameOk = p.name === name;
  const ok = qtyOk && costOk;
  if (!ok) ng += 1;
  console.log(
    `${code}  ${name.padEnd(20, "　")} ${String(p.quantity).padStart(7)}株 ` +
      `${p.avgCost.toFixed(2).padStart(10)}  ${ok ? "OK" : "NG"}` +
      (qtyOk ? "" : ` 株数期待=${qty}`) +
      (costOk ? "" : ` 単価期待=${cost}`) +
      (nameOk ? "" : `（名称: ${p.name}）`)
  );
}

console.log(`\n照合対象 ${EXPECTED.length} 件 / 不一致 ${ng} 件`);

// 業種の取得状況
const noSector = EXPECTED.map(e => rakuten.get(e[0])).filter(p => p && !p.sector);
console.log(`業種未取得: ${noSector.length} 件${noSector.length ? " → " + noSector.map(p => p.tickerCode).join(", ") : ""}`);

// 全体状況
console.log(
  `\n全体: ${ov.groups.length} 銘柄 / ${ov.positions.length} 口座レコード / 複数口座 ${ov.groups.filter(g => g.isSplit).length} 銘柄`
);
for (const b of ov.brokers) {
  console.log(`  ${b.label}: ${Math.round(b.value).toLocaleString()} 円（${b.count} 銘柄・${b.pct.toFixed(1)}%）`);
}
console.log(`総評価額: ${Math.round(ov.summary.totalValueBase).toLocaleString()} 円`);

// 複数口座銘柄の合算検算
console.log("\n--- 複数口座で保有する銘柄の合算検算 ---");
let bad = 0;
for (const g of ov.groups.filter(x => x.isSplit)) {
  const q = g.entries.reduce((a, e) => a + e.quantity, 0);
  const c = g.entries.reduce((a, e) => a + e.avgCost * e.quantity, 0) / q;
  const ok = Math.abs(q - g.quantity) < 1e-6 && Math.abs(c - g.avgCost) < 0.01;
  if (!ok) bad += 1;
  console.log(
    `${ok ? "OK" : "NG"} ${g.name}: ${g.quantity}株 @${g.avgCost.toFixed(2)} ` +
      `[${g.entries.map(e => `${e.broker.replace("_jp", "").replace("rakuten_", "")}:${e.quantity}株`).join(" / ")}]`
  );
}
console.log(`合算の不一致: ${bad} 件`);
