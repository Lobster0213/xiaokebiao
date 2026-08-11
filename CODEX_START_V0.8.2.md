請完整閱讀目前 `Lobster0213/xiaokebiao` 專案與 `CODEX_UPDATE_V0.8.2.md`。

這次是既有產品的 v0.8.2 UX 更新。不要重新初始化專案、重做首頁、改 applicationId、清除現有資料或破壞 Android 更新與 GitHub Pages。

最高優先順序：
1. 固定課程系列整批刪除／編輯／復原
2. 固定系列暫停與增加堂數
3. 老師／學生扣堂規則
4. 最近自動完成課程的快速修正
5. 備份安全
6. 已購堂數與未來已排堂數區分
7. 週視圖可讀性

課程結束後仍維持目前決策：自動完成並依規則自動扣堂一次，不加入「待確認」。

請先建立 `feature/v0.8.2-series-and-record-management` 分支與修改前 commit，確認現有 dataVersion、recurrenceGroupId、LessonCreditTransaction、自動完成邏輯與備份格式，再依規格分階段完成。

請直接修改、測試、建置並分階段 commit，不要只回覆建議。
