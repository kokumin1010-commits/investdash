import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

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

const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const timestamp = row => {
  const value = new Date(row.createdAt).getTime();
  return Number.isFinite(value) ? value : 0;
};
const newest = (a, b) => timestamp(b) - timestamp(a) || b.id - a.id;
const oldest = (a, b) => timestamp(a) - timestamp(b) || a.id - b.id;
const distance = row => {
  if (row.reachedTarget || (row.gapPct != null && row.gapPct >= 0)) return 0;
  return row.gapPct == null ? Number.POSITIVE_INFINITY : Math.abs(row.gapPct);
};
const expectedOrder = (rows, key) =>
  [...rows]
    .sort((a, b) => {
      if (key === "NEWEST") return newest(a, b);
      if (key === "OLDEST") return oldest(a, b);
      if (key === "PRIORITY") return priorityOrder[a.priority] - priorityOrder[b.priority] || newest(a, b) || a.symbol.localeCompare(b.symbol);
      return distance(a) - distance(b) || priorityOrder[a.priority] - priorityOrder[b.priority] || newest(a, b) || a.symbol.localeCompare(b.symbol);
    })
    .map(row => row.id);

async function openBrowser(width, height, port) {
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/investdash-watch-sort-${process.pid}-${width}`,
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let target;
  for (let index = 0; index < 80; index += 1) {
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
  const waitUntil = async (label, expression, attempts = 160) => {
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
  await navigate("/watchlist");
  await evalValue(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);
  await navigate("/watchlist");
  return { chrome, socket, evalValue, waitUntil, screenshot };
}

async function verify(width, height, port, rows) {
  const browser = await openBrowser(width, height, port);
  const keys = ["NEWEST", "OLDEST", "PRIORITY", "TARGET_NEAREST"];
  const orders = {};
  try {
    await browser.waitUntil(
      "watchlist search and sort controls",
      "Boolean(document.querySelector('#watchlist-search')) && Boolean(document.querySelector('#watchlist-sort')) && document.querySelectorAll('[data-watch-id]').length > 0"
    );
    const labels = await browser.evalValue(
      "[...document.querySelectorAll('#watchlist-sort option')].map(option => option.textContent?.trim())"
    );
    for (const key of keys) {
      await browser.evalValue(`(() => {
        const select = document.querySelector('#watchlist-sort');
        select.value = ${JSON.stringify(key)};
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      const expected = expectedOrder(rows, key);
      await browser.waitUntil(
        key,
        `JSON.stringify([...document.querySelectorAll('[data-watch-id]')].map(node => Number(node.dataset.watchId))) === ${JSON.stringify(JSON.stringify(expected))}`
      );
      orders[key] = await browser.evalValue(
        "[...document.querySelectorAll('[data-watch-id]')].map(node => ({id:Number(node.dataset.watchId),symbol:node.textContent?.match(/[A-Z0-9]+(?:\\.[A-Z]+)?/)?.[0] ?? ''})).slice(0,5)"
      );
    }

    const setSearch = async value => {
      await browser.evalValue(`(() => {
        const input = document.querySelector('#watchlist-search');
        if (!input) throw new Error('missing watchlist search input');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
    };
    const eix = rows.find(row => row.symbol === "EIX");
    await setSearch("  eix  ");
    await browser.waitUntil(
      "EIX symbol search",
      `document.querySelectorAll('[data-watch-id]').length === 1 && Number(document.querySelector('[data-watch-id]')?.dataset.watchId) === ${eix?.id ?? -1}`
    );
    const symbolSearch = await browser.evalValue(`({
      value: document.querySelector('#watchlist-search')?.value ?? '',
      countText: document.body.textContent?.includes('${rows.length} 件中 1 件を表示') ?? false,
      eixVisible: document.querySelector('[data-watch-id]')?.textContent?.includes('EIX') ?? false,
      clearVisible: [...document.querySelectorAll('button')].some(node => node.textContent?.trim() === 'クリア'),
    })`);

    const nameNeedle = (eix?.name ?? "Edison").split(/\s+/)[0].toLocaleLowerCase("en-US");
    await setSearch(nameNeedle);
    await browser.waitUntil(
      "EIX name search",
      `document.querySelectorAll('[data-watch-id]').length === 1 && Number(document.querySelector('[data-watch-id]')?.dataset.watchId) === ${eix?.id ?? -1}`
    );
    const nameSearch = await browser.evalValue(
      `document.querySelector('[data-watch-id]')?.textContent?.includes(${JSON.stringify(eix?.name ?? "")}) ?? false`
    );

    await setSearch("not-found-symbol");
    await browser.waitUntil(
      "search empty state",
      "document.querySelectorAll('[data-watch-id]').length === 0 && document.body.textContent?.includes('一致する銘柄がありません')"
    );
    const emptyState = await browser.evalValue(`({
      title: document.body.textContent?.includes('一致する銘柄がありません') ?? false,
      clearButton: [...document.querySelectorAll('button')].some(node => node.textContent?.trim() === '検索をクリア'),
    })`);
    await browser.evalValue(`(() => {
      const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === '検索をクリア');
      button?.click();
    })()`);
    await browser.waitUntil(
      "cleared search",
      `document.querySelectorAll('[data-watch-id]').length === ${rows.length} && document.querySelector('#watchlist-search')?.value === ''`
    );

    await browser.evalValue(`(() => {
      const select = document.querySelector('#watchlist-sort');
      select.value = 'NEWEST';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.scrollIntoView({ block: 'center' });
    })()`);
    await sleep(400);
    const state = await browser.evalValue(`({
      countText: document.body.textContent?.includes('購入検討中の銘柄 ${rows.length} 件') ?? false,
      selected: document.querySelector('#watchlist-sort')?.value ?? null,
      newestSummary: document.body.textContent?.includes('追加が新しい順') && document.body.textContent?.includes('${rows.length} 件を表示') || false,
      eixFirst: Number(document.querySelector('[data-watch-id]')?.dataset.watchId) === ${rows.find(row => row.symbol === "EIX")?.id ?? -1},
      eixDateVisible: [...document.querySelectorAll('[data-watch-id]')].find(node => Number(node.dataset.watchId) === ${rows.find(row => row.symbol === "EIX")?.id ?? -1})?.textContent?.includes('追加') ?? false,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    })`);
    const screenshot = await browser.screenshot("watchlist-sort");
    return {
      width,
      labels,
      orders,
      symbolSearch,
      nameSearch,
      emptyState,
      ...state,
      screenshot,
      passed:
        labels?.length === 4 &&
        symbolSearch.countText &&
        symbolSearch.eixVisible &&
        symbolSearch.clearVisible &&
        nameSearch &&
        emptyState.title &&
        emptyState.clearButton &&
        state.countText &&
        state.selected === "NEWEST" &&
        state.newestSummary &&
        state.eixFirst &&
        state.eixDateVisible &&
        state.scrollWidth <= state.clientWidth,
    };
  } finally {
    browser.socket.close();
    browser.chrome.kill("SIGTERM");
  }
}

const rows = await trpcGet("watchlist.list");
if (!rows.some(row => row.symbol === "EIX")) throw new Error("EIX must exist in production watchlist");
const mobile = await verify(390, 844, 9390, rows);
const desktop = await verify(1280, 900, 9391, rows);
console.log(JSON.stringify({ version: "8c631c7", rowCount: rows.length, mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
