import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function trpcGet(path, input = null) {
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const response = await fetch(`${baseUrl}/api/trpc/${path}?input=${encoded}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.json?.message ?? `${path}: ${response.status}`);
  return body.result.data.json;
}

async function openBrowser(width, height, port) {
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/investdash-position-sizing-${width}`,
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitUntil = async (label, expression, attempts = 140) => {
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
    await waitUntil("document", `document.readyState === 'complete' && Boolean(document.body?.textContent?.trim())`);
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
  return { chrome, socket, evalValue, waitUntil, navigate, screenshot };
}

async function verify(width, height, port, watch, plan) {
  const browser = await openBrowser(width, height, port);
  try {
    await browser.navigate(`/watchlist?focus=${watch.id}`);
    const cardSelector = `#watch-${watch.id}`;
    await browser.waitUntil(
      "position sizing summary",
      `(() => {
        const card = document.querySelector(${JSON.stringify(cardSelector)});
        return card?.textContent?.includes('ポートフォリオ連動の買付目安') &&
          card.textContent.includes('今回') && card.textContent.includes('買う価格') &&
          card.textContent.includes('買った後') &&
          card.textContent.includes(${JSON.stringify(`${plan.sizing.shares.toLocaleString("ja-JP")} 株`)}) &&
          card.textContent.includes(${JSON.stringify(`現在 ${plan.sizing.currentWeightPct.toFixed(2)}%`)}) &&
          card.textContent.includes(${JSON.stringify(`${plan.sizing.afterWeightPct.toFixed(2)}%`)});
      })()`
    );
    const opened = await browser.evalValue(`(() => {
      const card = document.querySelector(${JSON.stringify(cardSelector)});
      const button = [...(card?.querySelectorAll('button') ?? [])].find(node => node.textContent?.trim() === '計算根拠を見る');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!opened) throw new Error(`missing calculation detail button at ${width}px`);
    await browser.waitUntil(
      "position sizing details",
      `(() => {
        const card = document.querySelector(${JSON.stringify(cardSelector)});
        return card?.textContent?.includes('現在の実保有') &&
          card.textContent.includes('目標総ポジション') &&
          card.textContent.includes('IBKR 主レバレッジ') &&
          card.textContent.includes(${JSON.stringify(`${plan.sizing.ibkrLeverage.toFixed(2)}x`)}) &&
          card.textContent.includes('現金性資産の 75% は追証・追加機会のため残します');
      })()`
    );
    await browser.evalValue(
      `document.querySelector(${JSON.stringify(cardSelector)})?.scrollIntoView({block:'center'})`
    );
    await sleep(500);
    const state = await browser.evalValue(`(() => {
      const card = document.querySelector(${JSON.stringify(cardSelector)});
      const rect = card?.getBoundingClientRect();
      return {
        summary: card?.querySelector('[data-testid^="position-sizing-summary-"]')?.textContent ?? '',
        detailsOpen: Boolean(card?.querySelector('[data-testid^="position-sizing-details-"]')),
        highlighted: card?.className.includes('ring-sky-400/30') ?? false,
        visible: Boolean(rect && rect.bottom > 0 && rect.top < innerHeight),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    const screenshot = await browser.screenshot(`position-sizing-${watch.tickerCode}`);
    return {
      width,
      symbol: watch.symbol,
      expected: {
        amountBase: plan.sizing.amountBase,
        shares: plan.sizing.shares,
        currentWeightPct: plan.sizing.currentWeightPct,
        afterWeightPct: plan.sizing.afterWeightPct,
      },
      ...state,
      screenshot,
      passed:
        state.detailsOpen &&
        state.highlighted &&
        state.visible &&
        state.scrollWidth <= width &&
        state.clientWidth <= width,
    };
  } finally {
    browser.socket.close();
    browser.chrome.kill("SIGTERM");
  }
}

const rows = await trpcGet("watchlist.list");
const kioxia = rows.find(row => row.symbol === "285A.T");
const pypl = rows.find(row => row.symbol === "PYPL");
if (!kioxia || !pypl) throw new Error("285A.T and PYPL must exist in production watchlist");
const [kioxiaPlan, pyplPlan] = await Promise.all([
  trpcGet("portfolio.priceBandPlan", { symbol: "285A.T" }),
  trpcGet("portfolio.priceBandPlan", { symbol: "PYPL" }),
]);
const mobile = await verify(390, 844, 9290, kioxia, kioxiaPlan);
const desktop = await verify(1280, 900, 9291, pypl, pyplPlan);
console.log(JSON.stringify({ version: "81042a3", mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
