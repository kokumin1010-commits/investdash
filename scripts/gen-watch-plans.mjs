// ウォッチリストの未保有銘柄に AI が購入価格帯を提案する。
// AI 呼び出しは 1 銘柄 20 秒前後かかるため直列で回す。
const BASE = "http://127.0.0.1:3000";
const token = process.env.TOKEN;
if (!token) throw new Error("TOKEN env required");

const SYMBOLS = process.argv.slice(2);
if (SYMBOLS.length === 0) throw new Error("symbols required");

async function call(path, json) {
  const res = await fetch(`${BASE}/api/trpc/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ json }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

for (const symbol of SYMBOLS) {
  const started = Date.now();
  const out = await call("portfolio.generateWatchPricePlan", { symbol });
  const data = out?.result?.data?.json;
  const err = out?.error?.json?.message ?? out?.error?.message ?? out?.raw;
  const sec = ((Date.now() - started) / 1000).toFixed(1);
  if (data) {
    const bands = data.bands ?? data.plan?.bands ?? [];
    console.log(`${symbol} OK ${sec}s bands=${bands.length}`);
  } else {
    console.log(`${symbol} FAIL ${sec}s ${err}`);
  }
}
