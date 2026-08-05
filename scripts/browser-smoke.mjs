import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const port = process.env.CHROME_DEBUG_PORT || "9333";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetUrl = process.argv[2] || pathToFileURL(path.join(projectRoot, "index.html")).href;
const screenshotPath = process.argv[3] || path.join(projectRoot, "docs", "v0.8-browser-smoke-390x844.png");

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let targets;
for (let attempt = 0; attempt < 30; attempt += 1) {
  try {
    targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
    if (targets.length) break;
  } catch {
    await delay(200);
  }
}
if (!targets?.length) throw new Error("Chrome DevTools target not found");
const pageTarget = targets.find(target => target.type === "page") || targets[0];

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
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

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function click(selector) {
  const found = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  if (!found) throw new Error(`Missing browser smoke selector: ${selector}`);
  await delay(80);
}

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
await command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await command("Emulation.setUserAgentOverride", {
  userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Mobile Safari/537.36",
  platform: "Android",
});
await command("Page.navigate", { url: targetUrl });
for (let attempt = 0; attempt < 30; attempt += 1) {
  const ready = await evaluate(`location.href === ${JSON.stringify(targetUrl)} && document.readyState === 'complete' && Boolean(document.querySelector('.tour-card'))`);
  if (ready) break;
  await delay(100);
}

const initial = await evaluate(`({
  width: innerWidth,
  height: innerHeight,
  scrollWidth: document.documentElement.scrollWidth,
  onboarding: document.querySelector('.tour-card')?.getAttribute('aria-label') || ''
})`);
if (initial.width !== 390 || initial.scrollWidth > 390) throw new Error(`Mobile viewport overflow: ${JSON.stringify(initial)}`);
if (!initial.onboarding.includes("1/5")) throw new Error("Five-step first-run onboarding did not open");

for (let step = 0; step < 5; step += 1) await click("#tour-next");
const home = await evaluate(`({
  headings: [...document.querySelectorAll('.section-heading h2')].map(item => item.textContent),
  hasSummaryBar: Boolean(document.querySelector('.summary-bar')),
  hasDirectAddLesson: Boolean(document.querySelector('[data-action="add-lesson"]'))
})`);
if (!home.headings.includes("下一堂課") || !home.headings.includes("今日課程") || home.hasSummaryBar || home.hasDirectAddLesson) {
  throw new Error(`Home hierarchy regression: ${JSON.stringify(home)}`);
}
const homeScreenshotPath = screenshotPath.replace(/\.png$/i, "-home.png");
const homeScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.mkdirSync(path.dirname(homeScreenshotPath), { recursive: true });
fs.writeFileSync(homeScreenshotPath, Buffer.from(homeScreenshot.data, "base64"));
await click('[data-tab="schedule"]');

const week = await evaluate(`({
  days: document.querySelectorAll('.week-day-head').length,
  mondayFirst: document.querySelector('.week-day-head span')?.textContent || '',
  calendarView: document.querySelector('[data-calendar-view="week"]')?.getAttribute('aria-pressed')
})`);
if (week.days !== 7 || week.mondayFirst !== "週一" || week.calendarView !== "true") {
  throw new Error(`Seven-day week regression: ${JSON.stringify(week)}`);
}
const weekScreenshotPath = screenshotPath.replace(/\.png$/i, "-week.png");
const weekScreenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.mkdirSync(path.dirname(weekScreenshotPath), { recursive: true });
fs.writeFileSync(weekScreenshotPath, Buffer.from(weekScreenshot.data, "base64"));

await click('[data-calendar-view="month"]');
const monthDays = await evaluate("document.querySelectorAll('.month-day').length");
if (monthDays !== 42) throw new Error(`Month grid expected 42 cells, got ${monthDays}`);
const monthCounts = await evaluate("document.querySelectorAll('.month-count').length");
if (monthCounts < 1) throw new Error("Month cells do not expose daily lesson counts");

await click('[data-action="add-calendar-lesson"]');
await click('input[name="lessonType"][value="trial"]');
const trialVisible = await evaluate(`({
  formal: getComputedStyle(document.querySelector('#formal-lesson-fields')).display,
  trial: getComputedStyle(document.querySelector('#trial-lesson-fields')).display,
  repeat: getComputedStyle(document.querySelector('#repeat-options')).display
})`);
if (trialVisible.formal !== "none" || trialVisible.trial === "none" || trialVisible.repeat !== "none") {
  throw new Error(`Trial form visibility regression: ${JSON.stringify(trialVisible)}`);
}
await evaluate(`(() => {
  const start = document.querySelector('#start-time');
  const duration = document.querySelector('#lesson-duration');
  start.value = '20:00';
  start.dispatchEvent(new Event('change', { bubbles: true }));
  duration.value = '90';
  duration.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const calculatedEnd = await evaluate("document.querySelector('#end-time').value");
if (calculatedEnd !== "21:30") throw new Error(`Duration auto-calculation failed: ${calculatedEnd}`);
await click('[data-action="close-sheet"]');

await click('[data-tab="more"]');
await click('[data-action="clear-data"]');
const clearDisabledBefore = await evaluate("document.querySelector('#clear-all-submit').disabled");
await evaluate(`(() => { const input = document.querySelector('#clear-confirmation'); input.value = '確認清除'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const clearDisabledAfter = await evaluate("document.querySelector('#clear-all-submit').disabled");
if (!clearDisabledBefore || clearDisabledAfter) throw new Error("Typed clear-all confirmation guard failed");
await click('[data-action="close-sheet"]');

const screenshot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

if (runtimeErrors.length) throw new Error(`Browser runtime exceptions: ${runtimeErrors.join("; ")}`);
console.log(JSON.stringify({ initial, home, week, monthDays, monthCounts, calculatedEnd, trialVisible, clearConfirmationGuard: true, runtimeErrors: 0 }, null, 2));
socket.close();
