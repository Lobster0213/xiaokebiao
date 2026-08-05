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

test("legacy data migrates idempotently to v0.8 without changing the storage key model", () => {
  const first = domain.normalizeData(legacyData(), { now: "2026-07-31T00:00:00.000Z" });
  assert.equal(first.dataVersion, 8);
  assert.equal(first.version, "0.8.0");
  assert.equal(first.lessons[0].lessonType, "formal");
  assert.equal(first.lessons[0].deletedAt, null);
  assert.deepEqual(first.students[0].subjects, ["數學"]);
  assert.equal(first.students[0].defaultSubject, "數學");
  assert.equal(first.lessons[0].autoCompletedAt, null);
  assert.equal(first.settings.hasCompletedOnboarding, true);
  assert.equal(first.settings.onboardingCurrentStep, 1);
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

test("orphaned imported credit transactions are rejected", () => {
  const payload = legacyData();
  payload.lessonCreditTransactions = [{
    id: "credit_orphan",
    studentId: "student_1",
    type: "deduction",
    amount: -1,
    relatedLessonId: "lesson_missing",
  }];
  assert.throws(() => domain.normalizeData(payload), /參照的課程不存在/);
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

test("trial lesson records never deduct formal credits by default", () => {
  const source = legacyData();
  source.lessons.push({
    id: "trial_1",
    studentId: "",
    subject: "英文試教",
    lessonType: "trial",
    trial: { name: "新同學", result: "pending" },
    date: "2026-08-07",
    startTime: "19:00",
    endTime: "20:00",
    status: "scheduled",
  });
  const data = domain.normalizeData(source);
  let sequence = 0;
  domain.completeLessonTransaction(data, {
    lessonId: "trial_1",
    status: "completed",
    deductLesson: true,
    idFactory: prefix => `${prefix}_trial_${++sequence}`,
  });
  assert.equal(data.lessonRecords.find(item => item.lessonId === "trial_1").deductLesson, false);
  assert.equal(domain.creditBalance(data, "student_1"), 6);
  assert.doesNotThrow(() => domain.normalizeData(data));
});

test("clearing demo data preserves independently created data", () => {
  const source = legacyData();
  source.students[0].isDemoData = true;
  source.lessons[0].isDemoData = true;
  source.students.push({
    id: "student_user",
    name: "自建學生",
    subject: "英文",
    billingType: "perLesson",
  });
  source.lessons.push({
    id: "lesson_user",
    studentId: "student_user",
    subject: "英文",
    date: "2026-08-09",
    startTime: "10:00",
    endTime: "11:00",
    status: "scheduled",
    isDemoData: false,
  });
  const data = domain.normalizeData(source);
  domain.removeDemoData(data);
  assert.deepEqual(data.students.map(item => item.id), ["student_user"]);
  assert.deepEqual(data.lessons.map(item => item.id), ["lesson_user"]);
});

test("CSV formula starters are exported as text", () => {
  assert.equal(domain.sanitizeCsvCell("=1+1"), "\"\t=1+1\"");
  assert.equal(domain.sanitizeCsvCell("一般文字"), "\"一般文字\"");
});

test("duration normalization accepts presets and valid custom values", () => {
  assert.equal(domain.normalizeDuration(180), 180);
  assert.equal(domain.normalizeDuration(75), 75);
  assert.equal(domain.normalizeDuration(14), 60);
  assert.equal(domain.normalizeDuration(361), 60);
});

test("multi-subject migration trims, de-duplicates and preserves the default", () => {
  const source = legacyData();
  source.students[0].subjects = [" 英文 ", "數學", "英文"];
  source.students[0].defaultSubject = "英文";
  const data = domain.normalizeData(source);
  assert.deepEqual(data.students[0].subjects, ["數學", "英文"]);
  assert.equal(data.students[0].defaultSubject, "英文");
  assert.equal(data.lessons[0].subject, "數學");
});

test("scheduled formal lesson auto-completes and deducts exactly once", () => {
  const data = domain.normalizeData(legacyData());
  let sequence = 0;
  const options = { now: "2026-08-07T00:00:00.000Z", idFactory: prefix => `${prefix}_auto_${++sequence}` };
  const first = domain.autoCompleteOverdueLessons(data, options);
  const second = domain.autoCompleteOverdueLessons(data, options);
  assert.equal(first.completedCount, 1);
  assert.equal(second.completedCount, 0);
  assert.equal(data.lessons[0].status, "completed");
  assert.equal(data.lessons[0].completionSource, "system");
  assert.equal(data.lessonRecords[0].autoCompleted, true);
  assert.equal(domain.creditBalance(data, "student_1"), 5);
  assert.equal(data.lessonCreditTransactions.filter(item => item.type === "deduction").length, 1);
});

test("zero-balance package lesson auto-completes without deduction or retroactive charge", () => {
  const source = legacyData();
  source.students[0].totalLessons = 4;
  source.students[0].usedLessons = 4;
  const data = domain.normalizeData(source);
  let sequence = 0;
  const result = domain.autoCompleteOverdueLessons(data, {
    now: "2026-08-07T00:00:00.000Z",
    idFactory: prefix => `${prefix}_zero_${++sequence}`,
  });
  assert.equal(result.completedCount, 1);
  assert.deepEqual(result.attentionStudentIds, ["student_1"]);
  assert.equal(data.lessonRecords[0].deductLesson, false);
  domain.addCreditTransaction(data, { id: "credit_later", studentId: "student_1", type: "purchase", amount: 4 });
  domain.autoCompleteOverdueLessons(data, { now: "2026-08-08T00:00:00.000Z", idFactory: prefix => `${prefix}_later_${++sequence}` });
  assert.equal(domain.creditBalance(data, "student_1"), 4);
  assert.equal(data.lessonCreditTransactions.filter(item => item.type === "deduction").length, 0);
});

test("in-progress, per-lesson and trial lessons auto-complete without invalid deductions", () => {
  const source = legacyData();
  source.lessons[0].status = "inProgress";
  source.students.push({ id: "student_per", name: "按次生", subject: "英文", billingType: "perLesson" });
  source.lessons.push({ id: "lesson_per", studentId: "student_per", subject: "英文", date: "2026-08-06", startTime: "18:00", endTime: "19:00", status: "scheduled" });
  source.lessons.push({ id: "lesson_trial_auto", studentId: "", subject: "試教", lessonType: "trial", trial: { name: "新生", result: "pending" }, date: "2026-08-06", startTime: "19:00", endTime: "20:00", status: "scheduled" });
  const data = domain.normalizeData(source);
  let sequence = 0;
  const result = domain.autoCompleteOverdueLessons(data, { now: "2026-08-07T00:00:00.000Z", idFactory: prefix => `${prefix}_mixed_${++sequence}` });
  assert.equal(result.completedCount, 3);
  assert.equal(data.lessonRecords.find(item => item.lessonId === "lesson_per").deductLesson, false);
  assert.equal(data.lessonRecords.find(item => item.lessonId === "lesson_trial_auto").deductLesson, false);
  assert.equal(data.lessons.find(item => item.id === "lesson_trial_auto").trial.result, "pending");
});

test("teacher correction reverses an automatic deduction with traceable ledger entries", () => {
  const data = domain.normalizeData(legacyData());
  let sequence = 0;
  const idFactory = prefix => `${prefix}_correct_${++sequence}`;
  domain.autoCompleteOverdueLessons(data, { now: "2026-08-07T00:00:00.000Z", idFactory });
  domain.completeLessonTransaction(data, { lessonId: "lesson_1", status: "teacherLeave", deductLesson: false, completionSource: "teacher", idFactory, now: "2026-08-07T01:00:00.000Z" });
  assert.equal(domain.creditBalance(data, "student_1"), 6);
  assert.equal(data.lessons[0].autoCompletedAt, null);
  assert.equal(data.lessonRecords[0].autoCompleted, false);
  assert.equal(data.lessonCreditTransactions.filter(item => item.relatedLessonId === "lesson_1").length, 2);
});

test("rescheduling an auto-completed lesson restores credit and records history", () => {
  const data = domain.normalizeData(legacyData());
  let sequence = 0;
  const idFactory = prefix => `${prefix}_move_${++sequence}`;
  domain.autoCompleteOverdueLessons(data, { now: "2026-08-07T00:00:00.000Z", idFactory });
  domain.rescheduleLessonTransaction(data, {
    lessonId: "lesson_1", date: "2026-08-13", startTime: "20:00", endTime: "21:30", scope: "only", idFactory, now: "2026-08-07T02:00:00.000Z",
  });
  assert.equal(data.lessons[0].status, "scheduled");
  assert.equal(data.lessons[0].date, "2026-08-13");
  assert.equal(data.lessons[0].rescheduleHistory.length, 1);
  assert.equal(domain.creditBalance(data, "student_1"), 6);
});
