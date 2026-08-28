import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const token = (await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/prod-watch-token", "utf8")).trim();
const baseUrl = (process.env.BASE_URL ?? "https://salesdash.buzzdrop.co.jp/investdash").replace(/\/$/, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function verify(width, height, port) {
  const chrome = spawn("chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`,
    `--user-data-dir=/tmp/investdash-watch-proposal-${width}`, `--window-size=${width},${height}`, "about:blank",
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
    const clickText = async text => evalValue(`(() => {
      const el = [...document.querySelectorAll('button')].find(node => node.textContent?.trim().includes(${JSON.stringify(text)}));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    const clickExact = async text => evalValue(`(() => {
      const el = [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
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
    await waitForText("IBKR シンガポール レバレッジ");
    const dashboard = await evalValue(`(() => {
      const text = document.body?.textContent ?? '';
      return {
        path: location.pathname,
        scrollWidth: document.documentElement.scrollWidth,
        ibkrMain: text.includes('IBKR シンガポール レバレッジ') && text.includes('1.82 倍'),
        ibkrOnly: text.includes('借入（IBKR シンガポールのみ）'),
        marginRisk: text.includes('追証までの下落余地') && text.includes('34.2%'),
        annualInterest: text.includes('年間の借入利息') && text.includes('3,961,737'),
        overallReference: text.includes('全体レバレッジ（参考）') && text.includes('1.18 倍'),
      };
    })()`);
    await shot("ibkr-leverage-dashboard");

    await send("Page.navigate", { url: `${baseUrl}/watchlist` });
    await waitForText("PayPal Holdings, Inc.");
    await waitForText("AI提案・要確認");
    const watchBefore = await evalValue(`(() => {
      const cards = [...document.querySelectorAll('[data-slot="card"]')];
      const card = cards.find(node => node.textContent?.includes('PYPL'));
      const text = card?.textContent ?? '';
      const proposalBlock = card?.querySelector('.border-violet-200');
      return {
        path: location.pathname,
        scrollWidth: document.documentElement.scrollWidth,
        pending: text.includes('AI提案・要確認') && text.includes('確信度'),
        conclusion: (proposalBlock?.textContent?.trim().length ?? 0) > 20,
        hasReviewButton: [...(card?.querySelectorAll('button') ?? [])].some(node => node.textContent?.includes('提案を確認')),
      };
    })()`);
    await clickText("提案を確認");
    await waitForText("価格を待つ");
    await sleep(300);
    const review = await evalValue(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = dialog?.textContent ?? '';
      const targetInput = dialog?.querySelector('#proposal-target');
      return {
        visible: Boolean(dialog),
        currentPrice: text.includes('現在値') && !text.includes('現在値—'),
        target: text.includes('AI目標') && Boolean(targetInput?.value),
        gap: text.includes('値幅') && text.includes('%'),
        confidence: text.includes('確信度'),
        evidence: text.includes('ニュース 20 件') && text.includes('6か月レンジ'),
        confirmation: text.includes('提案を採用して保存') && text.includes('あとで確認') && text.includes('今回は見送る'),
      };
    })()`);
    await shot("watch-proposal-review");
    await send("Page.navigate", { url: `${baseUrl}/watchlist` });
    await waitForText("PayPal Holdings, Inc.");
    if (!(await clickExact("銘柄を追加"))) throw new Error(`missing exact add button at ${width}px`);
    await waitForText("ウォッチリストに追加");
    await sleep(300);
    const addDialog = await evalValue(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = dialog?.textContent ?? '';
      const labels = [...(dialog?.querySelectorAll('label') ?? [])].map(node => node.textContent?.trim());
      return {
        visible: Boolean(dialog),
        symbolOnly: labels.includes('銘柄コード') && !labels.includes('目標買付価格') && !labels.includes('投資予定額'),
        explainsFlow: text.includes('最初は銘柄コードだけで追加') && text.includes('AIが情報取得') && text.includes('確認して保存'),
      };
    })()`);
    await shot("watch-symbol-first-add");

    socket.close();
    const allTrue = value => Object.entries(value)
      .filter(([key]) => !['path', 'scrollWidth'].includes(key))
      .every(([, flag]) => flag === true);
    return {
      width,
      dashboard,
      watchBefore,
      review,
      addDialog,
      passed: dashboard.path.endsWith('/investdash/') && dashboard.scrollWidth <= width && allTrue(dashboard) &&
        watchBefore.path.endsWith('/watchlist') && watchBefore.scrollWidth <= width && allTrue(watchBefore) &&
        allTrue(review) && allTrue(addDialog),
    };
  } finally {
    chrome.kill("SIGTERM");
  }
}

const mobile = await verify(390, 844, 9256);
const desktop = await verify(1280, 900, 9257);
console.log(JSON.stringify({ mobile, desktop }, null, 2));
if (!mobile.passed || !desktop.passed) process.exitCode = 1;
