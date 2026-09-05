import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = (
  await readFile(
    process.env.DEV_TOKEN_FILE ?? "/tmp/prod-command-center-token",
    "utf8"
  )
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const scenarios = [
  { name: "mobile", width: 390, height: 844, port: 9580 },
  { name: "desktop", width: 1280, height: 900, port: 9581 },
];

async function verify(scenario) {
  const profile = await mkdtemp(join(tmpdir(), `investdash-action-sell-${scenario.name}-`));
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
    for (let i = 0; i < 180; i += 1) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await sleep(500);
    }
    throw new Error(`timeout ${label} ${scenario.name}`);
  };
  const clickButton = label =>
    evaluate(`(() => {
      const label = ${JSON.stringify(label)};
      const button = [...document.querySelectorAll('button')].find(
        node => node.textContent?.trim() === label && !node.disabled
      );
      if (!button) return false;
      button.click();
      return true;
    })()`);

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
    const path = `/action-queue?verify=${Date.now()}`;
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil("document", "document.readyState === 'complete'");
    await evaluate(
      `localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`
    );
    await send("Page.navigate", { url: `${baseUrl}${path}` });
    await waitUntil(
      "new action queue",
      "document.body?.innerText.includes('売却代金の使い道') && document.body?.innerText.includes('売却要否を再確認')"
    );

    const initial = await evaluate(`(() => {
      const body = document.body.innerText;
      const buttons = [...document.querySelectorAll('button')].map(button => button.textContent?.trim());
      return {
        hasBuyFilter: buttons.some(text => text?.startsWith('買入 ')),
        hasSellFilter: buttons.some(text => text?.startsWith('売出 ')),
        hasReviewFilter: buttons.some(text => text?.startsWith('要確認 ')),
        hasSaleImpact: body.includes('売却した場合の損益'),
        hasUseOfFunds: body.includes('売却代金の使い道'),
        hasTaxNotice: body.includes('税金・手数料・実際の約定価格'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);

    const sellLabel = await evaluate(`
      [...document.querySelectorAll('button')]
        .map(button => button.textContent?.trim())
        .find(text => text?.startsWith('売出 '))
    `);
    if (!sellLabel || !(await clickButton(sellLabel)))
      throw new Error(`sell filter missing ${scenario.name}`);
    await waitUntil(
      "sell cards",
      "document.body?.innerText.includes('売却した場合の損益')"
    );

    const reviewLabel = await evaluate(`
      [...document.querySelectorAll('button')]
        .map(button => button.textContent?.trim())
        .find(text => text?.startsWith('要確認 '))
    `);
    if (!reviewLabel || !(await clickButton(reviewLabel)))
      throw new Error(`review filter missing ${scenario.name}`);
    await waitUntil(
      "small position",
      "document.body?.innerText.includes('6920.T') && document.body?.innerText.includes('今回は数量提案なし')"
    );
    const smallPosition = await evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-slot="card"]')].find(
        node => node.textContent?.includes('6920.T')
      );
      if (!card) return false;
      const summary = card.querySelector('summary');
      if (summary && !summary.parentElement?.hasAttribute('open')) summary.click();
      return card.textContent?.includes('売却要否を再確認') &&
        card.textContent?.includes('今回は数量提案なし') &&
        card.textContent?.includes('REDUCE を全売却へ自動変換しません');
    })()`);
    const opened = await evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-slot="card"]')].find(
        node => node.textContent?.includes('6920.T')
      );
      const button = card
        ? [...card.querySelectorAll('button')].find(node => node.textContent?.trim() === '今回は見送る')
        : null;
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!opened) throw new Error(`skip dialog trigger missing ${scenario.name}`);
    await waitUntil(
      "optional skip",
      "document.body?.innerText.includes('今回の見送り理由（任意）') && document.body?.innerText.includes('理由なしで見送る')"
    );
    const optionalSkip = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        node => node.textContent?.trim() === '理由なしで見送る'
      );
      return Boolean(button && !button.disabled);
    })()`);
    await clickButton("戻る");
    await evaluate(`(() => {
      const node = [...document.querySelectorAll('[data-slot="card"]')].find(
        element => element.textContent?.includes('6920.T')
      );
      node?.scrollIntoView({ block: 'center', inline: 'center' });
    })()`);
    await sleep(350);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const screenshotPath = `/tmp/investdash-action-sell-${scenario.name}.png`;
    await writeFile(screenshotPath, Buffer.from(shot.data, "base64"));
    const passed =
      Object.values(initial).every(value =>
        typeof value === "boolean" ? value : true
      ) &&
      initial.scrollWidth <= initial.clientWidth &&
      smallPosition &&
      optionalSkip;
    return {
      ...scenario,
      ...initial,
      smallPosition,
      optionalSkip,
      screenshotPath,
      passed,
    };
  } finally {
    socket.close();
    chrome.kill("SIGTERM");
    await sleep(300);
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

const results = [];
for (const scenario of scenarios) results.push(await verify(scenario));
console.log(JSON.stringify({ version: "ed10960", results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
