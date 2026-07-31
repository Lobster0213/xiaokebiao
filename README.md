# 小課表｜Codex 第一個任務

這個資料夾已包含可直接操作的 `index.html`，Codex 不需要知道任何前文。

## 檔案

- `index.html`：目前可運作的老師排課／堂數紀錄 MVP，也是首頁與既有功能的唯一基準。
- `homepage-reference.png`：首頁視覺參考。首頁不要重新設計。
- `calendar-reference.png`：新增週視圖與月視圖的視覺方向。
- `CODEX_FIRST_TASK.md`：請交給 Codex 的完整任務說明。

## 使用方式

1. 用 Codex 開啟整個資料夾。
2. 將 `CODEX_FIRST_TASK.md` 的內容貼給 Codex，或直接要求它完整閱讀該檔案後執行。
3. 完成後直接用 Chrome 或 Edge 開啟 `index.html` 驗收。

此任務不需要 npm、Node.js 或額外安裝套件。

## 手機安裝與 GitHub Pages

專案已支援 PWA，可從 GitHub Pages 的 HTTPS 網址安裝到手機，也可在第一次載入後離線開啟。

- iPhone／iPad：用 Safari 開啟網址，點「分享」→「加入主畫面」。
- Android：用 Chrome 開啟網址，點右上角選單→「安裝應用程式」或「加到主畫面」。
- 手機內原有資料不會自動和電腦同步。換網址或裝置前，請先到「更多」下載 JSON 備份，再在新裝置匯入。

每次推送到 `main` 分支時，`.github/workflows/deploy-pages.yml` 會自動部署 `index.html`、manifest、Service Worker 與 App 圖示。第一次建立儲存庫後，請在 GitHub 的 `Settings → Pages → Build and deployment` 選擇 `GitHub Actions`。

若只在電腦本機預覽，直接開啟 `index.html` 仍可使用既有功能；安裝與離線快取必須透過 HTTPS 或 localhost 測試。
