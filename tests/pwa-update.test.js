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
});

test("PWA update reloads only after the user accepts", () => {
  assert.match(html, /event\.data\?\.type === "PWA_UPDATE_APPLIED"/);
  assert.match(html, /pwaUpdateDismissed = true/);
  assert.doesNotMatch(html, /controllerchange[\s\S]{0,200}location\.reload/);
});

test("active PWA serves its cached shell until the waiting version is accepted", () => {
  assert.match(serviceWorker, /readActiveCacheName\(\)/);
  assert.match(serviceWorker, /writeActiveCacheName\(CACHE_NAME\)/);
  assert.match(serviceWorker, /activeCache\.match\(event\.request\)/);
  assert.match(serviceWorker, /const CACHE_NAME = "xiaokebiao-pwa-v6"/);
});
