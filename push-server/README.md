# 小課表 Web Push Server

Cloudflare Worker + Workers KV。只保存瀏覽器 `PushSubscription`（endpoint、p256dh、auth），不接收或保存學生、課程、電話、堂數與備份資料。

## Production secrets

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `ADMIN_TOKEN`（至少 32 字元，建議 32 bytes 隨機 base64url）

`VAPID_SUBJECT` 與允許來源在 `wrangler.jsonc`。敏感值不得放入 Git。

## Deploy

1. `npm install`
2. `npx web-push generate-vapid-keys --json`
3. `npx wrangler login`
4. 使用 `npx wrangler secret put ...` 設三個 secrets
5. `npm run deploy`
6. 將 Worker URL 寫入網站根目錄的 `push-config.js`

遠端發送管理頁：`https://<worker>.workers.dev/admin`
