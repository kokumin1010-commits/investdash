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
  const waitUntil = async (
    label,
    expression,
    attempts = Number(process.env.UI_WAIT_ATTEMPTS ?? 240)
  ) => {
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
      "market temperature panel",
      `Boolean(document.querySelector('[data-testid="market-temperature-panel"]'))`
    );
    await browser.waitUntil(
      "long-term income state",
      `(document.body.innerText.includes('未来の配当予想（税引前）') && document.body.innerText.includes('2030年末の3つの複利・再投資情景')) || document.body.innerText.includes('目標純資産と目標日がまだ設定されていません')`
    );
    await browser.waitUntil(
      "stock data health",
      `document.body.innerText.includes('株価データは最新です') || document.body.innerText.includes('銘柄の株価が古くなっています')`
    );
    const marketTemperature = await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="market-temperature-panel"]');
      const income = document.querySelector('[data-testid="cash-income-actual-forecast"]');
      const text = node?.innerText ?? '';
      return {
        present: Boolean(node),
        first: Boolean(node && income && (node.compareDocumentPosition(income) & Node.DOCUMENT_POSITION_FOLLOWING)),
        heading: text.includes('資産温度計'),
        stockValue: text.includes('株式時価（借入を含む）'),
        unrealizedPnl: text.includes('評価損益'),
        allWindows:
          Boolean(node?.querySelector('[data-testid="temperature-前日"]')) &&
          Boolean(node?.querySelector('[data-testid="temperature-7日"]')) &&
          Boolean(node?.querySelector('[data-testid="temperature-30日"]')),
        valueKinds:
          text.includes('株式値動き') && text.includes('純資産の評価変動'),
        headlineKinds:
          text.includes('保有株値動き') && text.includes('純資産評価変動'),
        cashReadiness:
          text.includes('買い場の準備') &&
          text.includes('確認済みプラス現金') &&
          text.includes('借入・負現金'),
        thresholds:
          text.includes('判定基準') &&
          text.includes('弱含み') &&
          text.includes('調整') &&
          text.includes('大幅下落'),
        signal:
          text.includes('通常範囲') ||
          text.includes('弱含み') ||
          text.includes('調整局面') ||
          text.includes('大幅下落') ||
          text.includes('判定待ち'),
        noDuplicateTopCards:
          document.querySelectorAll('[data-testid="top-stock-value-card"]').length === 1 &&
          document.querySelectorAll('[data-testid="top-unrealized-pnl-card"]').length === 1 &&
          document.querySelectorAll('[data-testid="top-asset-trend-card"]').length === 1,
        noInvalid: !text.includes('NaN') && !text.includes('undefined'),
      };
    })()`);
    await browser.evalValue(`document.querySelector('[data-testid="market-temperature-panel"]')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);
    const marketTemperatureScreenshot = await browser.screenshot("market-temperature");

    await browser.evalValue(`document.querySelector('[data-testid="cash-income-actual-forecast"]')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);
    const card = await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="cash-income-actual-forecast"]');
      const text = node?.innerText ?? '';
      const pageText = document.body?.innerText ?? '';
      return {
        present: Boolean(node),
        screenshotEntry: text.includes('スクショから自動計算'),
        actualHeading: text.includes('記録済みの確定キャッシュ収益'),
        confirmedScreenshotPeriod:
          text.includes('前回スクショ以降の確定利息') &&
          text.includes('→') &&
          text.includes('の累計差額'),
        dailyInterest: text.includes('最新記録の日次利息'),
        latestCumulative: text.includes('現金宝の最新累計利息'),
        dividendActual: text.includes('本年の入金済み配当'),
        unlinked: text.includes('未連携'),
        forecastHeading: text.includes('将来1年間の予想（未確定）'),
        annualDividendForecast: text.includes('年間配当予想（税引前）'),
        annualInterestForecast: text.includes('現金宝の年間利息予想'),
        annualNetForecast: text.includes('年間純キャッシュ収入予想'),
        noDoubleCount: text.includes('純資産へもう一度加算しません'),
        dated: /20\\d{2}\\/\\d{1,2}\\/\\d{1,2}/.test(text),
        noInvalid: !text.includes('NaN') && !text.includes('undefined'),
        exactNetAssets: /現在の純資産[^¥]*¥[0-9,]+/.test(pageText),
        previousNetAssets: /前日純資産[^¥]*¥[0-9,]+（[0-9]{4}-[0-9]{2}-[0-9]{2}）/.test(pageText),
        previousChange: pageText.includes('前日／前回比') && !pageText.includes('前日／前回比 前回値未取得'),
        sevenDayBasis: /7日比（[0-9]{4}-[0-9]{2}-[0-9]{2}基準）/.test(pageText),
        thirtyDayHonest: /30日比（[0-9]{4}-[0-9]{2}-[0-9]{2}基準）/.test(pageText) || pageText.includes('30日比 30日前未取得'),
        netAssetsAreValuation: pageText.includes('現在の純資産（評価額）') && pageText.includes('純資産の評価変動（未確定を含む）'),
        unrealizedStockPnl: pageText.includes('株式：含み損益') && pageText.includes('未実現'),
        confirmedCashIncome:
          pageText.includes('現金宝：前回スクショ以降の確定利息') &&
          pageText.includes('株式：入金済み配当'),
        forecastIsUnconfirmed: pageText.includes('将来予想（未確定）') && pageText.includes('将来1年間の予想（未確定）'),
        noSourceInference: pageText.includes('純資産差から推測して埋めることもしません'),
        cashTracking: text.includes('現金残高：スクショ確定＋暫定更新'),
        positiveCash: text.includes('プラス現金（確定）'),
        negativeMarginCash: text.includes('借入・負現金（確定）'),
        settledAfterAnchor: text.includes('基準後の入金済み配当'),
        provisionalBalance: text.includes('相殺後の暫定純現金'),
        pendingDividend: text.includes('入金確認待ちの配当予想'),
        noForecastInBalance: text.includes('予想配当は残高に入れません'),
        honestLegacyState:
          text.includes('旧全体値・口座未分類') || text.includes('暫定・'),
        screenshotWait:
          text.includes('次回スクショ待ち') || text.includes('口座別スクショ確認済みの合計'),
        dailyCompounding:
          pageText.includes('毎日の利息を残高へ組み入れ') &&
          pageText.includes('日次複利'),
        compactHealthPresent: pageText.includes('株価データは最新です'),
        globalSearchPresent: Boolean(document.querySelector('#global-stock-query')),
        longTermIncomeHonest:
          (pageText.includes('未来の配当予想（税引前）') &&
            pageText.includes('未来の利息予想') &&
            pageText.includes('未来の純キャッシュ収入予想')) ||
          pageText.includes('目標純資産と目標日がまだ設定されていません'),
        goalReinvestmentModel:
          (pageText.includes('2030年末の3つの複利・再投資情景') &&
            pageText.includes('配当は全額再投資') &&
            pageText.includes('配当再投資') &&
            pageText.includes('現金宝複利') &&
            pageText.includes('借入利息') &&
            pageText.includes('株価年率 4.0%') &&
            pageText.includes('株価年率 8.0%') &&
            pageText.includes('株価年率 12.0%')) ||
          pageText.includes('目標純資産と目標日がまだ設定されていません'),
        forecastNotActualDividend:
          pageText.includes('予想を確定収益にはしません') ||
          pageText.includes('目標純資産と目標日がまだ設定されていません'),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    })()`);
    const cardScreenshot = await browser.screenshot("cash-income-card");

    const cashTrackingPresent = await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="cash-balance-tracking"]');
      node?.scrollIntoView({ block: 'start' });
      return Boolean(node);
    })()`);
    await sleep(300);
    const cashTrackingScreenshot = await browser.screenshot("cash-balance-tracking");

    const longTermPresent = await browser.evalValue(`(() => {
      const marker = [...document.querySelectorAll('p')].find(item => item.textContent?.trim() === 'LONG-TERM NORTH STAR');
      const node = marker?.closest('[data-slot="card"]');
      node?.scrollIntoView({ block: 'start' });
      return Boolean(node);
    })()`);
    await sleep(300);
    const longTermScreenshot = await browser.screenshot("long-term-goal");

    const reinvestmentBasisPresent = await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="long-term-projection-basis"]');
      node?.scrollIntoView({ block: 'start' });
      return Boolean(node);
    })()`);
    await sleep(300);
    const reinvestmentScreenshot = await browser.screenshot("goal-reinvestment");

    const classificationPresent = await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="return-classification"]');
      node?.scrollIntoView({ block: 'start' });
      return Boolean(node);
    })()`);
    await sleep(300);
    const classificationScreenshot = await browser.screenshot("return-classification");

    await browser.evalValue(`document.querySelector('[data-testid="cash-income-actual-forecast"]')?.scrollIntoView({ block: 'start' })`);
    await sleep(300);

    await browser.evalValue(`(() => {
      const node = document.querySelector('[data-testid="cash-income-actual-forecast"]');
      const button = [...(node?.querySelectorAll('button') ?? [])].find(item => item.textContent?.includes('手入力'));
      button?.click();
    })()`);
    await browser.waitUntil(
      "actual dividend dialog",
      `document.body.innerText.includes('配当入金を手入力') && Boolean(document.querySelector('#income-date'))`
    );
    const dialog = await browser.evalValue(`(() => {
      const text = document.body.innerText;
      return {
        title: text.includes('配当入金を手入力'),
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
      Object.values(marketTemperature).every(Boolean) &&
      longTermPresent &&
      reinvestmentBasisPresent &&
      classificationPresent &&
      cashTrackingPresent &&
      card.scrollWidth <= card.clientWidth &&
      Object.values(dialog).every(Boolean);
    return {
      width,
      passed,
      card,
      marketTemperature,
      dialog,
      screenshots: {
        marketTemperature: marketTemperatureScreenshot,
        cashIncome: cardScreenshot,
        cashBalanceTracking: cashTrackingScreenshot,
        longTermGoal: longTermScreenshot,
        goalReinvestment: reinvestmentScreenshot,
        returnClassification: classificationScreenshot,
      },
    };
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
