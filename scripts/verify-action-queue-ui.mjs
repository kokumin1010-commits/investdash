import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const scenarios = [
  {
    name: "queue-mobile",
    path: "/action-queue",
    width: 390,
    height: 844,
    port: 9540,
    target: "今回の具体案",
    required: ["アクション待ち", "13", "現在", "今回の具体案", "実行後", "計画に追加", "あとで確認", "今回は見送る"],
  },
  {
    name: "queue-desktop",
    path: "/action-queue",
    width: 1280,
    height: 900,
    port: 9541,
    target: "今回の具体案",
    required: ["PENDING_ACTION", "2,000 株", "一部売却 500 株", "概算 ¥136.9万", "1,500 株", "構成比 0.47%"],
    alternative: { from: "PENDING_ACTION", to: "確認待ち" },
  },
  {
    name: "dashboard-mobile",
    path: "/",
    width: 390,
    height: 844,
    port: 9542,
    target: "アクション待ち",
    required: ["アクション待ち", "13 件", "現在株数・具体的な売買量・実行後構成比を確認"],
  },
];

async function verify(scenario) {
  const chrome = spawn("chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${scenario.port}`,
    `--user-data-dir=/tmp/investdash-action-queue-${scenario.name}`,
    `--window-size=${scenario.width},${scenario.height}`,
    "about:blank",
  ], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${scenario.port}/json/list`)).json();
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`missing target ${scenario.name}`);
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
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitUntil = async (label, expression) => {
    for (let i = 0; i < 180; i += 1) {
      try { if (await evaluate(expression)) return; } catch {}
      await sleep(500);
    }
    throw new Error(`timeout ${label} ${scenario.name}`);
  };
  const navigate = async path => {
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil("document", `document.readyState === 'complete' && Boolean(document.body?.innerText?.trim())`);
  };
  try {
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: scenario.width, height: scenario.height, deviceScaleFactor: 1, mobile: scenario.width < 768 });
    await navigate(scenario.path);
    await evaluate(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);
    await navigate(scenario.path);
    await waitUntil(scenario.target, `document.body?.innerText.includes(${JSON.stringify(scenario.target)})`);
    const state = await evaluate(`(() => {
      const body = document.body.innerText;
      const required = ${JSON.stringify(scenario.required)};
      const alternative = ${JSON.stringify(scenario.alternative ?? null)};
      return {
        missing: required.filter(text => !body.includes(text) && !(alternative && text === alternative.from && body.includes(alternative.to))),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    await evaluate(`(() => {
      const text = ${JSON.stringify(scenario.target)};
      const node = [...document.querySelectorAll('h1,h2,h3,p,span,div')].find(el => el.textContent?.trim() === text && el.getClientRects().length);
      node?.scrollIntoView({ block: 'center', inline: 'center' });
    })()`);
    await sleep(350);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-${scenario.name}-${scenario.width}.png`;
    await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
    return { ...scenario, ...state, screenshotPath, passed: state.missing.length === 0 && state.scrollWidth <= state.clientWidth };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
  }
}

const results = [];
for (const scenario of scenarios) results.push(await verify(scenario));
console.log(JSON.stringify({ version: "d498829", results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
