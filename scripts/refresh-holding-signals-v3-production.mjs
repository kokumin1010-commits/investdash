import fs from "node:fs";

const base =
  process.env.INVESTDASH_BASE_URL ??
  "https://salesdash.buzzdrop.co.jp/investdash";
const tokenPath = process.env.INVESTDASH_TOKEN_FILE ?? "/tmp/prod-watch-token";
const token = fs.readFileSync(tokenPath, "utf8").trim();
if (!token) throw new Error(`Bearer token is empty: ${tokenPath}`);

const endpoint = `${base}/api/trpc/portfolio.regenerateAllSignals`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function callBatch(offset) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 175_000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ json: { offset, batchSize: 6 } }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(JSON.stringify(body.error ?? body));
      }
      return body.result.data.json;
    } catch (error) {
      lastError = error;
      console.error(`[signal-v3] offset=${offset} attempt=${attempt} failed`, error);
      if (attempt < 3) await sleep(attempt * 4_000);
    }
  }
  throw lastError;
}

let offset = 0;
let generated = 0;
const failed = [];
for (let batchNo = 1; batchNo <= 30; batchNo += 1) {
  const result = await callBatch(offset);
  generated += result.ok ?? 0;
  failed.push(...(result.failed ?? []));
  console.log(
    JSON.stringify({
      batchNo,
      offset,
      ok: result.ok,
      failed: result.failed,
      quotaExhausted: result.quotaExhausted,
      nextOffset: result.nextOffset,
      total: result.total,
    })
  );
  if (result.quotaExhausted) {
    console.log(JSON.stringify({ completed: false, generated, failed, reason: "quota" }));
    process.exitCode = 2;
    break;
  }
  if (result.nextOffset === null) {
    console.log(JSON.stringify({ completed: true, generated, failed }));
    break;
  }
  offset = result.nextOffset;
  await sleep(1_500);
}
