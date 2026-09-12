import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-sort-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function trpcGet(path) {
  const input = encodeURIComponent(JSON.stringify({ json: null }));
  const response = await fetch(`${baseUrl}/api/trpc/${path}?input=${input}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.json?.message ?? `${path}: ${response.status}`);
  return body.result.data.json;
}

async function openBrowser(width, height, port) {
  const userDataDir = `/tmp/investdash-watch-annual-${process.pid}-${width}`;
  await rm(userDataDir, { recursive: true, force: true });
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let target;
  for (let index = 0; index < 100; index += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`missing Chrome target ${width}`);

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
  const evalValue = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitUntil = async (label, expression, attempts = 200) => {
    for (let index = 0; index < attempts; index += 1) {
      try {
        if (await evalValue(expression)) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`timeout waiting for ${label} at ${width}px`);
  };
  const navigate = async path => {
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil("document", "document.readyState === 'complete' && Boolean(document.body?.textContent?.trim())");
  };
  const screenshot = async name => {
    const result = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const path = `/tmp/investdash-${name}-${width}.png`;
    await writeFile(path, Buffer.from(result.data, "base64"));
    return path;
  };

  await send("Page.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)}); } catch {}`,
  });
  await navigate("/watchlist");
  return { chrome, socket, userDataDir, evalValue, waitUntil, navigate, screenshot };
}

async function setNativeInput(browser, selector, value) {
  await browser.evalValue(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('missing input: ${selector}');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}

async function verify(width, height, port, watchSymbol, savedCandidate) {
  const browser = await openBrowser(width, height, port);
  try {
    await browser.waitUntil("watchlist", "Boolean(document.querySelector('#watchlist-search'))");
    await browser.evalValue(
      `document.querySelector('[data-testid="long-term-chart-shell-${savedCandidate.symbol}"]')?.scrollIntoView({ block: 'start' })`
    );
    await browser.waitUntil(
      "saved AI candidate listing-to-date chart",
      `(() => { const shell = document.querySelector('[data-testid="long-term-chart-shell-${savedCandidate.symbol}"]'); return Boolean(document.querySelector('[data-testid="long-term-chart-${savedCandidate.symbol}"]')) && shell?.querySelector('button[aria-expanded="true"]') && shell?.querySelector('button[aria-pressed="true"]')?.textContent?.trim() === '上場来' && shell?.textContent?.includes('表示期間') && shell?.querySelectorAll('svg path').length > 0; })()`
    );
    const savedAiCandidate = await browser.evalValue(`(() => {
      const shell = document.querySelector('[data-testid="long-term-chart-shell-${savedCandidate.symbol}"]');
      const card = shell?.closest('.rounded-lg.border');
      const title = card ? [...card.querySelectorAll('*')].find(node => node.textContent?.trim() === ${JSON.stringify(savedCandidate.name)}) : null;
      return {
        chartLoaded: Boolean(document.querySelector('[data-testid="long-term-chart-${savedCandidate.symbol}"]')),
        expanded: [...(shell?.querySelectorAll('button') ?? [])].some(node => node.textContent?.includes('長期年足を見る') && node.getAttribute('aria-expanded') === 'true'),
        maxSelected: [...(shell?.querySelectorAll('button') ?? [])].some(node => node.textContent?.trim() === '上場来' && node.getAttribute('aria-pressed') === 'true'),
        belowTitle: Boolean(title && (title.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING)),
        targetLabel: shell?.textContent?.includes('買いたい値段') ?? false,
        dismissActionPresent: Boolean(card && [...card.querySelectorAll('button')].some(node => node.textContent?.trim() === '今後出さない')),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    const savedCandidateScreenshot = await browser.screenshot("watchlist-saved-ai-candidate-annual-chart");

    await setNativeInput(browser, "#watchlist-search", watchSymbol);
    await browser.waitUntil(
      "single watch card",
      `document.querySelectorAll('[data-watch-id]').length === 1 && document.querySelector('[data-watch-id]')?.textContent?.includes(${JSON.stringify(watchSymbol)})`
    );
    await browser.evalValue("document.querySelector('[data-watch-id]')?.scrollIntoView({ block: 'start' })");
    await browser.waitUntil(
      "watchlist listing-to-date chart",
      `(() => { const shell = document.querySelector('[data-testid="long-term-chart-shell-${watchSymbol}"]'); return Boolean(document.querySelector('[data-testid="long-term-chart-${watchSymbol}"]')) && shell?.querySelector('button[aria-pressed="true"]')?.textContent?.trim() === '上場来' && shell?.textContent?.includes('表示期間') && shell?.querySelectorAll('svg path').length > 0; })()`
    );
    const watch = await browser.evalValue(`(() => {
      const card = document.querySelector('[data-watch-id]');
      const shell = document.querySelector('[data-testid="long-term-chart-shell-${watchSymbol}"]');
      const title = [...card.querySelectorAll('*')].find(node => node.textContent?.trim() === ${JSON.stringify(watchSymbol)} || node.textContent?.includes(${JSON.stringify(watchSymbol)}));
      const toggle = [...shell.querySelectorAll('button')].find(node => node.textContent?.includes('長期年足を見る'));
      return {
        chartLoaded: Boolean(document.querySelector('[data-testid="long-term-chart-${watchSymbol}"]')),
        expanded: toggle?.getAttribute('aria-expanded') === 'true',
        maxSelected: [...shell.querySelectorAll('button')].some(node => node.textContent?.trim() === '上場来' && node.getAttribute('aria-pressed') === 'true'),
        belowTitle: Boolean(title && (title.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING)),
        targetLabel: shell.textContent?.includes('目標価格') ?? false,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    const watchScreenshot = await browser.screenshot("watchlist-annual-chart");

    await browser.navigate("/buy-plans");
    await browser.waitUntil("research search", `Boolean(document.querySelector('input[placeholder*="研究候補"]'))`);
    await setNativeInput(browser, 'input[placeholder*="研究候補"]', "TXN");
    await browser.waitUntil("TXN research card", `Boolean(document.querySelector('[data-testid="research-idea-TXN"]'))`);
    await browser.evalValue("document.querySelector('[data-testid=\"research-idea-TXN\"]')?.scrollIntoView({ block: 'start' })");
    await browser.waitUntil(
      "TXN listing-to-date chart",
      `(() => { const shell = document.querySelector('[data-testid="long-term-chart-shell-TXN"]'); return Boolean(document.querySelector('[data-testid="long-term-chart-TXN"]')) && shell?.querySelector('button[aria-pressed="true"]')?.textContent?.trim() === '上場来' && shell?.textContent?.includes('表示期間') && shell?.querySelectorAll('svg path').length > 0; })()`
    );
    const buyPlans = await browser.evalValue(`(() => {
      const card = document.querySelector('[data-testid="research-idea-TXN"]');
      const shell = document.querySelector('[data-testid="long-term-chart-shell-TXN"]');
      const title = [...card.querySelectorAll('*')].find(node => node.textContent?.trim() === 'Texas Instruments Incorporated');
      return {
        chartLoaded: Boolean(document.querySelector('[data-testid="long-term-chart-TXN"]')),
        maxSelected: [...shell.querySelectorAll('button')].some(node => node.textContent?.trim() === '上場来' && node.getAttribute('aria-pressed') === 'true'),
        belowTitle: Boolean(title && (title.compareDocumentPosition(shell) & Node.DOCUMENT_POSITION_FOLLOWING)),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    const buyPlansScreenshot = await browser.screenshot("buy-plans-annual-chart");

    return {
      width,
      savedAiCandidate,
      watch,
      buyPlans,
      savedCandidateScreenshot,
      watchScreenshot,
      buyPlansScreenshot,
      passed:
        savedAiCandidate.chartLoaded &&
        savedAiCandidate.expanded &&
        savedAiCandidate.maxSelected &&
        savedAiCandidate.belowTitle &&
        savedAiCandidate.targetLabel &&
        savedAiCandidate.dismissActionPresent &&
        savedAiCandidate.scrollWidth <= savedAiCandidate.clientWidth &&
        watch.chartLoaded &&
        watch.expanded &&
        watch.maxSelected &&
        watch.belowTitle &&
        watch.targetLabel &&
        watch.scrollWidth <= watch.clientWidth &&
        buyPlans.chartLoaded &&
        buyPlans.maxSelected &&
        buyPlans.belowTitle &&
        buyPlans.scrollWidth <= buyPlans.clientWidth,
    };
  } finally {
    browser.socket.close();
    browser.chrome.kill("SIGTERM");
    await sleep(500);
    await rm(browser.userDataDir, { recursive: true, force: true });
  }
}

const rows = await trpcGet("watchlist.list");
const savedCandidates = await trpcGet("portfolio.savedCandidates");
const savedCandidate = savedCandidates.find(row => !row.dismissed && !row.addedToWatchlist);
const watchSymbol = rows.find(row => row.symbol === "ITW" && row.targetNum != null)?.symbol
  ?? rows.find(row => row.targetNum != null && row.symbol.length >= 3)?.symbol
  ?? rows[0]?.symbol;
if (!watchSymbol) throw new Error("production watchlist is empty");
if (!savedCandidate) throw new Error("production saved AI candidate list is empty");
const mobile = await verify(390, 844, 9490, watchSymbol, savedCandidate);
const desktop = await verify(1280, 900, 9491, watchSymbol, savedCandidate);
console.log(JSON.stringify({ version: "0c5a250", rowCount: rows.length, savedCandidate: { symbol: savedCandidate.symbol, name: savedCandidate.name }, watchSymbol, mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
