import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/investdash-dev-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify(width, height, port) {
  const chrome = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/investdash-news-duration-${width}`,
    `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find(item => item.type === "page");
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
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const next = ++id;
      pending.set(next, { resolve, reject });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
    const evalValue = async expression => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const shot = async name => {
      const result = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(`/tmp/investdash-${name}-${width}.png`, Buffer.from(result.data, "base64"));
    };
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: `${baseUrl}/` });
    await sleep(1200);
    await evalValue(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);

    await send("Page.navigate", { url: `${baseUrl}/news` });
    for (let i = 0; i < 40; i += 1) {
      if (await evalValue(`Boolean(document.body?.textContent?.includes('ニュースカバレッジ'))`)) break;
      await sleep(500);
    }
    const news = await evalValue(`(() => ({
      path: location.pathname,
      scrollWidth: document.documentElement.scrollWidth,
      hasCoverage: /112\/112\s*銘柄にニュースあり/.test(document.body.textContent),
      hasMissingZero: /0件\s*0/.test(document.body.textContent),
      hasFresh: document.body.textContent.includes('最新'),
      hasStale: /14日超\s*\d+/.test(document.body.textContent),
    }))()`);
    await shot("news-coverage");

    await send("Page.navigate", { url: `${baseUrl}/holdings` });
    for (let i = 0; i < 40; i += 1) {
      if (await evalValue(`Boolean(document.body?.textContent?.includes('保有期間'))`)) break;
      await sleep(500);
    }
    const holdings = await evalValue(`(() => ({
      path: location.pathname,
      scrollWidth: document.documentElement.scrollWidth,
      durationLabels: [...document.querySelectorAll('*')].filter(item => item.textContent?.trim().startsWith('保有 少なくとも')).length,
      hasAtLeast: document.body.textContent.includes('少なくとも'),
      hasBasis: document.body.textContent.includes('月次記録'),
    }))()`);
    await shot("holding-duration");
    socket.close();
    const passed = news.path.endsWith("/news") && news.scrollWidth <= width && news.hasCoverage && news.hasMissingZero &&
      news.hasFresh && news.hasStale && holdings.path.endsWith("/holdings") && holdings.scrollWidth <= width &&
      holdings.durationLabels > 0 && holdings.hasAtLeast && holdings.hasBasis;
    return { width, news, holdings, passed };
  } finally {
    chrome.kill("SIGTERM");
  }
}

const mobile = await verify(390, 844, 9236);
const desktop = await verify(1280, 900, 9237);
console.log(JSON.stringify({ mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
