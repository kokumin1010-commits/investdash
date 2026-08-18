/**
 * 財務データの取得可否を追加で実測する。
 *
 * 1 回目の実測で get_stock_profile は summaryProfile しか返さず、
 * get_stock_insights は米国株のみ valuation を返すことが分かった。
 * ここでは region を市場に合わせて指定した場合と、
 * get_stock_chart の meta に何が入っているかを確認する。
 */
import { callDataApi } from "../server/_core/dataApi.ts";

const SAMPLES = [
  { symbol: "7203.T", region: "US", label: "日本株（トヨタ）region=US" },
  { symbol: "0823.HK", region: "HK", label: "香港株（リンク）region=HK" },
  { symbol: "A17U.SI", region: "SG", label: "SG株（CapitaLand）region=SG" },
  { symbol: "INTC", region: "US", label: "米国株（Intel）region=US" },
];

function raw(v) {
  if (v === null || v === undefined) return null;
  return typeof v === "object" && "raw" in v ? v.raw : v;
}

for (const { symbol, region, label } of SAMPLES) {
  console.log("=".repeat(70));
  console.log(label);
  console.log("-".repeat(70));

  // profile を region 指定で
  try {
    const p = await callDataApi("YahooFinance/get_stock_profile", {
      query: { symbol, region, lang: "en-US" },
    });
    const r = p?.quoteSummary?.result?.[0] ?? {};
    console.log(`  profile モジュール: ${Object.keys(r).join(", ") || "なし"}`);
    // トップレベルにも入っている可能性を確認
    const top = Object.keys(p ?? {}).filter(k => k !== "quoteSummary");
    if (top.length) console.log(`  profile トップレベル: ${top.join(", ")}`);
  } catch (e) {
    console.log(`  profile エラー: ${String(e).slice(0, 100)}`);
  }

  // chart の meta に何が入るか
  try {
    const c = await callDataApi("YahooFinance/get_stock_chart", {
      query: { symbol, region, interval: "1mo", range: "5y" },
    });
    const meta = c?.chart?.result?.[0]?.meta ?? {};
    console.log(`  chart meta のキー: ${Object.keys(meta).join(", ")}`);
    const ts = c?.chart?.result?.[0]?.timestamp ?? [];
    const closes = c?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter(v => v !== null);
    console.log(`  月足の本数: ${ts.length}（有効な終値 ${valid.length}）`);
    if (valid.length >= 2) {
      const first = valid[0];
      const last = valid[valid.length - 1];
      console.log(
        `  5 年の値動き: ${first?.toFixed(2)} → ${last?.toFixed(2)}（${(((last - first) / first) * 100).toFixed(1)}%）`
      );
    }
  } catch (e) {
    console.log(`  chart エラー: ${String(e).slice(0, 100)}`);
  }

  // holders（配当や自己株買いの手掛かりになるか）
  try {
    const h = await callDataApi("YahooFinance/get_stock_holders", {
      query: { symbol, region, lang: "en-US" },
    });
    const r = h?.quoteSummary?.result?.[0] ?? {};
    console.log(`  holders モジュール: ${Object.keys(r).join(", ") || "なし"}`);
  } catch (e) {
    console.log(`  holders エラー: ${String(e).slice(0, 100)}`);
  }
}
