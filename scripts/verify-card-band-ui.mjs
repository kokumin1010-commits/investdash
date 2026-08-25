import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/investdash-dev-token", "utf8")).trim();
if (!token) throw new Error("passcode token is empty");
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verifyViewport(width, height, port) {
  const chrome = spawn("chromium", [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/investdash-card-band-${width}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ], { stdio: "ignore" });
  try {
    let targets;
    for (let i = 0; i < 60; i += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (response.ok) {
          targets = await response.json();
          break;
        }
      } catch {}
      await sleep(100);
    }
    const target = targets?.find(item => item.type === "page");
    if (!target?.webSocketDebuggerUrl) throw new Error(`missing page target for ${width}`);
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
    const screenshot = async name => {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(`/tmp/investdash-${name}-${width}.png`, Buffer.from(shot.data, "base64"));
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await send("Page.navigate", { url: `${baseUrl}/` });
    await sleep(1200);
    await evaluate(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);
    await send("Page.navigate", { url: `${baseUrl}/holdings` });
    for (let i = 0; i < 30; i += 1) {
      const ready = await evaluate(
        `[...document.querySelectorAll('button')].some(item => item.textContent.includes('投資カード'))`
      );
      if (ready) break;
      await sleep(500);
    }
    const holdings = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        item => item.textContent.replace(/\\s+/g, ' ').trim().startsWith('投資カード')
      );
      return {
        path: location.pathname,
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        buttonText: button?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        buttonDisabled: Boolean(button?.disabled),
      };
    })()`);

    await send("Page.navigate", { url: `${baseUrl}/holdings/98` });
    await sleep(7000);
    const detail = await evaluate(`(() => ({
      path: location.pathname,
      scrollWidth: document.documentElement.scrollWidth,
      hasNvidia: document.body.textContent.includes('NVDA'),
      hasCard: document.body.textContent.includes('企業投資カード'),
      filledLabel: [...document.querySelectorAll('*')].find(
        item => /^\\d+ \\/ \\d+ 項目 記入済み$/.test(item.textContent?.trim() ?? '')
      )?.textContent?.trim() ?? '',
      fairValue: [...document.querySelectorAll('#fair-value')].find(
        item => item.getBoundingClientRect().width > 0
      )?.value ?? '',
      horizon: document.querySelector('#horizon')?.value ?? '',
      textareaFilled: [...document.querySelectorAll('textarea')].filter(item => item.value.trim()).length,
      hasBandPlan: document.body.textContent.includes('買い増しプラン（価格帯）'),
      hasUnknown: document.body.textContent.includes('情報不足'),
      hasZeroEvidence: document.body.textContent.includes('根拠ニュース 0 件'),
      hasSafetyWarning: document.body.textContent.includes('安全を意味しません。'),
      hasJstTime: /\\d{2}\\/\\d{2} \\d{2}:\\d{2} JST/.test(document.body.textContent),
      hasRecheck: document.body.textContent.includes('確認をやり直す'),
    }))()`);

    await evaluate(`(() => {
      const title = [...document.querySelectorAll('*')].find(item => item.textContent?.trim() === '企業投資カード');
      title?.scrollIntoView({ block: 'start' });
      scrollBy(0, -70);
    })()`);
    await sleep(400);
    await screenshot("investment-card");
    await evaluate(`(() => {
      const title = [...document.querySelectorAll('*')].find(item => item.textContent?.trim() === '買い増しプラン（価格帯）');
      title?.scrollIntoView({ block: 'start' });
      scrollBy(0, -70);
    })()`);
    await sleep(400);
    await screenshot("band-check");
    socket.close();

    const result = { width, holdings, detail };
    const passed =
      holdings.path.endsWith("/holdings") &&
      holdings.width === width &&
      holdings.scrollWidth <= width &&
      /112\s*\/\s*112/.test(holdings.buttonText) &&
      holdings.buttonDisabled &&
      detail.path.endsWith("/holdings/98") &&
      detail.scrollWidth <= width &&
      detail.hasNvidia &&
      detail.hasCard &&
      /[1-9] \/ 6 項目 記入済み/.test(detail.filledLabel) &&
      detail.horizon.length > 0 &&
      detail.textareaFilled > 0 &&
      detail.hasBandPlan &&
      detail.hasUnknown &&
      detail.hasZeroEvidence &&
      detail.hasSafetyWarning &&
      detail.hasJstTime &&
      detail.hasRecheck;
    return { result, passed };
  } finally {
    chrome.kill("SIGTERM");
  }
}

const mobile = await verifyViewport(390, 844, 9226);
const desktop = await verifyViewport(1280, 900, 9227);
console.log(JSON.stringify({ mobile: mobile.result, desktop: desktop.result }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
