/**
 * 四市場（日本株・米国株・香港株・SG株）で、シグナル判定に使いたい財務指標が
 * 実際に取得できるかを実測する。
 *
 * 目的は「米国株だけ判定が濃くなる」事態を先に把握すること。
 * 以前ウォッチリストの決算日を取ろうとした際、日本株・香港株・SG 株では
 * Yahoo Finance がほとんど何も返さなかったため、同じことが起きないか確かめる。
 */
import { callDataApi } from "../server/_core/dataApi.ts";

const SAMPLES = [
  { symbol: "7203.T", label: "日本株（トヨタ）" },
  { symbol: "8058.T", label: "日本株（三菱商事）" },
  { symbol: "NVDA", label: "米国株（NVIDIA）" },
  { symbol: "INTC", label: "米国株（Intel）" },
  { symbol: "0823.HK", label: "香港株（リンク・リート）" },
  { symbol: "2318.HK", label: "香港株（中国平安）" },
  { symbol: "A17U.SI", label: "SG株（CapitaLand Ascendas）" },
  { symbol: "D05.SI", label: "SG株（DBS）" },
];

/** 欲しい指標と、Yahoo Finance のどのモジュールに入っているか */
const WANTED = {
  // 時価総額・PER・利回りなど
  summaryDetail: ["marketCap", "trailingPE", "forwardPE", "priceToBook"],
  // 収益性・成長性
  financialData: [
    "profitMargins",
    "operatingMargins",
    "returnOnEquity",
    "returnOnAssets",
    "revenueGrowth",
    "earningsGrowth",
    "freeCashflow",
    "operatingCashflow",
    "totalDebt",
    "debtToEquity",
    "currentPrice",
  ],
  defaultKeyStatistics: [
    "trailingEps",
    "forwardEps",
    "enterpriseValue",
    "profitMargins",
    "returnOnEquity",
    "earningsQuarterlyGrowth",
  ],
};

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null) continue;
    // Yahoo は { raw, fmt } 形式で返すことがある
    out[k] = typeof v === "object" && v !== null && "raw" in v ? v.raw : v;
  }
  return out;
}

async function probe(symbol, label) {
  const found = {};
  const missing = [];

  // get_stock_insights は財務スコアを持つ
  let insights = null;
  try {
    insights = await callDataApi("YahooFinance/get_stock_insights", {
      query: { symbol },
    });
  } catch (e) {
    insights = { __error: String(e).slice(0, 80) };
  }

  // get_stock_profile に summaryProfile 以外が入っていないか確認
  let profile = null;
  try {
    profile = await callDataApi("YahooFinance/get_stock_profile", {
      query: { symbol, region: "US", lang: "en-US" },
    });
  } catch (e) {
    profile = { __error: String(e).slice(0, 80) };
  }

  const profileResult = profile?.quoteSummary?.result?.[0] ?? {};
  const profileModules = Object.keys(profileResult);

  for (const [mod, keys] of Object.entries(WANTED)) {
    const got = pick(profileResult[mod], keys);
    if (Object.keys(got).length > 0) found[mod] = got;
    else missing.push(mod);
  }

  // insights から使える指標
  const ins = insights?.finance?.result ?? {};
  const insKeys = Object.keys(ins);
  const techEvents = ins?.instrumentInfo?.technicalEvents ?? null;
  const valuation = ins?.instrumentInfo?.valuation ?? null;
  const companySnapshot = ins?.companySnapshot ?? null;

  console.log("=".repeat(70));
  console.log(`${label}  ${symbol}`);
  console.log("-".repeat(70));
  console.log(`  get_stock_profile のモジュール: ${profileModules.join(", ") || "（なし）"}`);
  if (profile?.__error) console.log(`  profile エラー: ${profile.__error}`);
  for (const [mod, got] of Object.entries(found)) {
    console.log(`  [${mod}] ${JSON.stringify(got)}`);
  }
  if (missing.length > 0) console.log(`  取得できないモジュール: ${missing.join(", ")}`);

  console.log(`  get_stock_insights のキー: ${insKeys.join(", ") || "（なし）"}`);
  if (insights?.__error) console.log(`  insights エラー: ${insights.__error}`);
  if (valuation) console.log(`  valuation: ${JSON.stringify(valuation)}`);
  if (companySnapshot) {
    const co = companySnapshot.company ?? {};
    const sec = companySnapshot.sector ?? {};
    console.log(`  companySnapshot.company: ${JSON.stringify(co)}`);
    console.log(`  companySnapshot.sector: ${JSON.stringify(sec)}`);
  }
  if (techEvents) {
    console.log(`  technicalEvents のキー: ${Object.keys(techEvents).join(", ")}`);
  }
}

for (const s of SAMPLES) {
  await probe(s.symbol, s.label);
}
