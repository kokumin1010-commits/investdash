import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const tokenFile = process.env.DEV_TOKEN_FILE ?? "/tmp/investdash-dev-token";
const token = (await readFile(tokenFile, "utf8")).trim();
if (!token) throw new Error("development token is empty");

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
  await send("Page.navigate", {
    url: `http://127.0.0.1:3000/holdings?devToken=${encodeURIComponent(token)}`,
  });
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

  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/buy-plans-mobile-drawer.png", Buffer.from(screenshot.data, "base64"));

  const result = { opened, drawerState, navigationState, activeState };
  console.log(JSON.stringify(result, null, 2));

  const passed =
    opened.triggerFound &&
    drawerState.drawerVisible &&
    drawerState.buyButtonVisible &&
    drawerState.viewportWidth === 390 &&
    drawerState.scrollWidth <= 390 &&
    navigationState.pathname === "/buy-plans" &&
    activeState.activeButtonPresent &&
    activeState.activeState === "true" &&
    activeState.heading === "買い増しプラン";
  if (!passed) process.exitCode = 1;

  socket.close();
} finally {
  chrome.kill("SIGTERM");
}
