import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const tokenFile = process.env.DEV_TOKEN_FILE ?? "/tmp/investdash-dev-token";
const token = (await readFile(tokenFile, "utf8")).trim();
if (!token) throw new Error("passcode token is empty");
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const operationsUrl = `${baseUrl}/operations`;
const expectedPath = new URL(operationsUrl).pathname;
const debugPort = 9224;
const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    "--user-data-dir=/tmp/investdash-operations-mobile-profile",
    "--window-size=390,844",
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForJson(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chromium is still starting.
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find(item => item.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("missing page target");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: `${baseUrl}/` });
  await sleep(1200);
  await evaluate(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);
  await send("Page.navigate", { url: operationsUrl });
  await sleep(6000);

  const pageState = await evaluate(`(() => ({
    pathname: location.pathname,
    heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    viewportWidth: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    filterCount: document.querySelectorAll('button[role="combobox"]').length,
    hasCardRuns: document.body.textContent.includes('投資カード補完'),
    hasBandRuns: document.body.textContent.includes('価格帯確認'),
    hasSuccess: document.body.textContent.includes('成功'),
    hasCounts: document.body.textContent.includes('処理') && document.body.textContent.includes('残り'),
  }))()`);

  const pageShot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "/tmp/investdash-operations-mobile-page.png",
    Buffer.from(pageShot.data, "base64")
  );

  const opened = await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button[data-sidebar="trigger"]')].find(
      button => button.getBoundingClientRect().width > 0
    );
    trigger?.click();
    return Boolean(trigger);
  })()`);
  await sleep(700);
  const navState = await evaluate(`(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const button = [...document.querySelectorAll('button')].find(
      item => visible(item) && item.textContent.trim() === '運用履歴'
    );
    return {
      buttonVisible: Boolean(button),
      active: button?.getAttribute('data-active') ?? '',
    };
  })()`);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/investdash-operations-mobile.png", Buffer.from(shot.data, "base64"));
  const result = { pageState, opened, navState };
  console.log(JSON.stringify(result, null, 2));

  const passed =
    pageState.pathname === expectedPath &&
    pageState.heading === "運用履歴" &&
    pageState.viewportWidth === 390 &&
    pageState.scrollWidth <= 390 &&
    pageState.filterCount === 4 &&
    pageState.hasCardRuns &&
    pageState.hasBandRuns &&
    pageState.hasSuccess &&
    pageState.hasCounts &&
    opened &&
    navState.buttonVisible &&
    navState.active === "true";
  if (!passed) process.exitCode = 1;
  socket.close();
} finally {
  chrome.kill("SIGTERM");
}
