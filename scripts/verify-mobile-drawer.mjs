import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const tokenFile = process.env.DEV_TOKEN_FILE ?? "/tmp/investdash-dev-token";
const token = (await readFile(tokenFile, "utf8")).trim();
if (!token) throw new Error("passcode token is empty");
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const holdingsUrl = `${baseUrl}/holdings`;
const buyPlansUrl = `${baseUrl}/buy-plans`;
const expectedBuyPlansPath = new URL(buyPlansUrl).pathname;

const debugPort = 9223;
const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    "--user-data-dir=/tmp/investdash-mobile-drawer-profile",
    "--window-size=390,844",
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForJson(url, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chromium is still starting.
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

try {
  const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find(item => item.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("missing page target");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
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

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: `${baseUrl}/` });
  await sleep(1200);
  await evaluate(
    `localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)})`
  );
  await send("Page.navigate", { url: holdingsUrl });
  await sleep(5000);

  const opened = await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button[data-sidebar="trigger"]')].find(
      button => button.getBoundingClientRect().width > 0
    );
    if (!trigger) return { triggerFound: false };
    trigger.click();
    return { triggerFound: true };
  })()`);
  await sleep(700);

  const drawerState = await evaluate(`(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden';
    };
    const buyButton = [...document.querySelectorAll('button')].find(
      button => visible(button) && button.textContent.trim() === '買い増しプラン'
    );
    const drawer = document.querySelector('[data-mobile="true"][data-sidebar="sidebar"]');
    return {
      drawerVisible: Boolean(drawer && visible(drawer)),
      buyButtonVisible: Boolean(buyButton),
      viewportWidth: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  })()`);
  const drawerScreenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "/tmp/buy-plans-mobile-drawer-open.png",
    Buffer.from(drawerScreenshot.data, "base64")
  );

  await evaluate(`(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const buyButton = [...document.querySelectorAll('button')].find(
      button => visible(button) && button.textContent.trim() === '買い増しプラン'
    );
    if (buyButton) buyButton.click();
    return Boolean(buyButton);
  })()`);
  await sleep(1200);

  const navigationState = await evaluate(`({ pathname: location.pathname })`);

  const activeState = await evaluate(`(() => {
    const buyButton = [...document.querySelectorAll('button')].find(
      button => button.textContent.trim() === '買い増しプラン' && button.getAttribute('data-active') === 'true'
    );
    return {
      activeButtonPresent: Boolean(buyButton),
      activeClass: buyButton?.className ?? '',
      activeState: buyButton?.getAttribute('data-active') ?? '',
      heading: document.querySelector('h1')?.textContent?.trim() ?? '',
    };
  })()`);

  let interactionState = null;
  if (process.env.FULL_INTERACTION === "true") {
    const filterResults = {};
    for (const label of ["買い増し圏", "様子見", "確認が必要", "価格帯の外", "すべて"]) {
      const clicked = await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(
          item => item.textContent.trim().startsWith(${JSON.stringify(label)})
        );
        button?.click();
        return Boolean(button);
      })()`);
      await sleep(350);
      filterResults[label] = await evaluate(`({
        clicked: ${clicked},
        hasToyota: document.body.textContent.includes('トヨタ自動車'),
        hasEmpty: document.body.textContent.includes('該当する銘柄はありません')
      })`);
    }

    const searchInputFound = await evaluate(`(() => {
      const input = document.querySelector('input[placeholder="銘柄名・ティッカー"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'NO-SUCH-SYMBOL');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(500);
    const emptySearch = await evaluate(`({
      hasEmpty: document.body.textContent.includes('該当する銘柄はありません'),
      clearButton: [...document.querySelectorAll('button')].some(
        button => button.textContent.trim() === '検索をクリアして一覧に戻す'
      )
    })`);
    const clearClicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === '検索をクリアして一覧に戻す'
      );
      button?.click();
      return Boolean(button);
    })()`);
    await sleep(500);
    const restoredSearch = await evaluate(
      `document.body.textContent.includes('トヨタ自動車')`
    );

    const aiCtaClicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === '判断が必要な銘柄を提案させる'
      );
      button?.click();
      return Boolean(button);
    })()`);
    await sleep(15_000);
    const aiProposalVisible = await evaluate(
      `document.body.textContent.includes('AI の買い増し提案') && Boolean(document.querySelector('a[href*="/consult?"]'))`
    );

    const planCardClicked = await evaluate(`(() => {
      const link = [...document.querySelectorAll('a')].find(
        item => item.href.includes('/holdings?symbol=7203.T') && item.textContent.includes('トヨタ自動車')
      );
      link?.click();
      return Boolean(link);
    })()`);
    await sleep(900);
    const planCardPath = await evaluate(`location.pathname + location.search`);

    await send("Page.navigate", { url: buyPlansUrl });
    await sleep(5000);
    const consultClicked = await evaluate(`(() => {
      const link = document.querySelector('a[href*="/consult?"]') ??
        [...document.querySelectorAll('a')].find(
          item => item.textContent.trim() === 'この件を相談する'
        );
      link?.click();
      return Boolean(link);
    })()`);
    await sleep(900);
    const consultState = await evaluate(`({
      path: location.pathname,
      search: location.search,
      prefilled: Boolean(document.querySelector('textarea')?.value.trim())
    })`);

    interactionState = {
      filterResults,
      searchInputFound,
      emptySearch,
      clearClicked,
      restoredSearch,
      aiCtaClicked,
      aiProposalVisible,
      planCardClicked,
      planCardPath,
      consultClicked,
      consultState,
    };
  }

  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/buy-plans-mobile-drawer.png", Buffer.from(screenshot.data, "base64"));

  const result = { opened, drawerState, navigationState, activeState, interactionState };
  console.log(JSON.stringify(result, null, 2));

  const passed =
    opened.triggerFound &&
    drawerState.drawerVisible &&
    drawerState.buyButtonVisible &&
    drawerState.viewportWidth === 390 &&
    drawerState.scrollWidth <= 390 &&
    navigationState.pathname === expectedBuyPlansPath &&
    activeState.activeButtonPresent &&
    activeState.activeState === "true" &&
    activeState.heading === "買い増しプラン";
  const fullInteractionPassed =
    !interactionState ||
    (Object.values(interactionState.filterResults).every(result => result.clicked) &&
      interactionState.filterResults["すべて"].hasToyota &&
      interactionState.searchInputFound &&
      interactionState.emptySearch.hasEmpty &&
      interactionState.emptySearch.clearButton &&
      interactionState.clearClicked &&
      interactionState.restoredSearch &&
      interactionState.aiCtaClicked &&
      interactionState.aiProposalVisible &&
      interactionState.planCardClicked &&
      interactionState.planCardPath.includes("/holdings?symbol=7203.T") &&
      interactionState.consultClicked &&
      interactionState.consultState.path.endsWith("/consult") &&
      interactionState.consultState.search.includes("symbol=") &&
      interactionState.consultState.search.includes("question=") &&
      interactionState.consultState.prefilled);
  if (!passed || !fullInteractionPassed) process.exitCode = 1;

  socket.close();
} finally {
  chrome.kill("SIGTERM");
}
