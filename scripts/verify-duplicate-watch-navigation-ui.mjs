import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function trpcGet(path) {
  const input = encodeURIComponent(JSON.stringify({ json: null }));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/trpc/${path}?input=${input}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok || body.error) {
        throw new Error(`${path}: ${body.error?.json?.message ?? response.status}`);
      }
      return body.result.data.json;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

async function openBrowser(width, height, port) {
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/investdash-duplicate-nav-${width}`,
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
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };
  const waitUntil = async (label, expression, attempts = 120) => {
    for (let index = 0; index < attempts; index += 1) {
      try {
        if (await evalValue(expression)) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`timeout waiting for ${label} at ${width}px`);
  };
  const clickExact = text =>
    evalValue(`(() => {
      const wanted = ${JSON.stringify(text.replace(/\s+/g, ""))};
      const el = [...document.querySelectorAll('button')].find(node => node.textContent?.replace(/\\s+/g, '').trim() === wanted);
      if (!el || el.disabled) return false;
      el.click(); return true;
    })()`);
  const setInput = (selector, value) =>
    evalValue(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  const navigate = async path => {
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await sleep(1000);
    await waitUntil(
      "document load",
      `document.readyState === 'complete' && Boolean(document.body?.textContent?.trim())`
    );
  };
  const openWatchDialog = async tickerCode => {
    await navigate("/watchlist");
    await waitUntil("watchlist", `document.body?.textContent?.includes('ウォッチリスト')`);
    await waitUntil(
      "add button",
      `[...document.querySelectorAll('button')].some(node => node.textContent?.replace(/\\s+/g, '').trim() === '銘柄を追加' && !node.disabled)`
    );
    if (!(await clickExact("銘柄を追加"))) throw new Error(`missing add button at ${width}px`);
    await waitUntil("add dialog", `document.querySelector('[role="dialog"]')?.textContent?.includes('ウォッチリストに追加')`);
    if (!(await setInput("#w-code", tickerCode))) throw new Error(`missing symbol input at ${width}px`);
    const lookupClicked = await evalValue(`(() => {
      const input = document.querySelector('#w-code');
      const button = input?.parentElement?.querySelector('button');
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`);
    if (!lookupClicked) throw new Error(`lookup button unavailable at ${width}px`);
  };
  const screenshot = async name => {
    const result = await send("Page.captureScreenshot", { format: "png" });
    const path = `/tmp/investdash-${name}-${width}.png`;
    await writeFile(path, Buffer.from(result.data, "base64"));
    return path;
  };

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  await navigate("/watchlist");
  await evalValue(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);

  return { chrome, socket, evalValue, waitUntil, clickExact, openWatchDialog, screenshot };
}

async function verify(width, height, port, watchRow, holdingPosition) {
  const browser = await openBrowser(width, height, port);
  try {
    await browser.openWatchDialog(watchRow.tickerCode);
    await browser.waitUntil(
      "existing watch status",
      `document.querySelector('[role="dialog"]')?.textContent?.includes('ウォッチリスト登録済み')`
    );

    const watchCta = watchRow.alreadyHeld ? "ウォッチカードを見る" : "登録済みの銘柄を見る";
    const duplicateState = await browser.evalValue(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return {
        watchRegistered: dialog?.textContent?.includes('ウォッチリスト登録済み') ?? false,
        holdingRegistered: dialog?.textContent?.includes('保有銘柄として登録済み') ?? false,
        addVisible: [...(dialog?.querySelectorAll('button') ?? [])].some(node => node.textContent?.trim() === 'この銘柄を追加'),
        watchCta: [...(dialog?.querySelectorAll('button') ?? [])].some(node => node.textContent?.trim() === ${JSON.stringify(watchCta)}),
        holdingCta: [...(dialog?.querySelectorAll('button') ?? [])].some(node => node.textContent?.trim() === '保有詳細を見る'),
      };
    })()`);

    if (!(await browser.clickExact(watchCta))) throw new Error(`missing ${watchCta} at ${width}px`);
    await browser.waitUntil(
      "focused watch card",
      `(() => {
        const card = document.querySelector('#watch-${watchRow.id}');
        const rect = card?.getBoundingClientRect();
        const openDialog = document.querySelector('[role="dialog"][data-state="open"]');
        return location.search === '?focus=${watchRow.id}' &&
          card?.className.includes('ring-sky-400/30') &&
          !openDialog && Boolean(rect && rect.bottom > 0 && rect.top < innerHeight);
      })()`
    );
    const watchResult = await browser.evalValue(`(() => {
      const card = document.querySelector('#watch-${watchRow.id}');
      const rect = card?.getBoundingClientRect();
      return {
        url: location.pathname + location.search,
        dialogClosed: !document.querySelector('[role="dialog"][data-state="open"]'),
        highlighted: card?.className.includes('ring-sky-400/30') ?? false,
        visible: Boolean(rect && rect.bottom > 0 && rect.top < innerHeight),
        scrollWidth: document.documentElement.scrollWidth,
      };
    })()`);
    const watchScreenshot = await browser.screenshot("duplicate-watch-focus");

    await browser.openWatchDialog(holdingPosition.tickerCode);
    await browser.waitUntil(
      "existing holding status",
      `document.querySelector('[role="dialog"]')?.textContent?.includes('保有銘柄として登録済み')`
    );
    const holdingState = await browser.evalValue(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return {
        holdingRegistered: dialog?.textContent?.includes('保有銘柄として登録済み') ?? false,
        holdingCta: [...(dialog?.querySelectorAll('button') ?? [])].some(node => node.textContent?.trim() === '保有詳細を見る'),
      };
    })()`);
    if (!(await browser.clickExact("保有詳細を見る"))) {
      throw new Error(`missing holding detail action at ${width}px`);
    }
    await browser.waitUntil(
      "holding detail route",
      `location.pathname.includes('/holdings/') &&
        document.body?.textContent?.includes(${JSON.stringify(holdingPosition.tickerCode)}) &&
        !document.querySelector('[role="dialog"][data-state="open"]')`
    );
    const holdingResult = await browser.evalValue(`(() => ({
      url: location.pathname + location.search,
      hasTicker: document.body?.textContent?.includes(${JSON.stringify(holdingPosition.tickerCode)}) ?? false,
      scrollWidth: document.documentElement.scrollWidth,
    }))()`);
    const holdingScreenshot = await browser.screenshot("duplicate-holding-detail");

    const passed =
      duplicateState.watchRegistered &&
      duplicateState.watchCta &&
      !duplicateState.addVisible &&
      (!watchRow.alreadyHeld || (duplicateState.holdingRegistered && duplicateState.holdingCta)) &&
      watchResult.dialogClosed &&
      watchResult.highlighted &&
      watchResult.visible &&
      watchResult.scrollWidth <= width &&
      holdingState.holdingRegistered &&
      holdingState.holdingCta &&
      holdingResult.hasTicker &&
      holdingResult.scrollWidth <= width;

    return {
      width,
      watch: {
        id: watchRow.id,
        symbol: watchRow.symbol,
        alreadyHeld: watchRow.alreadyHeld,
        duplicateState,
        ...watchResult,
      },
      holding: {
        id: holdingPosition.id,
        symbol: holdingPosition.symbol,
        ...holdingState,
        ...holdingResult,
      },
      screenshots: [watchScreenshot, holdingScreenshot],
      passed,
    };
  } finally {
    browser.socket.close();
    browser.chrome.kill("SIGTERM");
  }
}

const [watchRows, overview] = await Promise.all([
  trpcGet("watchlist.list"),
  trpcGet("portfolio.overview"),
]);
const watchSymbols = new Set(watchRows.map(row => row.symbol));
const preferred285A = watchRows.find(row => row.symbol === "285A.T");
const watchOnly = preferred285A ?? watchRows.find(row => !row.alreadyHeld) ?? watchRows[0];
const both = watchRows.find(row => row.alreadyHeld) ?? watchOnly;
const positions = overview.positions ?? [];
const holdingOnly = positions.find(position => !watchSymbols.has(position.symbol)) ?? positions[0];

if (!watchOnly || !both || !holdingOnly) {
  throw new Error("production data must contain at least one watch item and one holding");
}

const mobile = await verify(390, 844, 9280, watchOnly, holdingOnly);
const desktop = await verify(1280, 900, 9281, both, holdingOnly);
const result = { selected: { watchOnly: watchOnly.symbol, both: both.symbol, holdingOnly: holdingOnly.symbol }, mobile, desktop };
console.log(JSON.stringify(result, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
