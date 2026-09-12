import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";

const token = (
  await readFile(process.env.DEV_TOKEN_FILE ?? "/tmp/screenshot-cash-income-token", "utf8")
).trim();
const baseUrl = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const imagePath = process.env.TEST_IMAGE ?? "/tmp/futu-cash-income-ocr-test.png";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const userDataDir = `/tmp/investdash-screenshot-cash-${process.pid}`;
await rm(userDataDir, { recursive: true, force: true });
const chrome = spawn(
  "chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--remote-debugging-port=9710",
    `--user-data-dir=${userDataDir}`,
    "--window-size=390,844",
    "about:blank",
  ],
  { stdio: "ignore" }
);

let target;
for (let index = 0; index < 100; index += 1) {
  try {
    const targets = await (await fetch("http://127.0.0.1:9710/json/list")).json();
    target = targets.find(item => item.type === "page");
    if (target) break;
  } catch {}
  await sleep(100);
}
if (!target?.webSocketDebuggerUrl) throw new Error("missing Chrome target");

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
const waitUntil = async (label, expression, attempts = 360) => {
  for (let index = 0; index < attempts; index += 1) {
    try {
      if (await evaluate(expression)) return;
    } catch {}
    await sleep(500);
  }
  const diagnostic = await evaluate(
    `({ url: location.href, text: document.body?.innerText?.slice(0, 6000) ?? '' })`
  );
  throw new Error(`${label} timeout: ${JSON.stringify(diagnostic)}`);
};
const setViewport = (width, height) =>
  send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
const capture = async (name, width) => {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const path = `/tmp/investdash-${name}-${width}.png`;
  await writeFile(path, Buffer.from(result.data, "base64"));
  return path;
};

try {
  await send("Page.enable");
  await send("DOM.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await setViewport(390, 844);
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try {
      localStorage.setItem('investdesk-passcode-token', ${JSON.stringify(token)});
      localStorage.setItem('investdesk.import.format', 'futu_hk');
    } catch {}`,
  });
  await send("Page.navigate", { url: `${baseUrl}/import` });
  await waitUntil(
    "import page",
    `document.body.innerText.includes('スクリーンショット取込') && Boolean(document.querySelector('input[type="file"]'))`
  );
  const documentNode = await send("DOM.getDocument");
  const fileInput = await send("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: 'input[type="file"]',
  });
  await send("DOM.setFileInputFiles", {
    nodeId: fileInput.nodeId,
    files: [imagePath],
  });
  await waitUntil(
    "prepared image",
    `[...document.querySelectorAll('button')].some(button => button.textContent?.includes('読み取りを開始'))`
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(button => button.textContent?.includes('読み取りを開始'))?.click()`
  );
  await waitUntil(
    "cash income review",
    `Boolean(document.querySelector('[data-testid="screenshot-cash-income-review"]'))`
  );

  const inspect = async () =>
    evaluate(`(() => {
      const review = document.querySelector('[data-testid="screenshot-cash-income-review"]');
      review?.scrollIntoView({ block: 'start' });
      const text = review?.innerText ?? '';
      return {
        review: Boolean(review),
        interest: text.includes('易方達(香港)美元貨幣市場基金'),
        currentCumulative: text.includes('現在の累計収益'),
        previousCumulative: text.includes('前回の累計収益'),
        actualDelta: text.includes('前回スクショ以降の実際利息'),
        dividend: text.includes('Texas Instruments'),
        netOnly: text.includes('ネット入金のみ取得'),
        actualNet: text.includes('USD 84'),
        confirmFirst: text.includes('確認して保存するまで実績には反映されません'),
        saveSummary: document.body.innerText.includes('保有 0 件・キャッシュ収入 2 件を保存します'),
        noInvalid: !text.includes('NaN') && !text.includes('undefined'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);

  await sleep(300);
  const mobile = await inspect();
  const mobileScreenshot = await capture("screenshot-cash-income-review", 390);

  await setViewport(1280, 900);
  await sleep(400);
  const desktop = await inspect();
  const desktopScreenshot = await capture("screenshot-cash-income-review", 1280);

  const passed = value =>
    Object.entries(value)
      .filter(([key]) => !["scrollWidth", "clientWidth"].includes(key))
      .every(([, flag]) => flag === true) && value.scrollWidth <= value.clientWidth;
  const report = {
    baseUrl,
    modelInvocationCount: 1,
    applied: false,
    mobile: { ...mobile, screenshot: mobileScreenshot, passed: passed(mobile) },
    desktop: { ...desktop, screenshot: desktopScreenshot, passed: passed(desktop) },
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.mobile.passed || !report.desktop.passed) process.exitCode = 1;
} finally {
  socket.close();
  chrome.kill("SIGTERM");
  await sleep(500);
  await rm(userDataDir, { recursive: true, force: true });
}

