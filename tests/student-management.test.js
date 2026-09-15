const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const domainSource = fs.readFileSync(path.join(root, "app-domain.js"), "utf8");

test("student editor validates and updates the existing student identity", () => {
  assert.match(html, /id="student-name"[^>]*maxlength="30"/);
  assert.match(html, /Domain\.normalizeStudentName\(rawName\)/);
  assert.match(html, /Domain\.renameStudent\(state, \{ studentId: student\.id, name, now \}\)/);
  assert.match(html, /toast\(editing \? "學生資料已更新"/);
  assert.doesNotMatch(html, /lesson\.studentName/);
  assert.match(html, /return studentById\(lesson\.studentId\)/);
  assert.doesNotMatch(html, /全部科目：/);
  assert.doesNotMatch(html, /；預設：/);
});

test("archived and deleted students are excluded from active selectors", () => {
  assert.match(html, /function activeStudents\(\) \{ return state\.students\.filter\(student => !student\.archivedAt && !student\.deletedAt\); \}/);
  assert.match(html, /activeStudents\(\)\.filter\(s => !term/);
  assert.match(html, /activeStudents\(\)\.map\(student => `<option/);
  assert.match(html, /const activeStudentList = activeStudents\(\)/);
  assert.match(html, /查看封存學生/);
  assert.match(html, /查看歷史課程/);
  assert.match(html, /恢復學生/);
  assert.match(html, /data-action="archive-student-from-edit"/);
  assert.match(html, /將\$\{escapeHtml\(student\.name\)\}移至封存資料庫/);
  assert.match(html, /剩餘堂數是否已退費？/);
  assert.match(html, /未退費，保留 \$\{remaining\} 堂/);
  assert.match(html, /已退費，扣除 \$\{remaining\} 堂/);
  assert.match(html, /未來課程：\$\{summary\.futureLessonCount\} 堂（將從日曆移除）/);
  assert.match(html, /學生已封存，\$\{result\.removedLessonCount\} 堂未來課程已移除/);
  assert.match(html, /handler: \(\) => undoStudentArchive\(result\.operation\.id, studentId\)/);
  assert.match(domainSource, /reason: "studentArchived"/);
  assert.match(domainSource, /type: "refund"/);
  assert.match(domainSource, /amount: -refundableCredits/);
  assert.match(domainSource, /reason: "封存學生退費"/);
  assert.match(domainSource, /if \(refund\) refund\.reversedAt = now/);
});

test("student deletion stays soft, reports impact and offers an eight-second exact undo", () => {
  for (const required of [
    "更多操作",
    "刪除學生",
    "未來課程：",
    "已完成課程：",
    "堂數異動紀錄：",
    "封存學生（建議）",
    "刪除學生並移除未來課程",
    "學生已刪除",
    "堂未來課程已刪除",
  ]) assert.ok(html.includes(required), `缺少介面文字：${required}`);
  assert.match(html, /Domain\.softDeleteStudent\(state/);
  assert.match(html, /duration: 8000/);
  assert.match(html, /handler: \(\) => undoStudentDeletion\(result\.operation\.id, studentId\)/);
  assert.match(domainSource, /student\.deletedAt = now/);
  assert.match(domainSource, /lesson\.studentId === studentId/);
  assert.match(domainSource, /lesson\.deletion\?\.batchOperationId !== operation\.id/);
});

test("student archive and delete fields are included in the idempotent normalizer and JSON backup", () => {
  assert.match(domainSource, /archivedAt: student\.archivedAt \? text\(student\.archivedAt, 50\) : null/);
  assert.match(domainSource, /deletedAt: student\.deletedAt \? text\(student\.deletedAt, 50\) : null/);
  assert.match(html, /students: state\.students/);
  assert.match(html, /const normalized = normalizeStoredData\(parsed/);
});
