import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-token", "utf8")
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify(width, height, port) {
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=/tmp/investdash-holdings-label-${width}`,
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

  try {
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
    await navigate("/holdings");
    const surface = width < 768 ? "mobile" : "desktop";
    await waitUntil(
      "visible holding signals",
      `(() => [...document.querySelectorAll('[data-testid="holding-signal-${surface}"]')]
        .some(node => node.getClientRects().length > 0 && node.textContent?.trim()))()`
    );

    const state = await evalValue(`(() => {
      const validLabels = ['買い増し検討', '継続保有', '注視', '一部売却検討', '撤退検討'];
      const visibleSignals = [...document.querySelectorAll('[data-testid="holding-signal-${surface}"]')]
        .filter(node => node.getClientRects().length > 0)
        .map(node => node.textContent?.replace(/\\s+/g, ' ').trim() ?? '');
      const forbidden = ['未保有でも見送る', '仮に未保有なら買う', '未保有時も判断保留'];
      return {
        surface: ${JSON.stringify(surface)},
        visibleSignals,
        allActualActions: visibleSignals.length > 0 && visibleSignals.every(text =>
          text === '未生成' || validLabels.some(label => text.includes(label))
        ),
        forbiddenVisible: visibleSignals.filter(text => forbidden.some(label => text.includes(label))),
        pageForbidden: forbidden.filter(label => document.body.innerText.includes(label)),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);

    await evalValue(`(() => {
      const target = [...document.querySelectorAll('[data-testid="holding-signal-${surface}"]')]
        .find(node => node.getClientRects().length > 0);
      target?.scrollIntoView({ block: 'center', inline: 'center' });
    })()`);
    await sleep(300);

    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-holdings-actual-signals-${width}.png`;
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    return {
      width,
      ...state,
      screenshotPath,
      passed:
        state.allActualActions &&
        state.forbiddenVisible.length === 0 &&
        state.pageForbidden.length === 0 &&
        state.scrollWidth <= state.clientWidth,
    };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
  }
}

const mobile = await verify(390, 844, 9490);
const desktop = await verify(1280, 900, 9491);
console.log(JSON.stringify({ version: "67bf948", mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
