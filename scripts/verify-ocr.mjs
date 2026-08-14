/**
 * 実データのスクリーンショットで OCR 精度を検証するスクリプト。
 *
 * 使い方:
 *   node scripts/verify-ocr.mjs /path/to/image.png
 *   node scripts/verify-ocr.mjs --format moomoo_jp /path/to/image.png
 *
 * --format を付けると、そのアプリのレイアウト定義をプロンプトに含めて検証する。
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const args = process.argv.slice(2);
let formatId = null;
const files = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--format") {
    formatId = args[++i];
  } else {
    files.push(args[i]);
  }
}

if (files.length === 0) {
  console.error("画像パスを指定してください");
  process.exit(1);
}

const apiUrl = process.env.BUILT_IN_FORGE_API_URL;
const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
if (!apiUrl || !apiKey) {
  console.error("BUILT_IN_FORGE_API_URL / BUILT_IN_FORGE_API_KEY が未設定です");
  process.exit(1);
}

const basePrompt = fs
  .readFileSync(path.join(process.cwd(), "server/services/ocr.ts"), "utf8")
  .match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1];

if (!basePrompt) {
  console.error("SYSTEM_PROMPT を ocr.ts から抽出できませんでした");
  process.exit(1);
}

/** brokerFormats.ts から指定フォーマットの layoutPrompt を取り出す */
function readLayoutPrompt(id) {
  if (!id) return null;
  const source = fs.readFileSync(
    path.join(process.cwd(), "server/services/brokerFormats.ts"),
    "utf8"
  );
  const blocks = source.split(/const [A-Z_]+: BrokerFormat = \{/);
  for (const block of blocks) {
    if (!block.includes(`id: "${id}"`)) continue;
    const match = block.match(/layoutPrompt: `([\s\S]*?)`,\s*\n\};/);
    if (match) return match[1];
  }
  return null;
}

const layoutPrompt = readLayoutPrompt(formatId);
if (formatId && !layoutPrompt) {
  console.warn(`警告: "${formatId}" のレイアウト定義が見つかりません。汎用ルールで検証します。`);
}

const SYSTEM_PROMPT = layoutPrompt ? `${basePrompt}\n\n---\n\n${layoutPrompt}` : basePrompt;

const SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "portfolio_extraction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        positions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              tickerCode: { type: "string" },
              quantity: { type: ["number", "null"] },
              avgCost: { type: ["number", "null"] },
              currentPrice: { type: ["number", "null"] },
              marketValue: { type: ["number", "null"] },
              pnl: { type: ["number", "null"] },
              confidence: { type: "number" },
            },
            required: [
              "name",
              "tickerCode",
              "quantity",
              "avgCost",
              "currentPrice",
              "marketValue",
              "pnl",
              "confidence",
            ],
            additionalProperties: false,
          },
        },
        account: {
          type: "object",
          properties: {
            netAssets: { type: ["number", "null"] },
            cash: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            broker: { type: ["string", "null"] },
          },
          required: ["netAssets", "cash", "currency", "broker"],
          additionalProperties: false,
        },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: ["positions", "account", "warnings"],
      additionalProperties: false,
    },
  },
};

function toDataUrl(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

const content = [
  {
    type: "text",
    text:
      files.length > 1
        ? `${files.length} 枚のスクリーンショットです。同一口座の連続した画面として扱い、重複行は 1 件にまとめてください。`
        : "このスクリーンショットから保有ポジションを抽出してください。",
  },
  ...files.map(f => ({ type: "image_url", image_url: { url: toDataUrl(f), detail: "high" } })),
];

const started = Date.now();
console.log(
  `フォーマット: ${formatId ?? "generic"}${layoutPrompt ? "（レイアウト定義あり）" : "（汎用ルール）"}`
);
const res = await fetch(`${apiUrl}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: "gemini-3.1-pro-preview",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content },
    ],
    response_format: SCHEMA,
    max_tokens: 16384,
  }),
});

if (!res.ok) {
  console.error("APIエラー", res.status, (await res.text()).slice(0, 500));
  process.exit(1);
}

const json = await res.json();
const text = json.choices?.[0]?.message?.content;
const parsed = JSON.parse(text);

console.log(`所要時間: ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log("\n=== 口座情報 ===");
console.log(JSON.stringify(parsed.account, null, 2));
console.log("\n=== 抽出ポジション ===");
console.table(
  parsed.positions.map(p => ({
    コード: p.tickerCode,
    銘柄: p.name,
    数量: p.quantity,
    取得単価: p.avgCost,
    現在値: p.currentPrice,
    評価額: p.marketValue,
    損益: p.pnl,
    確度: p.confidence,
  }))
);
console.log("\n=== 警告 ===");
console.log(parsed.warnings.join("\n") || "(なし)");

// 整合性チェック: 評価額 ≒ 数量 × 現在値
console.log("\n=== 整合性チェック ===");
for (const p of parsed.positions) {
  if (p.quantity && p.currentPrice && p.marketValue) {
    const calc = p.quantity * p.currentPrice;
    const diff = Math.abs(calc - p.marketValue) / p.marketValue;
    const ok = diff < 0.005;
    console.log(
      `${ok ? "OK  " : "NG  "} ${p.tickerCode} ${p.name}: 数量×現在値=${calc.toLocaleString()} vs 評価額=${p.marketValue.toLocaleString()} (差${(diff * 100).toFixed(2)}%)`
    );
  }
  if (p.quantity && p.avgCost && p.marketValue && p.pnl !== null) {
    const calcCost = (p.marketValue - p.pnl) / p.quantity;
    const diff = Math.abs(calcCost - p.avgCost) / p.avgCost;
    const ok = diff < 0.01;
    console.log(
      `${ok ? "OK  " : "NG  "} ${p.tickerCode} 取得単価: 逆算=${calcCost.toFixed(2)} vs 抽出=${p.avgCost} (差${(diff * 100).toFixed(2)}%)`
    );
  }
}
