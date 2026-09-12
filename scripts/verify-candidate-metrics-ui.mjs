import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";

const token = (
  await readFile(
    process.env.DEV_TOKEN_FILE ?? "/tmp/prod-candidate-metrics-token",
    "utf8"
  )
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function trpcGet(path, json = null) {
  const input = encodeURIComponent(JSON.stringify({ json }));
  const response = await fetch(`${baseUrl}/api/trpc/${path}?input=${input}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.json?.message ?? `${path}: ${response.status}`);
  }
  return body.result.data.json;
}

async function openBrowser(width, height, port) {
  const userDataDir = `/tmp/investdash-candidate-metrics-${process.pid}-${width}`;
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
      const targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`missing Chrome target ${width}`);
  }

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
  const evalValue = async expression => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitUntil = async (label, expression, attempts = 300) => {
    for (let index = 0; index < attempts; index += 1) {
      try {
        if (await evalValue(expression)) return;
      } catch {}
      await sleep(500);
    }
    const diagnostic = await evalValue(`(() => ({
      url: location.href,
      title: document.title,
      bodyText: document.body?.innerText?.slice(0, 3000) ?? '',
      metricIds: [...document.querySelectorAll('[data-testid^="candidate-metrics-"]')].map(node => node.getAttribute('data-testid')),
      researchIds: [...document.querySelectorAll('[data-testid^="research-idea-"]')].map(node => node.getAttribute('data-testid')),
      watchIds: [...document.querySelectorAll('[data-watch-id]')].map(node => node.getAttribute('data-watch-id')),
    }))()`);
    console.error(JSON.stringify({ label, width, diagnostic }, null, 2));
    throw new Error(`timeout waiting for ${label} at ${width}px`);
  };
  const navigate = async path => {
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil(
      "document",
      "document.readyState === 'complete' && Boolean(document.body?.textContent?.trim())"
    );
  };
  const screenshot = async name => {
    const result = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
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

  return {
    chrome,
    socket,
    userDataDir,
    evalValue,
    waitUntil,
    navigate,
    screenshot,
  };
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

function metricExpression(symbol, closestSelector = null) {
  const selector = `[data-testid="candidate-metrics-${symbol}"]`;
  const root = closestSelector
    ? `document.querySelector(${JSON.stringify(closestSelector)})?.querySelector(${JSON.stringify(selector)})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  return `(() => { const node = ${root}; const text = node?.innerText ?? ''; return Boolean(node) && !text.includes('取得中') && text.includes('予想配当利回り') && text.includes('PER') && text.includes('PBR') && text.includes('時価総額') && text.includes('市場基準') && text.includes('Yahoo Finance fundamentals-timeseries'); })()`;
}

function collectExpression(symbol, closestSelector = null) {
  const selector = `[data-testid="candidate-metrics-${symbol}"]`;
  const root = closestSelector
    ? `document.querySelector(${JSON.stringify(closestSelector)})?.querySelector(${JSON.stringify(selector)})`
    : `document.querySelector(${JSON.stringify(selector)})`;
  return `(() => {
    const node = ${root};
    const text = node?.innerText ?? '';
    const core = ['予想配当利回り', 'PER', 'PBR', '時価総額'].every(label => text.includes(label));
    return {
      present: Boolean(node),
      core,
      source: text.includes('Yahoo Finance fundamentals-timeseries'),
      dates: text.includes('市場基準') && text.includes('会計期末'),
      currentZero: text.includes('現在保有') && text.includes('0 株'),
      firstBuy: text.includes('初回株数・金額') && text.includes('JPY'),
      afterWeight: text.includes('購入後構成比'),
      tranches: text.includes('分割') && text.includes('回想定'),
      constraints: text.includes('現金性資産') || text.includes('上限') || text.includes('リスク'),
      disclosure: text.includes('自動注文ではありません'),
      unavailableHonest: !text.includes('NaN') && !text.includes('undefined'),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  })()`;
}

async function expandDetails(browser, symbol) {
  await browser.evalValue(`(() => {
    const node = document.querySelector('[data-testid="candidate-metrics-${symbol}"]');
    const button = node?.querySelector('button[aria-expanded]');
    if (button?.getAttribute('aria-expanded') === 'false') button.click();
  })()`);
  await browser.waitUntil(
    `${symbol} metric details`,
    `document.querySelector('[data-testid="candidate-metrics-${symbol}"]')?.innerText?.includes('自動注文ではありません') ?? false`
  );
}

async function verify(width, height, port, savedCandidate, watchSymbol) {
  const browser = await openBrowser(width, height, port);
  try {
    await browser.navigate("/watchlist");
    await browser.waitUntil(
      "saved AI candidate metrics",
      metricExpression(savedCandidate.symbol)
    );
    await browser.evalValue(
      `document.querySelector('[data-testid="candidate-metrics-${savedCandidate.symbol}"]')?.scrollIntoView({ block: 'start' })`
    );
    await expandDetails(browser, savedCandidate.symbol);
    const saved = await browser.evalValue(
      collectExpression(savedCandidate.symbol)
    );
    const savedScreenshot = await browser.screenshot("candidate-metrics-saved-ai");

    await setNativeInput(browser, "#watchlist-search", watchSymbol);
    await browser.waitUntil(
      "watchlist card metrics",
      metricExpression(watchSymbol)
    );
    await browser.evalValue(
      `document.querySelector('[data-testid="candidate-metrics-${watchSymbol}"]')?.closest('[data-watch-id]')?.scrollIntoView({ block: 'start' })`
    );
    await expandDetails(browser, watchSymbol);
    const watch = await browser.evalValue(collectExpression(watchSymbol));
    const watchScreenshot = await browser.screenshot("candidate-metrics-watchlist");

    await browser.navigate("/buy-plans");
    await browser.waitUntil(
      "research search",
      `Boolean(document.querySelector('input[placeholder*="研究候補"]'))`
    );
    await setNativeInput(
      browser,
      'input[placeholder*="研究候補"]',
      "TXN"
    );
    await browser.waitUntil(
      "TXN research metrics",
      metricExpression("TXN", '[data-testid="research-idea-TXN"]')
    );
    await browser.evalValue(
      `document.querySelector('[data-testid="research-idea-TXN"]')?.scrollIntoView({ block: 'start' })`
    );
    await expandDetails(browser, "TXN");
    const research = await browser.evalValue(
      collectExpression("TXN", '[data-testid="research-idea-TXN"]')
    );
    const researchScreenshot = await browser.screenshot("candidate-metrics-research");

    await browser.waitUntil(
      "strict data-wait sizing",
      `(() => { const card = document.querySelector('[data-testid^="unheld-candidate-"]'); return Boolean(card) && card.innerText.includes('暫定計算不可'); })()`
    );
    const strict = await browser.evalValue(`(() => {
      const card = document.querySelector('[data-testid^="unheld-candidate-"]');
      return {
        present: Boolean(card),
        blocked: card?.innerText.includes('暫定計算不可') ?? false,
        noForcedAmount: card?.innerText.includes('条件通過後に再計算') ?? false,
      };
    })()`);

    const result = {
      width,
      saved,
      watch,
      research,
      strict,
      screenshots: {
        saved: savedScreenshot,
        watch: watchScreenshot,
        research: researchScreenshot,
      },
    };
    result.passed =
      [saved, watch, research].every(
        row =>
          row.present &&
          row.core &&
          row.source &&
          row.dates &&
          row.currentZero &&
          row.firstBuy &&
          row.afterWeight &&
          row.tranches &&
          row.constraints &&
          row.disclosure &&
          row.unavailableHonest &&
          row.scrollWidth <= row.clientWidth
      ) &&
      strict.present &&
      strict.blocked &&
      strict.noForcedAmount;
    return result;
  } finally {
    browser.socket.close();
    browser.chrome.kill("SIGTERM");
    await sleep(500);
    await rm(browser.userDataDir, { recursive: true, force: true });
  }
}

const watchRows = await trpcGet("watchlist.list");
const savedCandidates = await trpcGet("portfolio.savedCandidates");
const savedCandidate =
  savedCandidates.find(
    row => row.symbol === "D" && !row.dismissed && !row.addedToWatchlist
  ) ??
  savedCandidates.find(row => !row.dismissed && !row.addedToWatchlist);
const watchRow =
  watchRows.find(row => !row.alreadyHeld && row.symbol === "SO") ??
  watchRows.find(row => !row.alreadyHeld) ??
  watchRows[0];
if (!savedCandidate) throw new Error("saved AI candidate list is empty");
if (!watchRow) throw new Error("watchlist is empty");

await trpcGet("portfolio.candidateCardInsights", {
  symbols: Array.from(
    new Set([savedCandidate.symbol, watchRow.symbol, "TXN", "QCOM"])
  ),
});

const mobile = await verify(
  390,
  844,
  9590,
  savedCandidate,
  watchRow.symbol
);
const desktop = await verify(
  1280,
  900,
  9591,
  savedCandidate,
  watchRow.symbol
);
const report = {
  version: "21d051c",
  savedCandidate: {
    symbol: savedCandidate.symbol,
    name: savedCandidate.name,
  },
  watchSymbol: watchRow.symbol,
  mobile,
  desktop,
};
console.log(JSON.stringify(report, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
