import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-token", "utf8")
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openBrowser(width, height, port) {
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/investdash-holding-dividend-${width}`,
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  let target;
  for (let index = 0; index < 80; index += 1) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl)
    throw new Error(`missing Chrome target ${width}`);

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
    await waitUntil(
      "document",
      `document.readyState === 'complete' && Boolean(document.body?.textContent?.trim())`
    );
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
  await navigate("/holdings");
  await evalValue(
    `localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`
  );
  return { chrome, socket, evalValue, waitUntil, navigate, screenshot };
}

async function verify({ width, height, port, id, expected }) {
  const browser = await openBrowser(width, height, port);
  try {
    await browser.navigate(`/holdings/${id}`);
    await browser.waitUntil(
      "dividend and actual holding action",
      `(() => {
        const dividend = document.querySelector('[data-testid="holding-dividend-summary"]');
        const action = document.querySelector('[data-testid="holding-action-summary"]');
        return dividend?.textContent?.includes('予想配当利回り') &&
          dividend.textContent.includes(${JSON.stringify(expected.yieldText)}) &&
          dividend.textContent.includes('年間配当見込') &&
          dividend.textContent.includes(${JSON.stringify(expected.incomeText)}) &&
          dividend.textContent.includes('直近12か月実績ベース') &&
          action?.textContent?.includes(${JSON.stringify(expected.actionText)}) &&
          action.textContent.includes(${JSON.stringify(expected.executionText)});
      })()`
    );
    await browser.evalValue(
      `document.querySelector('[data-testid="holding-dividend-summary"]')?.scrollIntoView({block:'start'})`
    );
    await sleep(300);
    const dividendScreenshot = await browser.screenshot(
      `holding-dividend-${expected.symbol}`
    );
    await browser.evalValue(
      `document.querySelector('[data-testid="holding-action-summary"]')?.scrollIntoView({block:'center'})`
    );
    await sleep(300);
    const actionScreenshot = await browser.screenshot(
      `holding-action-${expected.symbol}`
    );
    const state = await browser.evalValue(`(() => {
      const dividend = document.querySelector('[data-testid="holding-dividend-summary"]');
      const action = document.querySelector('[data-testid="holding-action-summary"]');
      const reference = [...document.querySelectorAll('details')].find(node => node.textContent?.includes('参考視点'));
      return {
        dividendText: dividend?.textContent ?? '',
        actionText: action?.textContent ?? '',
        referenceClosed: Boolean(reference && !reference.open),
        hypotheticalMainLead: /^今[、]?この株を持っていなかったら/.test(
          [...document.querySelectorAll('p')].find(node => node.previousElementSibling?.textContent === '判断理由')?.textContent ?? ''
        ),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    return {
      width,
      symbol: expected.symbol,
      ...state,
      dividendScreenshot,
      actionScreenshot,
      passed:
        state.referenceClosed &&
        !state.hypotheticalMainLead &&
        state.scrollWidth <= width &&
        state.clientWidth <= width,
    };
  } finally {
    browser.socket.close();
    browser.chrome.kill("SIGTERM");
  }
}

const mobile = await verify({
  width: 390,
  height: 844,
  port: 9390,
  id: 132,
  expected: {
    symbol: "2733.T",
    yieldText: "4.09%",
    incomeText: "224,000",
    actionText: "500株の一部売却を検討",
    executionText: "¥137万",
  },
});
const desktop = await verify({
  width: 1280,
  height: 900,
  port: 9391,
  id: 73,
  expected: {
    symbol: "HMY",
    yieldText: "1.54%",
    incomeText: "16.85",
    actionText: "54株を継続保有",
    executionText: "売買なし",
  },
});

console.log(JSON.stringify({ version: "b24fd7d", mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
