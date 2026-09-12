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
  { name: "mobile", width: 390, height: 844, port: 9630 },
  { name: "desktop", width: 1280, height: 900, port: 9631 },
];

async function verify(scenario) {
  const profile = await mkdtemp(join(tmpdir(), `investdash-research-pool-${scenario.name}-`));
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
      const targets = await (await fetch(`http://127.0.0.1:${scenario.port}/json/list`)).json();
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`missing target ${scenario.name}`);
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
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
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
    for (let i = 0; i < 300; i += 1) {
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
    await evaluate(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil(
      "research pool",
      "document.body?.innerText.includes('未保有・研究候補') && document.body?.innerText.includes('25 / 目安 24 銘柄')"
    );
    const initial = await evaluate(`(() => {
      const body = document.body.innerText;
      const pool = document.querySelector('[data-testid="unheld-research-pool"]');
      return {
        strictCountPreserved: body.includes('未保有 3 銘柄・今すぐ検討 0 銘柄'),
        poolCount: pool?.querySelectorAll('[data-testid^="research-idea-"]').length ?? 0,
        hasLrcx: body.includes('LRCX') && body.includes('Lam Research'),
        hasResearchDisclaimer: body.includes('ここへの掲載は購入推奨ではなく'),
        hasGenerateButton: [...document.querySelectorAll('button')].some(button => button.textContent?.includes('別の研究候補を追加')),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent?.includes('残り 13 件も表示'));
      button?.click();
    })()`);
    await waitUntil(
      "all research cards",
      "document.querySelectorAll('[data-testid^=research-idea-]').length === 25"
    );
    await evaluate(`(() => {
      const input = document.querySelector('input[placeholder="研究候補を銘柄名・コード・業種で検索"]');
      input?.focus();
      input?.select();
    })()`);
    await send("Input.insertText", { text: "LRCX" });
    await waitUntil(
      "research search",
      "document.querySelectorAll('[data-testid^=research-idea-]').length === 1 && Boolean(document.querySelector('[data-testid=research-idea-LRCX]'))"
    );
    await evaluate(`(() => {
      const card = document.querySelector('[data-testid=research-idea-LRCX]');
      const button = [...card.querySelectorAll('button')].find(node => node.textContent?.includes('長期年足を見る'));
      button?.click();
    })()`);
    await waitUntil(
      "long term chart",
      "document.querySelector('[data-testid=long-term-chart-LRCX]') && document.body.innerText.includes('表示期間')"
    );
    const finalState = await evaluate(`(() => {
      const pool = document.querySelector('[data-testid="unheld-research-pool"]');
      const chart = document.querySelector('[data-testid="long-term-chart-LRCX"]');
      chart?.scrollIntoView({ block: 'center', inline: 'nearest' });
      return {
        visibleCardCountAfterSearch: pool?.querySelectorAll('[data-testid^="research-idea-"]').length ?? 0,
        hasChart: Boolean(chart),
        hasTenYear: chart?.innerText.includes('10年') ?? false,
        hasTwentyYear: chart?.innerText.includes('20年') ?? false,
        hasMax: chart?.innerText.includes('上場来') ?? false,
        hasAdjustedNote: chart?.innerText.includes('株式分割調整済み価格') ?? false,
        hasCurrentPrice: chart?.innerText.includes('現在値') ?? false,
        hasTarget: chart?.innerText.includes('調査目標') ?? false,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    await sleep(500);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-research-pool-${scenario.name}.png`;
    await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
    const passed =
      initial.strictCountPreserved &&
      initial.poolCount === 12 &&
      initial.hasLrcx &&
      initial.hasResearchDisclaimer &&
      initial.hasGenerateButton &&
      initial.scrollWidth <= initial.clientWidth &&
      finalState.visibleCardCountAfterSearch === 1 &&
      finalState.hasChart &&
      finalState.hasTenYear &&
      finalState.hasTwentyYear &&
      finalState.hasMax &&
      finalState.hasAdjustedNote &&
      finalState.hasCurrentPrice &&
      finalState.hasTarget &&
      finalState.scrollWidth <= finalState.clientWidth;
    return { ...scenario, initial, finalState, screenshotPath, passed };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

const results = [];
for (const scenario of scenarios) results.push(await verify(scenario));
console.log(JSON.stringify({ version: "9c37bc6", results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
