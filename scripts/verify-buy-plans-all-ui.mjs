import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-sort-token", "utf8")
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scenarios = [
  { name: "mobile", width: 390, height: 844, port: 9590 },
  { name: "desktop", width: 1280, height: 900, port: 9591 },
];

async function verify(scenario) {
  const profile = await mkdtemp(join(tmpdir(), `investdash-buy-all-${scenario.name}-`));
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-cache",
      `--remote-debugging-port=${scenario.port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${scenario.width},${scenario.height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  let target;
  for (let i = 0; i < 100; i += 1) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${scenario.port}/json/list`)
      ).json();
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl)
    throw new Error(`missing target ${scenario.name}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error
      ? waiter.reject(new Error(message.error.message))
      : waiter.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitUntil = async (label, expression) => {
    for (let i = 0; i < Number(process.env.UI_WAIT_ATTEMPTS ?? 360); i += 1) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`timeout ${label} ${scenario.name}`);
  };

  try {
    await send("Page.enable");
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Emulation.setDeviceMetricsOverride", {
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
      mobile: scenario.width < 768,
    });
    const path = `/buy-plans?verify=${Date.now()}`;
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil("document", "document.readyState === 'complete'");
    await evaluate(
      `localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`
    );
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil(
      "strict existing holding candidates",
      "Boolean(document.querySelector('[data-testid=\"existing-holding-add-panel\"]')) && document.body?.innerText.includes('未保有・購入判断')"
    );
    const state = await evaluate(`(() => {
      const body = document.body.innerText;
      const ranked = document.querySelector('[data-testid="existing-holding-add-panel"]');
      const text = ranked?.innerText ?? '';
      const cards = ranked
        ? ranked.querySelectorAll('[data-testid^="existing-holding-add-candidate-"]')
        : [];
      return {
        hasUnheldSection: body.includes('未保有・購入判断'),
        strictHeading: text.includes('既存保有・今月の買い増し検討順'),
        strictFunnel:
          text.includes('価格帯内') &&
          text.includes('安全ゲート通過') &&
          text.includes('厳格確認済み'),
        concreteSizing:
          text.includes('買い増し目安') &&
          text.includes('保有株数') &&
          text.includes('実行後') &&
          text.includes('実行後構成比'),
        confirmationOnly: text.includes('検討用の参考案であり、注文ではありません'),
        separatedHoldingSignal: text.includes('AI保有シグナルの HOLD'),
        savedAiOverlay: body.includes('AI補足見解（保存済み・手動更新）'),
        staleSavedAiSeparated:
          body.includes('現在の買い増し候補数には含めていません') ||
          body.includes('まだ提案がありません'),
        rankedCardCount: cards.length,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    await evaluate(`document.querySelector('[data-testid="existing-holding-add-panel"]')?.scrollIntoView({ block: 'start', inline: 'nearest' })`);
    await sleep(400);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-buy-all-${scenario.name}.png`;
    await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
    const passed =
      state.hasUnheldSection &&
      state.strictHeading &&
      state.strictFunnel &&
      state.concreteSizing &&
      state.confirmationOnly &&
      state.separatedHoldingSignal &&
      state.savedAiOverlay &&
      state.staleSavedAiSeparated &&
      state.rankedCardCount > 0 &&
      state.scrollWidth <= state.clientWidth;
    return { ...scenario, ...state, screenshotPath, passed };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

const results = [];
for (const scenario of scenarios) results.push(await verify(scenario));
console.log(
  JSON.stringify({ version: "strict-existing-holding-add-v1", results }, null, 2)
);
if (results.some(result => !result.passed)) process.exitCode = 1;
