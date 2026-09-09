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
  const profile = await mkdtemp(join(tmpdir(), `investdash-real-unheld-${scenario.name}-`));
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
    for (let i = 0; i < 240; i += 1) {
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
    const path = `/buy-plans?view=unheld&verify=${Date.now()}`;
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil("document", "document.readyState === 'complete'");
    await evaluate(
      `localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`
    );
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil(
      "real unheld candidates",
      "document.body?.innerText.includes('未保有・購入判断') && document.body?.innerText.includes('未保有 3 銘柄・今すぐ検討 0 銘柄') && document.body?.innerText.includes('現在、今すぐ購入を検討できる未保有候補はありません')"
    );
    const state = await evaluate(`(() => {
      const body = document.body.innerText;
      const unheld = document.querySelector('[data-testid="unheld-quality-opportunities"]');
      const cards = unheld ? unheld.querySelectorAll('[data-testid^="unheld-candidate-"]') : [];
      const zeroHoldingLabels = unheld
        ? [...unheld.querySelectorAll('*')].filter(node => node.textContent?.trim() === '未保有・0株')
        : [];
      const verifiedHoldingLabels = unheld
        ? [...unheld.querySelectorAll('*')].filter(node => node.textContent?.trim() === '全口座合算の実保有を確認済み')
        : [];
      return {
        hasUnheldSection: body.includes('未保有・購入判断'),
        hasRealCount: body.includes('未保有 3 銘柄・今すぐ検討 0 銘柄'),
        unheldCardCount: cards.length,
        zeroHoldingLabelCount: zeroHoldingLabels.length,
        verifiedHoldingLabelCount: verifiedHoldingLabels.length,
        hasQcom: body.includes('QCOM 高通'),
        hasAsml: body.includes('ASML'),
        hasKioxia: body.includes('キオクシアホールディングス'),
        hasNoCurrentBuy: body.includes('現在、今すぐ購入を検討できる未保有候補はありません'),
        hasOldHypotheticalLabel: body.includes('仮に未保有なら買う'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    await evaluate(`(() => {
      const node = [...document.querySelectorAll('h2')].find(
        element => element.textContent?.trim() === '未保有・購入判断'
      );
      node?.scrollIntoView({ block: 'start', inline: 'nearest' });
    })()`);
    await sleep(400);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-real-unheld-${scenario.name}.png`;
    await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
    await send("Page.navigate", { url: `${baseUrl}/holdings?verify=${Date.now()}` });
    await waitUntil("holdings", "document.body?.innerText.includes('保有銘柄')");
    const holdingsState = await evaluate(`(() => ({
      hasHypotheticalFilter: [...document.querySelectorAll('option')].some(option => option.textContent?.includes('仮に未保有なら買う')),
      hasHypotheticalBody: document.body.innerText.includes('仮に未保有なら買う'),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))()`);
    await send("Page.navigate", {
      url: `${baseUrl}/holdings?lens=BUY_NOW&verify=${Date.now()}`,
    });
    await waitUntil(
      "legacy BUY_NOW redirect",
      "location.pathname.endsWith('/buy-plans') && location.search.includes('view=unheld')"
    );
    const legacyRedirectUrl = await evaluate("location.href");
    const passed =
      state.hasUnheldSection &&
      state.hasRealCount &&
      state.unheldCardCount === 3 &&
      state.zeroHoldingLabelCount === 3 &&
      state.verifiedHoldingLabelCount === 3 &&
      state.hasQcom &&
      state.hasAsml &&
      state.hasKioxia &&
      state.hasNoCurrentBuy &&
      !state.hasOldHypotheticalLabel &&
      state.scrollWidth <= state.clientWidth &&
      !holdingsState.hasHypotheticalFilter &&
      !holdingsState.hasHypotheticalBody &&
      holdingsState.scrollWidth <= holdingsState.clientWidth &&
      legacyRedirectUrl.includes('/buy-plans?view=unheld');
    return { ...scenario, ...state, holdingsState, legacyRedirectUrl, screenshotPath, passed };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

const results = [];
for (const scenario of scenarios) results.push(await verify(scenario));
console.log(JSON.stringify({ version: "6d9e8ec", results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
