const test = require("node:test");
const assert = require("node:assert/strict");
const domain = require("../app-domain.js");

function legacyData() {
  return {
    version: "0.6.0",
    teacherProfile: { name: "林老師", subjects: [] },
    students: [{
      id: "student_1",
      name: "測試學生",
      subject: "數學",
      billingType: "package",
      totalLessons: 10,
      usedLessons: 4,
      pricePerLesson: 800,
      defaultDuration: 60,
    }],
    lessons: [{
      id: "lesson_1",
      studentId: "student_1",
      subject: "數學",
      date: "2026-08-06",
      startTime: "20:00",
      endTime: "21:00",
      mode: "inPerson",
      status: "scheduled",
    }],
    lessonRecords: [],
  };
}

test("v0.6 data migrates idempotently without changing the storage model", () => {
  const first = domain.normalizeData(legacyData(), { now: "2026-07-31T00:00:00.000Z" });
  assert.equal(first.dataVersion, 7);
  assert.equal(first.version, "0.7.0");
  assert.equal(first.lessons[0].lessonType, "formal");
  assert.equal(first.lessons[0].deletedAt, null);
  assert.equal(first.settings.hasCompletedOnboarding, true);
  assert.equal(domain.creditBalance(first, "student_1"), 6);

  const second = domain.normalizeData(first, { now: "2026-08-01T00:00:00.000Z" });
  assert.equal(second.lessonCreditTransactions.length, first.lessonCreditTransactions.length);
  assert.equal(domain.creditBalance(second, "student_1"), 6);
});

test("unsafe imported identifiers are rejected before reaching innerHTML", () => {
  const payload = legacyData();
  payload.students[0].id = "\"><svg onload=alert(1)>";
  assert.throws(() => domain.normalizeData(payload), /ID 格式不安全/);
});

test("eight weekly lessons cross August into September", () => {
  const plan = domain.planRecurrence({
    startDate: "2026-08-06",
    weekdays: [4],
    targetCount: 8,
    baseLesson: { startTime: "20:00", endTime: "21:00" },
  }, []);
  assert.deepEqual(plan.accepted.map(item => item.date), [
    "2026-08-06", "2026-08-13", "2026-08-20", "2026-08-27",
    "2026-09-03", "2026-09-10", "2026-09-17", "2026-09-24",
  ]);
});

test("weekly lessons cross December into the next year", () => {
  const plan = domain.planRecurrence({
    startDate: "2026-12-17",
    weekdays: [4],
    targetCount: 4,
    baseLesson: { startTime: "20:00", endTime: "21:00" },
  }, []);
  assert.deepEqual(plan.accepted.map(item => item.date), [
    "2026-12-17", "2026-12-24", "2026-12-31", "2027-01-07",
  ]);
});

test("touching time boundaries do not conflict and overlapping ranges do", () => {
  const candidate = { date: "2026-09-10", startTime: "20:00", endTime: "21:00" };
  assert.equal(domain.findConflicts(candidate, [{
    id: "before",
    date: "2026-09-10",
    startTime: "19:00",
    endTime: "20:00",
    status: "scheduled",
  }]).length, 0);
  assert.equal(domain.findConflicts(candidate, [{
    id: "overlap",
    date: "2026-09-10",
    startTime: "20:30",
    endTime: "21:30",
    status: "scheduled",
  }]).length, 1);
  assert.equal(domain.findConflicts(candidate, [{
    id: "cancelled",
    date: "2026-09-10",
    startTime: "20:30",
    endTime: "21:30",
    status: "cancelled",
  }]).length, 0);
});

test("conflicted week is skipped and supplemented on the same weekday", () => {
  const plan = domain.planRecurrence({
    startDate: "2026-08-06",
    weekdays: [4],
    targetCount: 3,
    baseLesson: { startTime: "20:00", endTime: "21:00" },
  }, [{
    id: "existing",
    date: "2026-08-13",
    startTime: "20:30",
    endTime: "21:30",
    status: "scheduled",
  }], { autoSupplement: true, maxWeeks: 104 });
  assert.deepEqual(plan.accepted.map(item => item.date), ["2026-08-06", "2026-08-20", "2026-08-27"]);
  assert.equal(plan.skipped[0].candidate.date, "2026-08-13");
  assert.equal(plan.supplemented[0].date, "2026-08-27");
});

test("lesson deduction transaction is idempotent", () => {
  const data = domain.normalizeData(legacyData());
  const transaction = {
    id: "credit_lesson_1",
    studentId: "student_1",
    type: "deduction",
    amount: -1,
    reason: "完成課程",
    relatedLessonId: "lesson_1",
  };
  assert.equal(domain.addCreditTransaction(data, transaction).created, true);
  assert.equal(domain.addCreditTransaction(data, { ...transaction, id: "credit_duplicate" }).created, false);
});

test("completing and editing a lesson never deducts twice", () => {
  const data = domain.normalizeData(legacyData());
  let sequence = 0;
  const input = {
    lessonId: "lesson_1",
    status: "completed",
    deductLesson: true,
    note: "",
    idFactory: prefix => `${prefix}_${++sequence}`,
    now: "2026-08-06T13:00:00.000Z",
  };
  domain.completeLessonTransaction(data, input);
  domain.completeLessonTransaction(data, input);
  assert.equal(domain.creditBalance(data, "student_1"), 5);
  assert.equal(data.lessonCreditTransactions.filter(item => item.type === "deduction").length, 1);
});

test("deleting a deducted lesson can restore credit and undo safely", () => {
  const data = domain.normalizeData(legacyData());
  let sequence = 0;
  const idFactory = prefix => `${prefix}_${++sequence}`;
  domain.completeLessonTransaction(data, {
    lessonId: "lesson_1",
    status: "completed",
    deductLesson: true,
    idFactory,
  });
  assert.equal(domain.creditBalance(data, "student_1"), 5);
  domain.deleteLessonTransaction(data, { lessonId: "lesson_1", restoreCredit: true, idFactory });
  assert.equal(domain.creditBalance(data, "student_1"), 6);
  assert.ok(data.lessons[0].deletedAt);
  domain.restoreLessonTransaction(data, { lessonId: "lesson_1" });
  assert.equal(domain.creditBalance(data, "student_1"), 5);
  assert.equal(data.lessons[0].deletedAt, null);
});

test("CSV formula starters are exported as text", () => {
  assert.equal(domain.sanitizeCsvCell("=1+1"), "\"\t=1+1\"");
  assert.equal(domain.sanitizeCsvCell("一般文字"), "\"一般文字\"");
});
