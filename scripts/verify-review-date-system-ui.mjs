import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-token", "utf8")
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const scenarios = [
  {
    name: "dashboard",
    path: "/",
    width: 390,
    height: 844,
    port: 9530,
    target: "今週確認する銘柄",
    required: ["今週確認する銘柄", "112 銘柄", "あと7日で確認", "AI目安"],
  },
  {
    name: "holdings",
    path: "/holdings",
    width: 1280,
    height: 900,
    port: 9531,
    target: "あと7日で確認",
    required: ["あと7日で確認", "AI目安", "継続保有"],
  },
  {
    name: "detail",
    path: "/holdings/132",
    width: 390,
    height: 844,
    port: 9532,
    target: "次回確認",
    required: [
      "次回確認",
      "2026/9/5",
      "あと7日で確認",
      "AI目安",
      "この前後に確認",
      "確認前に見ること",
      "確認後に見ること",
      "会社の決算発表予定日を示すものではありません",
    ],
  },
];

async function verify(scenario) {
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${scenario.port}`,
      `--user-data-dir=/tmp/investdash-review-date-${scenario.name}-${scenario.width}`,
      `--window-size=${scenario.width},${scenario.height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let target;
  for (let index = 0; index < 80; index += 1) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${scenario.port}/json/list`)
      ).json();
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`missing Chrome target ${scenario.name}`);

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
    throw new Error(`timeout waiting for ${label} at ${scenario.name}`);
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
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
      mobile: scenario.width < 768,
    });
    await navigate(scenario.path);
    await evalValue(
      `localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`
    );
    await navigate(scenario.path);
    await waitUntil(
      scenario.target,
      `document.body?.innerText.includes(${JSON.stringify(scenario.target)})`
    );

    const state = await evalValue(`(() => {
      const body = document.body.innerText;
      const required = ${JSON.stringify(scenario.required)};
      return {
        missing: required.filter(text => !body.includes(text)),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);

    await evalValue(`(() => {
      const text = ${JSON.stringify(scenario.target)};
      const target = [...document.querySelectorAll('h1,h2,h3,p,span,div')]
        .find(node => node.textContent?.trim() === text && node.getClientRects().length > 0);
      target?.scrollIntoView({ block: 'center', inline: 'center' });
    })()`);
    await sleep(350);

    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-review-${scenario.name}-${scenario.width}.png`;
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
    return {
      name: scenario.name,
      width: scenario.width,
      ...state,
      screenshotPath,
      passed: state.missing.length === 0 && state.scrollWidth <= state.clientWidth,
    };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
  }
}

const results = [];
for (const scenario of scenarios) results.push(await verify(scenario));
console.log(JSON.stringify({ version: "f08edf3", results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
