import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-sort-token", "utf8")
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const scenarios = [
  { name: "mobile", width: 390, height: 844, port: 9592 },
  { name: "desktop", width: 1280, height: 900, port: 9593 },
];

async function verify(scenario) {
  const profile = await mkdtemp(join(tmpdir(), `investdash-goal-${scenario.name}-`));
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-cache",
      `--remote-debugging-port=${scenario.port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${scenario.width},${scenario.height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  let target;
  for (let i = 0; i < 100; i += 1) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${scenario.port}/json/list`)
      ).json();
      target = targets.find(item => item.type === "page");
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target?.webSocketDebuggerUrl)
    throw new Error(`missing target ${scenario.name}`);
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
    for (let i = 0; i < 240; i += 1) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`timeout ${label} ${scenario.name}`);
  };

  try {
    await send("Page.enable");
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Emulation.setDeviceMetricsOverride", {
      width: scenario.width,
      height: scenario.height,
      deviceScaleFactor: 1,
      mobile: scenario.width < 768,
    });
    const path = `/?verify-goal=${Date.now()}`;
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil("document", "document.readyState === 'complete'");
    await evaluate(
      `localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`
    );
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil(
      "long-term goal",
      "document.body?.innerText.includes('長期目標') && document.body?.innerText.includes('1,000 億円')"
    );
    const state = await evaluate(`(() => {
      const body = document.body.innerText;
      const required = [
        '長期目標',
        '1,000 億円',
        '2030-12-31 まで',
        '高い挑戦目標',
        '達成率',
        '現在の年間配当（税引前）',
        '年間利息（見込み）',
        '借入の年間利息',
        '年間純キャッシュ収入',
        '目標は進捗確認だけに使い、売買順位や提案を変えません。',
      ];
      return {
        missing: required.filter(text => !body.includes(text)),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find(node => node.textContent?.trim().includes('目標を編集'));
      button?.click();
    })()`);
    await waitUntil("goal dialog", "Boolean(document.querySelector('#goal-net-assets'))");
    const editState = await evaluate(`(() => ({
      targetOku: document.querySelector('#goal-net-assets')?.value,
      targetDate: document.querySelector('#goal-date')?.value,
      dividendTarget: document.querySelector('#goal-dividend')?.value,
      interestTarget: document.querySelector('#goal-interest')?.value,
      netCashTarget: document.querySelector('#goal-net-cash')?.value,
    }))()`);
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find(node => node.textContent?.trim() === 'キャンセル');
      button?.click();
      const title = [...document.querySelectorAll('h2')]
        .find(node => node.textContent?.trim() === '長期目標');
      title?.scrollIntoView({ block: 'start', inline: 'nearest' });
    })()`);
    await sleep(400);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-long-term-goal-${scenario.name}.png`;
    await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
    const passed =
      state.missing.length === 0 &&
      state.scrollWidth <= state.clientWidth &&
      editState.targetOku === "1000" &&
      editState.targetDate === "2030-12-31" &&
      editState.dividendTarget === "" &&
      editState.interestTarget === "" &&
      editState.netCashTarget === "";
    return { ...scenario, ...state, ...editState, screenshotPath, passed };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

const results = [];
for (const scenario of scenarios) results.push(await verify(scenario));
console.log(JSON.stringify({ version: "c65a2a9", results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
