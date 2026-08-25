import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/investdash-dev-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const debugPort = 9225;
const chrome = spawn("chromium", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  `--remote-debugging-port=${debugPort}`,
  "--user-data-dir=/tmp/investdash-operations-desktop-profile",
  "--window-size=1280,900",
  "about:blank",
], { stdio: "ignore" });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForJson(url) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await sleep(100);
  }
  throw new Error("Chromium did not start");
}

try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find(item => item.type === "page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${baseUrl}/` });
  await sleep(1200);
  await evaluate(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);
  await send("Page.navigate", { url: `${baseUrl}/operations` });
  await sleep(6000);
  const state = await evaluate(`(() => ({
    heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    path: location.pathname,
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    filters: document.querySelectorAll('button[role="combobox"]').length,
    rows: document.querySelectorAll('tbody tr').length,
    hasColumns: ['開始時刻（JST）','タスク','状態','実行元','成功 / 処理','残り','所要時間'].every(
      label => document.body.textContent.includes(label)
    ),
    hasCards: document.body.textContent.includes('投資カード補完'),
    hasChecks: document.body.textContent.includes('価格帯確認'),
  }))()`);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/investdash-operations-desktop.png", Buffer.from(shot.data, "base64"));
  console.log(JSON.stringify(state, null, 2));
  if (!(state.heading === "運用履歴" && state.path.endsWith("/operations") && state.width === 1280 && state.scrollWidth <= 1280 && state.filters === 4 && state.rows > 0 && state.hasColumns && state.hasCards && state.hasChecks)) process.exitCode = 1;
  socket.close();
} finally {
  chrome.kill("SIGTERM");
}
