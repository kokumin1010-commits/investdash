/**
 * 富途證券 香港（保證金綜合帳戶 3891）の登録スクリプト。
 *
 * 原本データは docs/futu-hk-holdings-source.md（2026-08-17 10:33 時点の画面）。
 * 證券 12 銘柄（美股 5・港股 4・日股 3）と、基金タブの貨幣市場基金 4 本を登録する。
 *
 * この口座は保證金綜合帳戶だが現金残高がプラス（JPY 217,385）で借入はない。
 * 「最大購買力 101,734,885」は使っていない与信枠なので負債として記録しない。
 *
 * 基金は株式ではなく利息で増える現金性資産なので interestAssets へ入れる。
 * 株式の含み損益に混ぜると「株で儲かったのか利息で増えたのか」が分からなくなるため。
 *
 * 実行: node scripts/seed-futu-hk.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.SEED_BASE ?? "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";
const BROKER = "futu_hk";

/**
 * 證券タブの 12 銘柄。数量・成本は画面表示のまま。
 * 現在値は株価 API から取得するので持たせない（画面の値は遅延値のため）。
 *
 * AMD の成本はマイナス。オプションのプレミアム受取が購入代金を上回ったため。
 * 含み益 +82,931.66 から逆算した値が画面表示 −38.4877 と一致することを確認済み。
 */
const ROWS = [
  // 美股（USD）
  { code: "AMD", suffix: "US", name: "アドバンスト・マイクロ・デバイセズ", qty: 150, avgCost: -38.4877 },
  { code: "KO", suffix: "US", name: "コカ・コーラ", qty: 9, avgCost: 60.887 },
  { code: "NVDA", suffix: "US", name: "エヌビディア", qty: 0.5, avgCost: 132.99 },
  { code: "UNH", suffix: "US", name: "ユナイテッドヘルス・グループ", qty: 90, avgCost: 277.508 },
  { code: "UPS", suffix: "US", name: "ユナイテッド・パーセル・サービス", qty: 200, avgCost: 97.515 },
  // 港股（HKD）
  { code: "0005", suffix: "HK", name: "HSBCホールディングス", qty: 129, avgCost: 68.319 },
  { code: "0823", suffix: "HK", name: "リンク・リート", qty: 5600, avgCost: 39.603 },
  { code: "0883", suffix: "HK", name: "中国海洋石油", qty: 8000, avgCost: 17.023 },
  { code: "2318", suffix: "HK", name: "中国平安保険", qty: 10500, avgCost: 48.728 },
  // 日股（JPY）
  { code: "6902", suffix: "JP", name: "デンソー", qty: 1100, avgCost: 1947.0 },
  { code: "7203", suffix: "JP", name: "トヨタ自動車", qty: 1000, avgCost: 2712.0 },
  { code: "8058", suffix: "JP", name: "三菱商事", qty: 800, avgCost: 2340.5 },
];

/**
 * 基金タブの貨幣市場基金 4 本。年約 3.4%・毎日付利・複利（利用者の申告）。
 * dailyIncome は画面の「昨日收益」、cumulativeIncome は「累計收益」。
 */
const FUNDS = [
  { name: "易方達(香港)美元貨幣市場基金", currency: "USD", amount: 145297.62, dailyIncome: 8.66, cumulativeIncome: 697.62 },
  { name: "平安貨幣基金", currency: "USD", amount: 370671.26, dailyIncome: 37.88, cumulativeIncome: 2308.49 },
  { name: "華夏精選美元貨幣基金", currency: "USD", amount: 70684.66, dailyIncome: 6.73, cumulativeIncome: 571.81 },
  { name: "高騰微財貨幣基金", currency: "HKD", amount: 37556.86, dailyIncome: 2.19, cumulativeIncome: 839.74 },
];

/** 画面表示の検算値（2026-08-17 10:33 時点） */
const EXPECTED = {
  usValueUsd: 135138.19,
  usPlUsd: 95811.7,
  hkValueHkd: 1004926.67,
  hkPlHkd: 126446.21,
  jpValueJpy: 8935950.0,
  jpPlJpy: 2209850.0,
  /** 證券市值（JPY 表示）。02:14 時点の値なので参考 */
  securitiesValueJpy: 50852072.43,
  /** 基金の資産淨值（JPY 表示） */
  fundValueJpy: 94347006.23,
  /** 幣種別の現金。JPY のみプラス */
  cashJpy: 217385.0,
};

/** 市場サフィックスから symbol・market・currency を決める */
function resolve(row) {
  switch (row.suffix) {
    case "JP":
      // 日本株は .T を付けないと他口座の同一銘柄と合算されず株価取得も失敗する
      return { symbol: `${row.code}.T`, market: "JP", currency: "JPY" };
    case "HK":
      // 香港株は 4 桁ゼロ埋めコード + .HK（Yahoo Finance の形式）
      return { symbol: `${row.code}.HK`, market: "HK", currency: "HKD" };
    case "US":
      return { symbol: row.code, market: "US", currency: "USD" };
    default:
      throw new Error(`未知のサフィックス: ${row.suffix}`);
  }
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
  return {
    name: row.name,
    tickerCode: row.code,
    symbol,
    market,
    quantity: row.qty,
    avgCost: Number(row.avgCost.toFixed(4)),
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

console.log(`${rows.length} 銘柄を富途香港として登録します…`);
for (const m of ["US", "HK", "JP"]) {
  const n = rows.filter(r => r.market === m).length;
  if (n > 0) console.log(`  ${m}: ${n} 銘柄`);
}

const negative = ROWS.filter(r => r.avgCost < 0);
if (negative.length > 0) {
  console.log("\n取得原価がマイナスの銘柄（損益率は算出せず「原価回収済み」と表示される）:");
  for (const r of negative) {
    console.log(`  ${r.code} @ ${r.avgCost}（総原価 ${(r.qty * r.avgCost).toFixed(2)}）`);
  }
}

/*
 * 現金残高は幣種別の JPY 217,385 を渡す。
 * 「最大購買力 101,734,885」は使っていない与信枠なので負債にはしない。
 */
const result = await call(
  "import.applyRows",
  { rows, cashBalance: null, formatId: BROKER },
  token
);
console.log(`\n新規 ${result.created} / 更新 ${result.updated} / スキップ ${result.skipped.length}`);
if (result.skipped.length) console.log("スキップ:", result.skipped);

/* --- 基金（貨幣市場基金）--- */
console.log("\n貨幣市場基金を登録します…");
for (const f of FUNDS) {
  await call(
    "portfolio.saveInterestAsset",
    {
      broker: BROKER,
      name: f.name,
      currency: f.currency,
      amount: f.amount,
      annualRatePct: 3.4,
      dailyIncome: f.dailyIncome,
      cumulativeIncome: f.cumulativeIncome,
      compounding: true,
      notes: "富途香港 現金宝。毎日利息が付き元本に組み入れられる（複利）",
    },
    token
  );
  console.log(`  ${f.name}: ${f.currency} ${f.amount.toLocaleString()}`);
}

console.log("\n株価を取得します…");
const sync = await call("portfolio.syncPrices", {}, token);
console.log(`更新 ${sync.updated} 件 / 失敗 ${sync.failed.length} 件`);
if (sync.failed.length) console.log("失敗:", sync.failed);

const overview = await call("portfolio.overview", undefined, token, "GET");
console.log(`\n登録後: ${overview.groups.length} 銘柄 / ${overview.positions.length} 口座レコード`);
for (const b of overview.brokers ?? []) {
  console.log(`  ${b.label}: ${b.count} 銘柄 / ${Math.round(b.value).toLocaleString()} 円`);
}

/* --- 検算 --- */
const settings = await call("portfolio.settings", undefined, token, "GET");
const usdJpy = Number(settings.usdJpyRate);
const hkdJpy = Number(settings.hkdJpyRate);
console.log(`\n=== 検算（USD/JPY = ${usdJpy} / HKD/JPY = ${hkdJpy}）===`);

const futu = overview.positions.filter(p => p.broker === BROKER);
const byMarket = { US: [], HK: [], JP: [] };
for (const p of futu) {
  if (byMarket[p.market]) byMarket[p.market].push(p);
}

function report(label, list, expectedValue, expectedPl, rate) {
  const value = list.reduce((a, p) => a + (p.marketValue ?? 0), 0);
  const pl = list.reduce((a, p) => a + (p.pnl ?? 0), 0);
  const dv = expectedValue > 0 ? ((value - expectedValue) / expectedValue) * 100 : 0;
  console.log(
    `${label}: 評価額 ${value.toFixed(2)}（画面 ${expectedValue}）差 ${dv.toFixed(3)}% / 含み損益 ${pl.toFixed(2)}（画面 ${expectedPl}）`
  );
  return { value, pl, valueJpy: value * rate };
}

const us = report("美股（USD）", byMarket.US, EXPECTED.usValueUsd, EXPECTED.usPlUsd, usdJpy);
const hk = report("港股（HKD）", byMarket.HK, EXPECTED.hkValueHkd, EXPECTED.hkPlHkd, hkdJpy);
const jp = report("日股（JPY）", byMarket.JP, EXPECTED.jpValueJpy, EXPECTED.jpPlJpy, 1);

const stockJpy = us.valueJpy + hk.valueJpy + jp.valueJpy;
const diffStock = ((stockJpy - EXPECTED.securitiesValueJpy) / EXPECTED.securitiesValueJpy) * 100;
console.log(
  `\n株式時価合計: ${Math.round(stockJpy).toLocaleString()} 円（画面の證券市值 ${EXPECTED.securitiesValueJpy.toLocaleString()}）差 ${diffStock.toFixed(3)}%`
);

/* 基金の検算 */
const interest = overview.summary.interestAssetsBase;
const diffFund = ((interest - EXPECTED.fundValueJpy) / EXPECTED.fundValueJpy) * 100;
console.log(
  `基金合計: ${Math.round(interest).toLocaleString()} 円（画面の資産淨值 ${EXPECTED.fundValueJpy.toLocaleString()}）差 ${diffFund.toFixed(3)}%`
);
console.log(
  `基金の見込み利息: 年 ${Math.round(overview.summary.interestIncomeBase).toLocaleString()} 円（実効 ${overview.summary.interestRatePct?.toFixed(4)}%）`
);

/* 原価回収済みの銘柄が率を出していないことを確認 */
const amd = futu.find(p => p.tickerCode === "AMD");
if (amd) {
  console.log(
    `\nAMD: 評価額 ${amd.marketValue?.toFixed(2)} USD / 含み損益 ${amd.pnl?.toFixed(2)} / 損益率 ${amd.pnlPct === null ? "出さない（原価回収済み）" : `${amd.pnlPct.toFixed(2)}% ← 想定外`}`
  );
}
