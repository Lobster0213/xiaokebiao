# 小課表 v0.7

小課表是給個人老師使用的行動優先課表與堂數紀錄工具。既有首頁與單檔 Web App 架構保留，v0.7 另外加入可選的 Android 原生包裝層。

## 目前架構

- Web／PWA：`index.html`、`app-domain.js`、`manifest.webmanifest`、`service-worker.js`
- Android：`android/` 內的原生 WebView 包裝層，最低 Android 8（API 26）
- 資料：保留原本 `localStorage` key `xiaokebiao_mvp_v1`
- 集中資料版本：`dataVersion: 7`
- 部署：推送 `main` 後由 GitHub Actions 更新 GitHub Pages
- Android Release：推送 `v*` tag 後建置簽章 APK，並上傳至正式 GitHub Release

Web 版不需要 npm 才能使用；直接開啟 `index.html` 即可。本機檔案模式不支援 Service Worker，PWA 安裝與離線快取需使用 GitHub Pages HTTPS 網址。

## v0.7 功能

- 週視圖固定星期一開始並顯示完整七天；月視圖保留 42 格月曆
- 固定排課依真實日期跨月／跨年，每批保留 `recurrenceGroupId` 並可整批復原
- 衝堂依時間區間判斷；相接時間不算衝突，取消課程可忽略，最多往後補 104 週
- 堂數以 `LessonCreditTransaction` 帳本管理，可新增 1、2、4、8、12、16、20 或自訂 1～999 堂
- 今日最後一堂提醒
- 試教課程與轉正式學生流程
- 課程軟刪除、扣堂加回選擇與 8 秒復原
- 四步首次教學、示範資料標記與只清除示範資料
- 需輸入「確認清除」才可執行的全資料清除
- 舊資料自動遷移、遷移前快照、完整 JSON 匯出／匯入及 CSV 公式注入防護

## 本機驗證

需要 Node.js 18 以上：

```bash
npm test
npm run lint
npm run test:android:static
```

`scripts/browser-smoke.mjs` 可搭配開啟 DevTools Protocol 的 Chrome 執行 390 × 844 互動驗收。它會檢查：

- 首次教學
- 七天週視圖與星期一起始
- 42 格月視圖
- 試教表單切換
- 全資料清除的文字確認保護
- 瀏覽器 runtime exception

## Android 本機建置

正式 Android 身分已由專案擁有者確認並固定為：

```text
io.github.lobster0213.xiaokebiao
```

建置時若提供 `XIAOKEBIAO_APPLICATION_ID`，必須與此永久身分完全一致。Release keystore 與密碼只放本機環境變數或 GitHub Secrets，絕不可 commit。

Debug 驗證範例：

```bash
gradle -p android :app:assembleDebug \
  -PXIAOKEBIAO_APPLICATION_ID=io.github.lobster0213.xiaokebiao
```

Release 建置另需環境變數：

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

輸出位置：

- Debug：`android/app/build/outputs/apk/debug/app-debug.apk`
- Release：`android/app/build/outputs/apk/release/app-release.apk`

## GitHub Release 設定

在 repository 的 `Settings → Secrets and variables → Actions` 設定：

Repository variable：

- `ANDROID_APPLICATION_ID`

Repository secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

`ANDROID_KEYSTORE_BASE64` 是 release keystore 的 Base64 內容。請另外離線備份原始 keystore 與密碼；遺失後將無法用相同簽章覆蓋更新既有 App。

建立並推送版本 tag：

```bash
git tag v0.7.0
git push origin v0.7.0
```

工作流程會產生：

```text
xiaokebiao-v0.7.0-release.apk
xiaokebiao-v0.7.0-release.apk.sha256
```

並建立非 draft、非 prerelease 的正式 GitHub Release。App 只接受名稱含 `release` 的 `.apk`，會排除 debug、unsigned、test、source 與 AAB。

## Android App 內更新

Android App 啟動或使用者在「更多 → Android App 更新」按下檢查時，會讀取：

```text
https://api.github.com/repos/Lobster0213/xiaokebiao/releases/latest
```

更新流程使用 Android `DownloadManager` 在 App 內下載，不會打開瀏覽器。下載完成後會先驗證：

- APK package name 與目前 App 相同
- APK `versionCode` 高於目前版本
- APK 簽章 SHA-256 與目前 App 相同

驗證通過才透過 `FileProvider` 開啟 Android 系統安裝畫面。Android 8 以上若尚未允許安裝未知應用程式，App 會先說明並開啟此 App 專屬設定頁；返回後可使用已下載 APK 繼續安裝。App 不做靜默安裝，也不繞過系統確認。

## 資料與隱私

- 沒有後端、分析 SDK 或第三方資料上傳。
- 課表資料儲存在目前瀏覽器／Android WebView 的本機儲存空間。
- 換裝置、清除瀏覽器資料或更換網址前，請先到「更多」下載完整 JSON 備份。
- 匯入檔限制為 5 MB，並會驗證 ID、日期、時間、關聯與筆數上限。
- Android 覆蓋安裝會沿用相同 package 與簽章，因此不需要刪除 App，原本資料也會保留。

## 首次 GitHub Pages 設定

在 GitHub repository 的 `Settings → Pages → Build and deployment` 選擇 `GitHub Actions`。之後每次推送 `main`，`.github/workflows/deploy-pages.yml` 都會部署 Web App、domain module、manifest、Service Worker 與圖示。
