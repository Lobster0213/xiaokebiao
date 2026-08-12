import webpush from "web-push";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const SUBSCRIPTION_PREFIX = "subscription:";
const MAX_SUBSCRIPTIONS = 5000;

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status = 200, env = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(env), "Cache-Control": "no-store" },
  });
}

function checkOrigin(request, env) {
  const origin = request.headers.get("Origin");
  return !origin || origin === env.ALLOWED_ORIGIN;
}

function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left || ""));
  const b = encoder.encode(String(right || ""));
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] || 0) ^ (b[index] || 0);
  return mismatch === 0;
}

function isAdmin(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return token.length >= 32 && constantTimeEqual(token, env.ADMIN_TOKEN);
}

async function readJson(request, limit = 8192) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > limit) throw new Response("Payload too large", { status: 413 });
  const text = await request.text();
  if (text.length > limit) throw new Response("Payload too large", { status: 413 });
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Response("Invalid JSON", { status: 400 });
  }
}

function validateSubscription(value) {
  const endpoint = String(value?.endpoint || "");
  const p256dh = String(value?.keys?.p256dh || "");
  const auth = String(value?.keys?.auth || "");
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== "https:" || endpoint.length > 2048 || p256dh.length < 40 || p256dh.length > 256 || auth.length < 8 || auth.length > 128) return null;
  return { endpoint, expirationTime: value.expirationTime || null, keys: { p256dh, auth } };
}

async function digestEndpoint(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function subscriptionKey(endpoint) {
  return `${SUBSCRIPTION_PREFIX}${await digestEndpoint(endpoint)}`;
}

function clientAddress(request) {
  return String(request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 80);
}

async function checkRateLimit(request, env, bucket, limit, windowSeconds) {
  const key = `rate:${bucket}:${await digestEndpoint(clientAddress(request))}`;
  const current = Number(await env.SUBSCRIPTIONS.get(key) || 0);
  if (current >= limit) return false;
  await env.SUBSCRIPTIONS.put(key, String(current + 1), { expirationTtl: windowSeconds });
  return true;
}

async function countSubscriptions(env, stopAt = MAX_SUBSCRIPTIONS) {
  let count = 0;
  let cursor;
  do {
    const page = await env.SUBSCRIPTIONS.list({ prefix: SUBSCRIPTION_PREFIX, cursor, limit: Math.min(1000, stopAt - count) });
    count += page.keys.length;
    cursor = page.list_complete || count >= stopAt ? undefined : page.cursor;
  } while (cursor);
  return count;
}

async function saveSubscription(request, env) {
  if (!(await checkRateLimit(request, env, "subscribe", 20, 3600))) return json({ error: "Too many requests" }, 429, env);
  const body = await readJson(request);
  const subscription = validateSubscription(body.subscription);
  if (!subscription) return json({ error: "Invalid push subscription" }, 400, env);
  const key = await subscriptionKey(subscription.endpoint);
  const existing = await env.SUBSCRIPTIONS.get(key);
  if (!existing && await countSubscriptions(env) >= MAX_SUBSCRIPTIONS) return json({ error: "Subscription capacity reached" }, 503, env);
  await env.SUBSCRIPTIONS.put(key, JSON.stringify({ subscription, createdAt: new Date().toISOString() }));
  return json({ ok: true }, 201, env);
}

async function deleteSubscription(request, env) {
  if (!(await checkRateLimit(request, env, "unsubscribe", 40, 3600))) return json({ error: "Too many requests" }, 429, env);
  const body = await readJson(request);
  const endpoint = String(body.endpoint || "");
  if (!endpoint.startsWith("https://") || endpoint.length > 2048) return json({ error: "Invalid endpoint" }, 400, env);
  await env.SUBSCRIPTIONS.delete(await subscriptionKey(endpoint));
  return json({ ok: true }, 200, env);
}

function validateNotification(body) {
  const title = String(body.title || "小課表").trim().slice(0, 80);
  const message = String(body.body || "").trim().slice(0, 240);
  const tag = String(body.tag || "xiaokebiao-broadcast").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32) || "xiaokebiao-broadcast";
  if (!message) return null;
  return { title, body: message, tag, url: "./" };
}

async function listAllSubscriptionEntries(env) {
  const entries = [];
  let cursor;
  do {
    const page = await env.SUBSCRIPTIONS.list({ prefix: SUBSCRIPTION_PREFIX, cursor, limit: 1000 });
    for (const key of page.keys) {
      const value = await env.SUBSCRIPTIONS.get(key.name, "json");
      if (value?.subscription) entries.push({ key: key.name, subscription: value.subscription });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && entries.length < MAX_SUBSCRIPTIONS);
  return entries;
}

async function sendBroadcast(request, env) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, env);
  if (!(await checkRateLimit(request, env, "broadcast", 30, 3600))) return json({ error: "Too many broadcasts" }, 429, env);
  const body = await readJson(request);
  const notification = validateNotification(body);
  if (!notification) return json({ error: "Notification body is required" }, 400, env);
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const entries = await listAllSubscriptionEntries(env);
  let sent = 0;
  let failed = 0;
  let removed = 0;
  for (let offset = 0; offset < entries.length; offset += 25) {
    const batch = entries.slice(offset, offset + 25);
    const results = await Promise.allSettled(batch.map(entry => webpush.sendNotification(
      entry.subscription,
      JSON.stringify(notification),
      { TTL: 3600, urgency: "normal", topic: notification.tag },
    )));
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status === "fulfilled") {
        sent += 1;
      } else {
        failed += 1;
        const statusCode = Number(result.reason?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          await env.SUBSCRIPTIONS.delete(batch[index].key);
          removed += 1;
        }
      }
    }
  }
  return json({ ok: true, total: entries.length, sent, failed, removed }, 200, env);
}

async function adminStats(request, env) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized" }, 401, env);
  const count = await countSubscriptions(env);
  return json({ subscribers: count }, 200, env);
}

function adminPage() {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小課表推播管理</title><style>body{font-family:system-ui;background:#f3f6fb;color:#182238;margin:0;padding:24px}.card{max-width:560px;margin:auto;background:white;padding:24px;border-radius:20px;box-shadow:0 12px 40px #1232}label{display:block;font-weight:700;margin:16px 0 6px}input,textarea,button{box-sizing:border-box;width:100%;padding:13px;border-radius:12px;border:1px solid #ccd4e2;font:inherit}textarea{min-height:110px}button{margin-top:18px;background:#2865e8;color:white;border:0;font-weight:800}.note{font-size:13px;color:#647086;line-height:1.6}.result{white-space:pre-wrap;margin-top:15px}</style></head><body><main class="card"><h1>小課表推播管理</h1><p class="note">管理權杖只保存在目前瀏覽器記憶體，不會寫入網址或伺服器紀錄。請勿分享管理頁與權杖。</p><form id="form"><label>管理權杖</label><input id="token" type="password" autocomplete="current-password" required minlength="32"><label>標題</label><input id="title" value="小課表" maxlength="80"><label>通知內容</label><textarea id="body" maxlength="240" required>安扭～</textarea><button>發送給所有已訂閱裝置</button></form><div id="result" class="result"></div><script>const form=document.querySelector('#form'),result=document.querySelector('#result');form.addEventListener('submit',async event=>{event.preventDefault();result.textContent='正在發送…';try{const response=await fetch('/api/admin/broadcast',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+document.querySelector('#token').value},body:JSON.stringify({title:document.querySelector('#title').value,body:document.querySelector('#body').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'發送失敗');result.textContent='完成：共 '+data.total+' 個訂閱，成功 '+data.sent+'，失敗 '+data.failed+'，清除失效 '+data.removed;}catch(error){result.textContent='錯誤：'+error.message;}});</script></main></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (!checkOrigin(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (!checkOrigin(request, env) && url.pathname.startsWith("/api/")) return json({ error: "Origin not allowed" }, 403, env);
    try {
      if (request.method === "GET" && url.pathname === "/api/config") return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, env);
      if (request.method === "POST" && url.pathname === "/api/subscriptions") return saveSubscription(request, env);
      if (request.method === "DELETE" && url.pathname === "/api/subscriptions") return deleteSubscription(request, env);
      if (request.method === "GET" && url.pathname === "/api/admin/stats") return adminStats(request, env);
      if (request.method === "POST" && url.pathname === "/api/admin/broadcast") return sendBroadcast(request, env);
      if (request.method === "GET" && url.pathname === "/admin") return new Response(adminPage(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" } });
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true }, 200, env);
      return json({ error: "Not found" }, 404, env);
    } catch (error) {
      if (error instanceof Response) return new Response(error.body, { status: error.status, headers: { ...JSON_HEADERS, ...corsHeaders(env) } });
      console.error("push worker error", error);
      return json({ error: "Internal server error" }, 500, env);
    }
  },
};

export const testing = { constantTimeEqual, validateSubscription, validateNotification, countSubscriptions };
