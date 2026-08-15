/**
 * 複数口座で保有している銘柄のシグナルが、合計ポジションで判定されるか確認する。
 *
 * 期待する挙動:
 * - 1 銘柄につき 1 つのシグナルが生成される（口座ごとに別々にならない）
 * - プロンプトには合計株数・加重平均取得単価が使われる
 * - 口座別の内訳も判断材料として渡る
 *
 * 実行: node scripts/verify-multi-broker-signal.mjs
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = "http://localhost:3000";
const PASSCODE = process.env.SEED_PASSCODE ?? "1010";

async function call(path, body, token, method = "POST") {
  const url =
    method === "GET"
      ? `${BASE}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: body }))}`
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
const overview = await call("portfolio.overview", undefined, token, "GET");

const split = overview.groups.filter(g => g.isSplit);
console.log(`複数口座で保有している銘柄: ${split.length} 件\n`);

for (const g of split) {
  const calcQty = g.entries.reduce((a, e) => a + e.quantity, 0);
  const calcCost = g.entries.reduce((a, e) => a + e.avgCost * e.quantity, 0);
  const calcAvg = calcCost / calcQty;
  const qtyOk = Math.abs(calcQty - g.quantity) < 1e-6;
  const avgOk = Math.abs(calcAvg - g.avgCost) < 0.01;
  console.log(
    `${g.name}（${g.tickerCode}）  ${qtyOk && avgOk ? "OK" : "NG"}\n` +
      `  合計 ${g.quantity} 株 / 加重平均 ${g.avgCost.toFixed(2)} / 評価額 ${Math.round(g.marketValue)} / ${g.pnlPct?.toFixed(2)}%\n` +
      g.entries
        .map(e => `    - ${e.broker}: ${e.quantity} 株 @ ${e.avgCost} → ${e.pnlPct?.toFixed(2)}%`)
        .join("\n")
  );
}

// 代表 1 銘柄でシグナルを生成し、口座ごとに重複しないことを確認
const target = split[0];
if (!target) {
  console.log("\n複数口座の銘柄がないため、シグナル生成の確認はスキップします。");
  process.exit(0);
}

console.log(`\n${target.name} のシグナルを生成します（口座数 ${target.entries.length}）…`);
const before = await call("portfolio.signalHistory", { symbol: target.symbol }, token, "GET");
const started = Date.now();
const sig = await call("portfolio.regenerateSignal", { id: target.entries[0].id }, token);
console.log(
  `  → ${sig.action}（確信度 ${sig.confidence}） ${Math.round((Date.now() - started) / 1000)} 秒`
);
console.log(`  根拠: ${sig.rationale.slice(0, 160)}…`);

const after = await call("portfolio.signalHistory", { symbol: target.symbol }, token, "GET");
console.log(`\nシグナル履歴: ${before.length} 件 → ${after.length} 件（+${after.length - before.length}）`);
console.log(after.length - before.length === 1 ? "1 件だけ増えました（重複なし）" : "想定外: 増加数が 1 ではありません");

// 一括分析の対象件数が銘柄数と一致するか（口座数ではない）
const batch = await call("portfolio.regenerateAllSignals", { offset: 0, batchSize: 1 }, token);
console.log(
  `\n一括分析の総件数: ${batch.total}（保有レコード数 ${overview.positions.length} / 銘柄数 ${overview.groups.length}）`
);
console.log(
  batch.total === overview.groups.length
    ? "銘柄数と一致（重複分析なし）"
    : "想定外: 銘柄数と一致していません"
);
