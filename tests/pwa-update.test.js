const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");

test("PWA update waits for explicit user consent", () => {
  assert.match(serviceWorker, /event\.data\?\.type === "GET_PWA_UPDATE_STATUS"/);
  assert.match(serviceWorker, /event\.data\?\.type === "ACTIVATE_PWA_UPDATE"/);
  assert.match(serviceWorker, /latestVersion: PWA_VERSION/);
  assert.match(serviceWorker, /releaseNotes: PWA_RELEASE_NOTES/);
  assert.match(html, /data-action="dismiss-pwa-update">稍後/);
  assert.match(html, /data-action="apply-pwa-update">立即更新/);
  assert.match(html, /postMessage\(\{ type: "ACTIVATE_PWA_UPDATE" \}\)/);
  assert.match(html, /<label>更新內容<\/label>/);
  assert.match(html, /更新後課程資料皆會保留。/);
  assert.doesNotMatch(html, /為避免上課途中畫面突然改變/);
});

test("PWA update reloads only after the user accepts", () => {
  assert.match(html, /event\.data\?\.type === "PWA_UPDATE_APPLIED"/);
  assert.match(html, /PWA_UPDATE_COMPLETED_KEY/);
  assert.match(html, /notifyCompletedPwaUpdateIfNeeded\(\)/);
  assert.match(html, /小課表已更新完成/);
  assert.match(html, /pwaUpdateDismissed = true/);
  assert.doesNotMatch(html, /controllerchange[\s\S]{0,200}location\.reload/);
});

test("active PWA serves its cached shell until the waiting version is accepted", () => {
  assert.match(serviceWorker, /readActiveCacheName\(\)/);
  assert.match(serviceWorker, /writeActiveCacheName\(CACHE_NAME\)/);
  assert.match(serviceWorker, /activeCache\.match\(event\.request\)/);
  assert.match(serviceWorker, /const CACHE_NAME = "xiaokebiao-pwa-v10"/);
});

test("credit notifications fire only at one and zero lessons and persist per student", () => {
  assert.match(html, /Domain\.creditReminderTransition\(previous, balance\)/);
  assert.match(html, /creditBalanceReminders/);
  assert.match(html, /transition\.shouldNotify/);
  assert.match(html, /saveData\(\{ checkCreditReminders: false \}\)/);
  assert.match(html, /addInboxNotification\(\{/);
  assert.match(html, /data-action="notification-center"/);
  assert.match(html, /notification-badge/);
  assert.doesNotMatch(html, /sendDailyCreditReminderIfNeeded/);
});

test("guide includes concise push and phone installation steps", () => {
  assert.match(html, /function showGuide\(\)/);
  assert.match(html, /iPhone Safari：分享 → 加入主畫面 → 新增/);
  assert.match(html, /Android Chrome：選單 ⋮ → 安裝應用程式/);
  assert.match(html, /更多 → 遠端推播 → 啟用遠端推播/);
});

test("service worker receives visible pushes and keeps notification clicks same-origin", () => {
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification\(title/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /targetUrl\.origin !== self\.location\.origin/);
});
