import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/cash-income-token", "utf8")
).trim();
const baseUrl = (
  process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash"
).replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function openBrowser(width, height, port) {
  const userDataDir = `/tmp/investdash-cash-income-${process.pid}-${width}`;
  await rm(userDataDir, { recursive: true, force: true });
  const chrome = spawn(
    "chromium",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let target;
  for (let index = 0; index < 100; index += 1) {
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
  const waitUntil = async (label, expression, attempts = 240) => {
    for (let index = 0; index < attempts; index += 1) {
      try {
        if (await evalValue(expression)) return;
      } catch {}
      await sleep(500);
    }
    const diagnostic = await evalValue(`({ url: location.href, text: document.body?.innerText?.slice(0, 4000) ?? '' })`);
    throw new Error(`${label} timeout at ${width}px: ${JSON.stringify(diagnostic)}`);
  };
  const screenshot = async name => {
    const result = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    const path = `/tmp/investdash-${name}-${width}.png`;
    await writeFile(path, Buffer.from(result.data, "base64"));
    return path;
  };

  await send("Page.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)}); } catch {}`,
  });

  return { chrome, socket, userDataDir, send, evalValue, waitUntil, screenshot };
}

async function verify(width, height, port) {
  const browser = await openBrowser(width, height, port);
  try {
    await browser.send("Page.navigate", { url: `${baseUrl}/` });
    await browser.waitUntil(
      "cash income card",
      `Boolean(document.querySelector('[data-testid="cash-income-actual-forecast"]'))`
    );
    await browser.waitUntil(
      "long-term income state",
      `(document.body.innerText.includes('未来の年間配当予想（税引前）') && document.body.innerText.includes('未来の年間純キャッシュ収入予想')) || document.body.innerText.includes('目標純資産と目標日がまだ設定されていません')`
    );
    await browser.evalValue(`document.querySelector('[data-testid="cash-income-actual-forecast"]')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);
    const card = await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="cash-income-actual-forecast"]');
      const text = node?.innerText ?? '';
      const pageText = document.body?.innerText ?? '';
      return {
        present: Boolean(node),
        actualHeading: text.includes('実際に増えた金額'),
        recordedYtd: text.includes('本年の実績収入（記録分）'),
        dailyInterest: text.includes('最新記録の日次利息'),
        dividendActual: text.includes('本年の入金済み配当'),
        unlinked: text.includes('未連携'),
        forecastHeading: text.includes('未来1年間の予想'),
        annualDividendForecast: text.includes('年間配当予想（税引前）'),
        annualInterestForecast: text.includes('現金宝の年間利息予想'),
        annualNetForecast: text.includes('年間純キャッシュ収入予想'),
        noDoubleCount: text.includes('純資産へもう一度加算しません'),
        dated: /20\\d{2}\\/\\d{1,2}\\/\\d{1,2}/.test(text),
        noInvalid: !text.includes('NaN') && !text.includes('undefined'),
        longTermIncomeHonest:
          (pageText.includes('未来の年間配当予想（税引前）') &&
            pageText.includes('未来の年間利息予想') &&
            pageText.includes('未来の年間純キャッシュ収入予想')) ||
          pageText.includes('目標純資産と目標日がまだ設定されていません'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    const cardScreenshot = await browser.screenshot("cash-income-card");

    await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="cash-income-actual-forecast"]');
      const button = [...(node?.querySelectorAll('button') ?? [])].find(item => item.textContent?.includes('配当入金を記録'));
      button?.click();
    })()`);
    await browser.waitUntil(
      "actual dividend dialog",
      `document.body.innerText.includes('実際の配当入金を記録') && Boolean(document.querySelector('#income-date'))`
    );
    const dialog = await browser.evalValue(`(() => {
      const text = document.body.innerText;
      return {
        title: text.includes('実際の配当入金を記録'),
        actualOnly: text.includes('実際に入金された金額だけ'),
        date: Boolean(document.querySelector('#income-date')),
        broker: Boolean(document.querySelector('#income-broker')),
        gross: Boolean(document.querySelector('#income-gross')),
        tax: Boolean(document.querySelector('#income-tax')),
        fee: Boolean(document.querySelector('#income-fee')),
      };
    })()`);
    await browser.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await browser.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });

    const passed =
      Object.entries(card)
        .filter(([key]) => !["scrollWidth", "clientWidth"].includes(key))
        .every(([, value]) => value === true) &&
      card.scrollWidth <= card.clientWidth &&
      Object.values(dialog).every(Boolean);
    return { width, passed, card, dialog, screenshot: cardScreenshot };
  } finally {
    browser.socket.close();
    browser.chrome.kill("SIGTERM");
    await sleep(500);
    await rm(browser.userDataDir, { recursive: true, force: true });
  }
}

const mobile = await verify(390, 844, 9690);
const desktop = await verify(1280, 900, 9691);
const report = { baseUrl, mobile, desktop };
console.log(JSON.stringify(report, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
