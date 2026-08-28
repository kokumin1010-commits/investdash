import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/investdash-dev-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const holdingId = process.env.HOLDING_ID ?? "49";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify(width, height, port) {
  const chrome = spawn("chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/investdash-dividend-signal-${width}`, `--window-size=${width},${height}`, "about:blank",
  ], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 60; i += 1) {
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
    const waitForText = async text => {
      for (let i = 0; i < 120; i += 1) {
        try {
          if (await evalValue(`Boolean(document.body?.textContent?.includes(${JSON.stringify(text)}))`)) return;
        } catch {}
        await sleep(500);
      }
      throw new Error(`timeout waiting for ${text} at ${width}px`);
    };
    const shot = async name => {
      const result = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(`/tmp/investdash-${name}-${width}.png`, Buffer.from(result.data, "base64"));
    };

    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    await send("Page.navigate", { url: `${baseUrl}/` });
    await sleep(1200);
    await evalValue(`localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`);
    await evalValue(`localStorage.setItem('investdesk.displayCurrency', 'JPY')`);
    await send("Page.navigate", { url: `${baseUrl}/` });
    await waitForText("年間配当（税引前）");
    await waitForText("全件 最新");
    const dashboard = await evalValue(`(() => {
      const text = document.body?.textContent ?? '';
      return {
        path: location.pathname,
        scrollWidth: document.documentElement.scrollWidth,
        dividendText: [...document.querySelectorAll('[data-slot="card"]')].find(card => card.textContent?.includes('年間配当（税引前）'))?.textContent?.trim() ?? '',
        signalText: [...document.querySelectorAll('[data-slot="card"]')].find(card => card.textContent?.includes('AI シグナル内訳'))?.textContent?.trim() ?? '',
        hasAnnual: text.includes('¥22,193,612'),
        hasMonthly: text.includes('月平均') && text.includes('¥1,849,468'),
        hasCoverage: text.includes('配当あり 99') && text.includes('無配 13') && text.includes('未取得 0'),
        hasActions: ['ADD','HOLD','WATCH','REDUCE','EXIT'].every(label => text.includes(label)),
        hasActionCounts: ['ADD3','HOLD86','WATCH15','REDUCE7','EXIT1'].every(value => text.includes(value)),
        hasConfidence: text.includes('平均確信度 66'),
        hasFresh: text.includes('全件 最新'),
        hasQuality: text.includes('材料あり 112'),
      };
    })()`);
    await shot("dividend-signal-dashboard");

    await send("Page.navigate", { url: `${baseUrl}/holdings/${holdingId}` });
    await waitForText("AI 意思決定シグナル");
    await waitForText("次に見直す条件");
    const detail = await evalValue(`(() => {
      const text = document.body?.textContent ?? '';
      return {
        path: location.pathname,
        scrollWidth: document.documentElement.scrollWidth,
        hasDuration: text.includes('保有期間') && text.includes('少なくとも') && text.includes('月次記録'),
        hasQuality: text.includes('材料あり'),
        hasExpiry: text.includes('通常の再確認期限'),
        hasTriggers: text.includes('次に見直す条件'),
        hasRisks: text.includes('確認中のリスク'),
      };
    })()`);
    await shot("rich-signal-detail");
    socket.close();
    const passed = dashboard.path.endsWith('/investdash/') && dashboard.scrollWidth <= width &&
      Object.entries(dashboard).filter(([key]) => key.startsWith('has')).every(([, value]) => value === true) &&
      detail.path.endsWith('/holdings/' + holdingId) && detail.scrollWidth <= width &&
      Object.entries(detail).filter(([key]) => key.startsWith('has')).every(([, value]) => value === true);
    return { width, dashboard, detail, passed };
  } finally {
    chrome.kill("SIGTERM");
  }
}

const mobile = await verify(390, 844, 9244);
const desktop = await verify(1280, 900, 9245);
console.log(JSON.stringify({ mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
