import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-screenshot-cash-income-token", "utf8")
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify(width, height, port) {
  const userDataDir = `/tmp/investdash-screenshot-entry-${process.pid}-${width}`;
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
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  try {
    await send("Page.enable");
    await send("Network.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)}); } catch {}`,
    });
    await send("Page.navigate", { url: `${baseUrl}/import` });
    for (let index = 0; index < 120; index += 1) {
      if (
        await evaluate(
          `document.body?.innerText.includes('スクリーンショット取込') && Boolean(document.querySelector('input[type="file"]'))`
        )
      ) break;
      await sleep(250);
    }
    const state = await evaluate(`(() => {
      const text = document.body?.innerText ?? '';
      return {
        title: text.includes('スクリーンショット取込'),
        monthly: text.includes('毎月の証券口座スクショ'),
        holdings: text.includes('保有銘柄'),
        interest: text.includes('現金宝の実際利息'),
        dividends: text.includes('入金済み配当'),
        cumulativeHint: text.includes('前回スクショとの差額を自動計算'),
        forecastExcluded: text.includes('予想配当は取り込みません'),
        fileInput: Boolean(document.querySelector('input[type="file"]')),
        noDraftBeforeUpload: !document.querySelector('[data-testid="screenshot-cash-income-review"]'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const screenshot = `/tmp/investdash-screenshot-cash-income-entry-${width}.png`;
    await writeFile(screenshot, Buffer.from(shot.data, "base64"));
    const passed =
      Object.entries(state)
        .filter(([key]) => !["scrollWidth", "clientWidth"].includes(key))
        .every(([, value]) => value === true) && state.scrollWidth <= state.clientWidth;
    return { width, passed, state, screenshot };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
    await sleep(300);
    await rm(userDataDir, { recursive: true, force: true });
  }
}

const mobile = await verify(390, 844, 9720);
const desktop = await verify(1280, 900, 9721);
console.log(JSON.stringify({ baseUrl, applied: false, uploaded: false, mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;

