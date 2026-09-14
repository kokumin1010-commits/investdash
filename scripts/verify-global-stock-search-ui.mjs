import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/global-stock-search-token", "utf8")
).trim();
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openBrowser(width, height, port) {
  const userDataDir = `/tmp/investdash-global-search-${process.pid}-${width}`;
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
  const waitUntil = async (label, expression, attempts = 240) => {
    for (let index = 0; index < attempts; index += 1) {
      try {
        if (await evalValue(expression)) return;
      } catch {}
      await sleep(500);
    }
    const diagnostic = await evalValue(
      `({ url: location.href, text: document.body?.innerText?.slice(0, 4000) ?? '' })`
    );
    throw new Error(`${label} timeout at ${width}px: ${JSON.stringify(diagnostic)}`);
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

  return { chrome, socket, userDataDir, send, evalValue, waitUntil, screenshot };
}

async function enterAndSearch(browser, value) {
  await browser.evalValue(`(() => {
    const input = document.querySelector('#global-stock-query');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    input?.closest('form')?.requestSubmit();
  })()`);
}

async function verify(width, height, port) {
  const browser = await openBrowser(width, height, port);
  try {
    await browser.send("Page.navigate", { url: `${baseUrl}/` });
    await browser.waitUntil(
      "global stock search",
      `Boolean(document.querySelector('[data-testid="global-stock-search"]'))`
    );

    await enterAndSearch(browser, "V03");
    await browser.waitUntil(
      "V03.SI search result",
      `Boolean(document.querySelector('[data-testid="global-stock-result-V03.SI"]'))`
    );
    const codeResult = await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="global-stock-result-V03.SI"]');
      const text = node?.innerText ?? '';
      return {
        present: Boolean(node),
        name: text.includes('Venture Corporation Limited'),
        symbol: text.includes('V03.SI'),
        market: text.includes('シンガポール株'),
        currencyValue: text.includes('SGD'),
        addAction: text.includes('ウォッチリストに追加'),
      };
    })()`);

    await enterAndSearch(browser, "Venture");
    await browser.waitUntil(
      "Venture name search result",
      `Boolean(document.querySelector('[data-testid="global-stock-result-V03.SI"]'))`
    );
    const nameResult = await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="global-stock-result-V03.SI"]');
      const input = document.querySelector('#global-stock-query');
      const inputRect = input?.getBoundingClientRect();
      return {
        present: Boolean(node),
        topSearch: Boolean(input),
        inputVisible: Boolean(inputRect && inputRect.top >= 0 && inputRect.bottom <= window.innerHeight),
        noInvalid: !document.body.innerText.includes('undefined') && !document.body.innerText.includes('NaN'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);

    await browser.evalValue(`(() => {
      const input = document.querySelector('#global-stock-query');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await browser.waitUntil(
      "recent V03.SI search",
      `Boolean(document.querySelector('[data-testid="recent-stock-search-V03.SI"]'))`
    );
    const recentResult = await browser.evalValue(`(() => {
      const region = document.querySelector('[data-testid="recent-stock-searches"]');
      const rows = [...document.querySelectorAll('[data-testid^="recent-stock-search-"]')];
      const node = document.querySelector('[data-testid="recent-stock-search-V03.SI"]');
      const text = node?.innerText ?? '';
      return {
        region: Boolean(region),
        oneVenture: rows.filter(row => row.getAttribute('data-testid') === 'recent-stock-search-V03.SI').length === 1,
        name: text.includes('Venture Corporation Limited'),
        symbol: text.includes('V03.SI'),
        market: text.includes('シンガポール株'),
        clearAction: Boolean([...document.querySelectorAll('button')].find(button => button.textContent?.includes('すべて削除'))),
      };
    })()`);
    await browser.evalValue(
      `document.querySelector('[data-testid="global-stock-search"]')?.scrollIntoView({ block: 'start' })`
    );
    await sleep(300);
    const screenshotPath = await browser.screenshot("global-stock-search");
    const passed =
      Object.values(codeResult).every(Boolean) &&
      nameResult.present &&
      nameResult.topSearch &&
      nameResult.inputVisible &&
      nameResult.noInvalid &&
      nameResult.scrollWidth <= nameResult.clientWidth &&
      Object.values(recentResult).every(Boolean);
    return {
      width,
      passed,
      codeResult,
      nameResult,
      recentResult,
      screenshot: screenshotPath,
      recentHistoryRecorded: true,
      watchlistWritePerformed: false,
      deletePerformed: false,
    };
  } finally {
    browser.socket.close();
    browser.chrome.kill("SIGTERM");
    await sleep(500);
    await rm(browser.userDataDir, { recursive: true, force: true });
  }
}

const mobile = await verify(390, 844, 9790);
const desktop = await verify(1280, 900, 9791);
const report = { baseUrl, mobile, desktop };
console.log(JSON.stringify(report, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
