const CACHE_NAME = "xiaokebiao-pwa-v5";
const PWA_VERSION = "0.8.2";
const PWA_RELEASE_NOTES = "改善加入主畫面版的更新流程：發現新版時先通知，由使用者選擇稍後或立即更新。";
const CACHE_PREFIX = "xiaokebiao-pwa-v";
const META_CACHE_NAME = "xiaokebiao-pwa-meta";
const ACTIVE_CACHE_URL = new URL("./__active-cache__", self.registration.scope).href;
const APP_SHELL = [
  "./",
  "./index.html",
  "./app-domain.js",
  "./manifest.webmanifest",
  "./app-icon.svg",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

async function readActiveCacheName() {
  const meta = await caches.open(META_CACHE_NAME);
  const response = await meta.match(ACTIVE_CACHE_URL);
  return response ? response.text() : "";
}

async function writeActiveCacheName(cacheName) {
  const meta = await caches.open(META_CACHE_NAME);
  await meta.put(ACTIVE_CACHE_URL, new Response(cacheName, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  }));
}

async function currentUpdateStatus() {
  const activeCacheName = await readActiveCacheName();
  return {
    type: "PWA_UPDATE_STATUS",
    available: Boolean(activeCacheName && activeCacheName !== CACHE_NAME),
    latestVersion: PWA_VERSION,
    releaseNotes: PWA_RELEASE_NOTES,
  };
}

async function removeInactiveAppCaches(activeCacheName) {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== activeCacheName && key !== CACHE_NAME)
    .map(key => caches.delete(key)));
}

self.addEventListener("message", event => {
  if (event.data?.type === "GET_PWA_UPDATE_STATUS") {
    event.waitUntil(currentUpdateStatus().then(status => event.source?.postMessage(status)));
    return;
  }
  if (event.data?.type === "ACTIVATE_PWA_UPDATE") {
    event.waitUntil((async () => {
      await writeActiveCacheName(CACHE_NAME);
      await removeInactiveAppCaches(CACHE_NAME);
      event.source?.postMessage({ type: "PWA_UPDATE_APPLIED" });
    })());
  }
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    let activeCacheName = await readActiveCacheName();
    if (!activeCacheName || !(await caches.has(activeCacheName))) {
      // First installation (including the one-time migration from the old updater)
      // establishes the current shell without showing a false update prompt.
      activeCacheName = CACHE_NAME;
      await writeActiveCacheName(activeCacheName);
    }
    await removeInactiveAppCaches(activeCacheName);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const activeCacheName = await readActiveCacheName() || CACHE_NAME;
    const activeCache = await caches.open(activeCacheName);
    const cached = await activeCache.match(event.request);
    if (cached) return cached;
    if (event.request.mode === "navigate") {
      const fallback = await activeCache.match("./index.html");
      if (fallback) return fallback;
    }
    return fetch(event.request);
  })());
});
