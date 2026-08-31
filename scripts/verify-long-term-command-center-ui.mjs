import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-command-center-token", "utf8")
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const scenarios = [
  {
    name: "buy-plans-mobile",
    path: "/buy-plans",
    width: 390,
    height: 844,
    port: 9560,
    target: "今月の優先候補",
    required: [
      "今月の優先候補",
      "順位は売買指示ではなく、月1回の検討順です",
      "4816.T",
      "500 株",
      "154 万円",
      "買付後構成比",
      "全 115 銘柄を表示",
    ],
  },
  {
    name: "buy-plans-desktop",
    path: "/buy-plans",
    width: 1280,
    height: 900,
    port: 9561,
    target: "今月の優先候補",
    required: [
      "4816.T",
      "4661.T",
      "2318.HK",
      "C38U.SI",
      "5801.T",
      "実行可能 52 銘柄 / 表示 5 銘柄",
    ],
  },
  {
    name: "skip-review-mobile",
    path: "/action-queue",
    width: 390,
    height: 844,
    port: 9562,
    clickText: "見送り検証",
    target: "まだ見送り検証はありません",
    required: [
      "見送り検証",
      "まだ見送り検証はありません",
      "30・90・180日後と次の決算後に検証します",
    ],
  },
  {
    name: "skip-review-desktop",
    path: "/action-queue",
    width: 1280,
    height: 900,
    port: 9563,
    clickText: "見送り検証",
    target: "まだ見送り検証はありません",
    required: [
      "見送り検証",
      "まだ見送り検証はありません",
      "今後「今回は見送る」を選ぶと、当時の理由を固定し",
    ],
  },
];

async function verify(scenario) {
  const chrome = spawn("chromium", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${scenario.port}`,
    `--user-data-dir=/tmp/investdash-command-center-${scenario.name}`,
    `--window-size=${scenario.width},${scenario.height}`,
    "about:blank",
  ], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 80; i += 1) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${scenario.port}/json/list`)
      ).json();
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
  const waitUntil = async (label, expression) => {
    for (let i = 0; i < 180; i += 1) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`timeout ${label} ${scenario.name}`);
  };
  const navigate = async path => {
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil(
      "document",
      "document.readyState === 'complete' && Boolean(document.body?.innerText?.trim())"
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
    await evaluate(
      `localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`
    );
    await navigate(scenario.path);
    if (scenario.clickText) {
      await waitUntil(
        "click target",
        `[...document.querySelectorAll('button')].some(node => node.textContent?.trim().includes(${JSON.stringify(scenario.clickText)}))`
      );
      await evaluate(`(() => {
        const text = ${JSON.stringify(scenario.clickText)};
        const button = [...document.querySelectorAll('button')].find(node => node.textContent?.trim().includes(text));
        button?.click();
      })()`);
    }
    await waitUntil(
      scenario.target,
      `document.body?.innerText.includes(${JSON.stringify(scenario.target)})`
    );
    const state = await evaluate(`(() => {
      const body = document.body.innerText;
      const required = ${JSON.stringify(scenario.required)};
      return {
        missing: required.filter(text => !body.includes(text)),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyExcerpt: body.slice(0, 1200),
      };
    })()`);
    await evaluate(`(() => {
      const text = ${JSON.stringify(scenario.target)};
      const node = [...document.querySelectorAll('h1,h2,h3,p,span,div')]
        .find(element => element.textContent?.trim() === text && element.getClientRects().length);
      node?.scrollIntoView({ block: 'center', inline: 'center' });
    })()`);
    await sleep(350);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-${scenario.name}-${scenario.width}.png`;
    await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
    return {
      ...scenario,
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
console.log(JSON.stringify({ version: "22386e3", results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
