import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const chromePath = chromeCandidates.find(candidate => fs.existsSync(candidate));
if (!chromePath) throw new Error("Chrome or Edge was not found");

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xiaokebiao-pwa-update-"));
const siteRoot = path.join(tempRoot, "site");
const profileRoot = path.join(tempRoot, "profile");
const screenshotPath = process.argv[2] || path.join(projectRoot, "docs", "v0.8.2-pwa-update-consent-390x844.png");
fs.mkdirSync(siteRoot, { recursive: true });
fs.mkdirSync(profileRoot, { recursive: true });

for (const name of ["index.html", "app-domain.js", "push-config.js", "manifest.webmanifest", "app-icon.svg", "service-worker.js"]) {
  fs.copyFileSync(path.join(projectRoot, name), path.join(siteRoot, name));
}
const serviceWorkerSource = fs.readFileSync(path.join(projectRoot, "service-worker.js"), "utf8");
const currentCacheName = serviceWorkerSource.match(/const CACHE_NAME = "([^"]+)"/)?.[1];
const currentVersion = serviceWorkerSource.match(/const PWA_VERSION = "([^"]+)"/)?.[1];
const cacheVersion = Number(currentCacheName?.match(/-v(\d+)$/)?.[1]);
if (!currentCacheName || !currentVersion || !Number.isInteger(cacheVersion)) throw new Error("Unable to read current PWA version metadata");
const nextCacheName = currentCacheName.replace(/-v\d+$/, `-v${cacheVersion + 1}`);
fs.cpSync(path.join(projectRoot, "icons"), path.join(siteRoot, "icons"), { recursive: true });

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(siteRoot, relativePath);
  if (!filePath.startsWith(siteRoot)) {
    response.writeHead(403).end();
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", contentTypes[path.extname(filePath)] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    response.end(data);
  });
});
await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
const sitePort = server.address().port;

const debugServer = http.createServer();
await new Promise((resolve, reject) => debugServer.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
const debugPort = debugServer.address().port;
await new Promise(resolve => debugServer.close(resolve));

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--user-data-dir=${profileRoot}`,
  `--remote-debugging-port=${debugPort}`,
  "about:blank",
], { stdio: "ignore" });

let socket;
try {
  let targets;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json());
      if (targets.length) break;
    } catch {}
    await delay(100);
  }
  if (!targets?.length) throw new Error("Chrome DevTools target not found");
  const target = targets.find(item => item.type === "page") || targets[0];
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(message.params.exceptionDetails.text);
    }
  });
  const command = (method, params = {}) => {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const evaluate = async expression => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  const waitFor = async (expression, label, attempts = 120) => {
    console.log(`WAIT ${label}`);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (await evaluate(expression)) {
          console.log(`OK ${label}`);
          return;
        }
      } catch {}
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };

  await command("Runtime.enable");
  await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });
  const targetUrl = `http://127.0.0.1:${sitePort}/`;
  await command("Page.navigate", { url: targetUrl });
  await waitFor("document.readyState === 'complete'", "initial page load");
  await waitFor("navigator.serviceWorker.controller !== null", "initial service worker control");
  await waitFor(`caches.open('xiaokebiao-pwa-meta').then(cache => cache.match('./__active-cache__')).then(response => response?.text()).then(value => value === ${JSON.stringify(currentCacheName)})`, "initial active cache");

  for (let step = 0; step < 6; step += 1) {
    if (!(await evaluate("Boolean(document.querySelector('#tour-next'))"))) break;
    await evaluate("document.querySelector('#tour-next').click()");
    await delay(100);
  }
  const firstInstallPrompt = await evaluate("document.querySelector('.sheet-header h2')?.textContent === '小課表有新版本'");
  if (firstInstallPrompt) throw new Error("First installation showed a false update prompt");

  fs.writeFileSync(path.join(siteRoot, "service-worker.js"), serviceWorkerSource.replace(currentCacheName, nextCacheName));
  await evaluate("navigator.serviceWorker.getRegistration().then(registration => registration.update())");
  await waitFor(`caches.keys().then(keys => keys.includes(${JSON.stringify(nextCacheName)}))`, "next cache installation");
  await waitFor(`document.querySelector('.sheet-header h2')?.textContent?.startsWith(${JSON.stringify(`小課表 ${currentVersion}`)})`, "update consent sheet");

  const beforeDismiss = await evaluate(`caches.open('xiaokebiao-pwa-meta').then(cache => cache.match('./__active-cache__')).then(response => response.text())`);
  if (beforeDismiss !== currentCacheName) throw new Error(`Update activated before consent: ${beforeDismiss}`);
  const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await evaluate("document.querySelector('[data-action=\"dismiss-pwa-update\"]').click()");
  await waitFor("!document.querySelector('.sheet-header h2')", "dismissed update sheet");
  const afterDismiss = await evaluate(`caches.open('xiaokebiao-pwa-meta').then(cache => cache.match('./__active-cache__')).then(response => response.text())`);
  if (afterDismiss !== currentCacheName) throw new Error(`Dismiss changed active version: ${afterDismiss}`);

  await command("Page.reload", { ignoreCache: true });
  await waitFor("document.readyState === 'complete'", "reopened PWA");
  await waitFor(`document.querySelector('.sheet-header h2')?.textContent?.startsWith(${JSON.stringify(`小課表 ${currentVersion}`)})`, "next-open reminder");
  const afterReopen = await evaluate(`caches.open('xiaokebiao-pwa-meta').then(cache => cache.match('./__active-cache__')).then(response => response.text())`);
  if (afterReopen !== currentCacheName) throw new Error(`Reopen changed active version without consent: ${afterReopen}`);

  await evaluate("document.querySelector('[data-action=\"apply-pwa-update\"]').click()");
  await waitFor(`caches.open('xiaokebiao-pwa-meta').then(cache => cache.match('./__active-cache__')).then(response => response.text()).then(value => value === ${JSON.stringify(nextCacheName)})`, "accepted update activation");
  await waitFor(`caches.keys().then(keys => !keys.includes(${JSON.stringify(currentCacheName)}))`, "old cache cleanup");
  if (runtimeErrors.length) throw new Error(`Browser runtime exceptions: ${runtimeErrors.join("; ")}`);

  console.log(JSON.stringify({
    viewport: "390x844",
    firstInstallPrompt: false,
    promptBeforeUpdate: true,
    activeBeforeDismiss: beforeDismiss,
    activeAfterDismiss: afterDismiss,
    activeAfterReopen: afterReopen,
    activeAfterConsent: nextCacheName,
    oldCacheRemovedAfterConsent: true,
    runtimeErrors: 0,
    screenshotPath,
  }, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id: 999999, method: "Browser.close", params: {} }));
  await delay(300);
  if (!chrome.killed) chrome.kill();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch (error) {
    console.warn(`Temporary browser profile cleanup deferred: ${error.code || error.message}`);
  }
}
