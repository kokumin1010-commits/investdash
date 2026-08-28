import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function trpcGet(path) {
  const response = await fetch(`${baseUrl}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: null }))}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${path}: ${body.error?.json?.message ?? response.status}`);
  return body.result.data.json;
}

async function trpcPost(path, input) {
  const response = await fetch(`${baseUrl}/api/trpc/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${path}: ${body.error?.json?.message ?? response.status}`);
  return body.result.data.json;
}

async function verify(width, height, port, preferredSymbols) {
  const before = await trpcGet("watchlist.list");
  const existing = new Set(before.map(row => row.symbol));
  const symbol = preferredSymbols.find(value => !existing.has(value));
  if (!symbol) throw new Error(`no temporary symbol available for ${width}px`);

  let createdId = null;
  const chrome = spawn("chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/investdash-watch-closure-${width}`, `--window-size=${width},${height}`, "about:blank",
  ], { stdio: "ignore" });

  try {
    let target;
    for (let i = 0; i < 80; i += 1) {
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
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const waitUntil = async (label, expression, attempts = 180) => {
      for (let i = 0; i < attempts; i += 1) {
        try {
          if (await evalValue(expression)) return;
        } catch {}
        await sleep(500);
      }
      throw new Error(`timeout waiting for ${label} at ${width}px`);
    };
    const clickExact = text => evalValue(`(() => {
      const el = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === ${JSON.stringify(text)});
      if (!el || el.disabled) return false;
      el.click(); return true;
    })()`);
    const setInput = (selector, value) => evalValue(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    const shot = async name => {
      const result = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(`/tmp/investdash-${name}-${width}.png`, Buffer.from(result.data, "base64"));
    };

    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: `${baseUrl}/watchlist` });
    await sleep(1000);
    await evalValue(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);
    await send("Page.navigate", { url: `${baseUrl}/watchlist` });
    await waitUntil("watchlist data", `document.body?.textContent?.includes('PayPal Holdings, Inc.')`);
    await waitUntil("add button", `[...document.querySelectorAll('button')].some(node => node.textContent?.trim() === '銘柄を追加' && !node.disabled)`);

    if (!(await clickExact("銘柄を追加"))) throw new Error(`missing add button at ${width}px`);
    await waitUntil("add dialog", `document.querySelector('[role="dialog"]')?.textContent?.includes('ウォッチリストに追加')`);
    if (!(await setInput("#w-code", symbol))) throw new Error(`missing symbol input at ${width}px`);
    const lookupClicked = await evalValue(`(() => {
      const input = document.querySelector('#w-code');
      const button = input?.parentElement?.querySelector('button');
      if (!button || button.disabled) return false;
      button.click(); return true;
    })()`);
    if (!lookupClicked) throw new Error(`lookup button unavailable at ${width}px`);
    await waitUntil("verified symbol", `(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const button = [...(dialog?.querySelectorAll('button') ?? [])].find(node => node.textContent?.trim() === 'この銘柄を追加');
      return Boolean(button && !button.disabled && dialog?.textContent?.includes('この銘柄だけ先に保存します'));
    })()`);
    if (!(await clickExact("この銘柄を追加"))) throw new Error(`add submit unavailable at ${width}px`);

    await waitUntil("AI proposal dialog", `document.querySelector('[role="dialog"]')?.textContent?.includes('AI 買付提案を確認')`, 300);
    const listed = await trpcGet("watchlist.list");
    createdId = listed.find(row => row.symbol === symbol)?.id ?? null;
    if (!createdId) throw new Error(`new watch item not found for ${symbol}`);

    const originalTarget = await evalValue(`Number(document.querySelector('#proposal-target')?.value)`);
    const editedTarget = Number((originalTarget * 0.99).toFixed(2));
    if (!(await setInput("#proposal-target", String(editedTarget)))) throw new Error(`proposal target missing at ${width}px`);
    await waitUntil("edited save button", `[...document.querySelectorAll('button')].some(node => node.textContent?.includes('修正して保存') && !node.disabled)`);
    if (!(await clickExact("修正して保存"))) throw new Error(`edited save unavailable at ${width}px`);
    await waitUntil("reviewed card", `(() => {
      const cards = [...document.querySelectorAll('[data-slot="card"]')];
      const card = cards.find(node => node.textContent?.includes(${JSON.stringify(symbol)}));
      return Boolean(card?.textContent?.includes('確認して修正済み'));
    })()`, 120);
    await shot("watch-confirmation-closure");

    const persistedList = await trpcGet("watchlist.list");
    const persisted = persistedList.find(row => row.id === createdId);
    const browserResult = await evalValue(`(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      successToast: document.body?.textContent?.includes('修正した内容で保存しました') ?? false,
      reviewedCard: [...document.querySelectorAll('[data-slot="card"]')].some(node => node.textContent?.includes(${JSON.stringify(symbol)}) && node.textContent?.includes('確認して修正済み')),
    }))()`);

    const removed = await trpcPost("watchlist.remove", { id: createdId });
    createdId = null;
    const after = await trpcGet("watchlist.list");
    socket.close();
    return {
      width,
      symbol,
      originalTarget,
      editedTarget,
      browserResult,
      persisted: persisted ? {
        targetPrice: persisted.targetPrice,
        plannedAmount: persisted.plannedAmount,
        reviewStatus: persisted.latestProposal?.reviewStatus,
      } : null,
      removed,
      beforeCount: before.length,
      afterCount: after.length,
      fullyCleaned: after.length === before.length && !after.some(row => row.symbol === symbol) && removed.deletedProposals >= 1,
      passed: browserResult.scrollWidth <= width && browserResult.reviewedCard &&
        persisted?.latestProposal?.reviewStatus === "EDITED" && Number(persisted?.targetPrice) === editedTarget &&
        after.length === before.length && !after.some(row => row.symbol === symbol) && removed.deletedProposals >= 1,
    };
  } finally {
    if (createdId) {
      try { await trpcPost("watchlist.remove", { id: createdId }); } catch {}
    }
    chrome.kill("SIGTERM");
  }
}

const mobile = await verify(390, 844, 9270, ["MCD", "LOW", "CAT"]);
const desktop = await verify(1280, 900, 9271, ["LOW", "CAT", "DE"]);
console.log(JSON.stringify({ mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
