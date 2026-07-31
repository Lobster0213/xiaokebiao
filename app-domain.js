(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XiaoKeBiaoDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DATA_VERSION = 7;
  const ONBOARDING_VERSION = 1;
  const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
  const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
  const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const CREDIT_TYPES = new Set(["purchase", "gift", "manualAdjustment", "deduction", "restoration", "refund"]);
  const LESSON_STATUSES = new Set(["scheduled", "inProgress", "completed", "studentLeave", "teacherLeave", "absent", "cancelled", "rescheduled"]);
  const TRIAL_RESULTS = new Set(["pending", "converted", "notContinuing", "followUp"]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value, maxLength = 2000) {
    return String(value == null ? "" : value).slice(0, maxLength);
  }

  function numberOr(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function isRealISODate(value) {
    if (!ISO_DATE.test(String(value || ""))) return false;
    const [year, month, day] = String(value).split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function assertSafeId(value, label) {
    if (!SAFE_ID.test(String(value || ""))) throw new Error(`${label} ID 格式不安全`);
    return String(value);
  }

  function assertArray(value, label, limit) {
    if (!Array.isArray(value)) throw new Error(`${label} 必須是陣列`);
    if (value.length > limit) throw new Error(`${label} 筆數超過上限 ${limit}`);
    return value;
  }

  function parseISODate(iso) {
    if (!isRealISODate(iso)) throw new Error(`日期格式錯誤：${iso}`);
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function dateToISO(date) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function addDaysISO(iso, amount) {
    const date = parseISODate(iso);
    date.setDate(date.getDate() + Number(amount || 0));
    return dateToISO(date);
  }

  function weekdayNumber(iso) {
    const day = parseISODate(iso).getDay();
    return day === 0 ? 7 : day;
  }

  function timeToMinutes(value) {
    if (!CLOCK_TIME.test(String(value || ""))) throw new Error(`時間格式錯誤：${value}`);
    const [hour, minute] = String(value).split(":").map(Number);
    return hour * 60 + minute;
  }

  function intervalsOverlap(first, second) {
    return timeToMinutes(first.startTime) < timeToMinutes(second.endTime)
      && timeToMinutes(first.endTime) > timeToMinutes(second.startTime);
  }

  function findConflicts(candidate, lessons, ignoreLessonId = null) {
    return lessons.filter(existing => {
      if (!existing || existing.deletedAt || existing.id === ignoreLessonId || existing.date !== candidate.date) return false;
      if (existing.status === "cancelled" || existing.status === "rescheduled") return false;
      return intervalsOverlap(candidate, existing);
    });
  }

  function planRecurrence(input, existingLessons, options = {}) {
    const targetCount = Math.min(999, Math.max(0, Math.trunc(numberOr(input.targetCount))));
    const weekdays = [...new Set((input.weekdays || []).map(Number).filter(day => day >= 1 && day <= 7))].sort();
    const autoSupplement = options.autoSupplement !== false;
    const maxWeeks = Math.min(104, Math.max(1, Math.trunc(numberOr(options.maxWeeks, 104))));
    const accepted = [];
    const originalDates = [];
    const supplemented = [];
    const skipped = [];
    if (!isRealISODate(input.startDate) || !weekdays.length || !targetCount) {
      return { targetCount, originalDates, accepted, supplemented, skipped, limitReached: false, lastDate: null };
    }

    let cursor = input.startDate;
    const horizon = addDaysISO(input.startDate, maxWeeks * 7);
    while (cursor <= horizon) {
      if (weekdays.includes(weekdayNumber(cursor))) {
        const candidate = { ...input.baseLesson, date: cursor };
        const isOriginal = originalDates.length < targetCount;
        if (isOriginal) originalDates.push(candidate);
        const conflicts = findConflicts(candidate, existingLessons, input.ignoreLessonId || null);
        if (!conflicts.length) {
          if (isOriginal || (autoSupplement && accepted.length < targetCount)) {
            accepted.push(candidate);
            if (!isOriginal) supplemented.push(candidate);
          }
        } else if (isOriginal || (autoSupplement && accepted.length < targetCount)) {
          skipped.push({ candidate, conflicts, isOriginal });
        }
        if (!autoSupplement && originalDates.length >= targetCount) break;
        if (autoSupplement && originalDates.length >= targetCount && accepted.length >= targetCount) break;
      }
      cursor = addDaysISO(cursor, 1);
    }

    const finalAccepted = (autoSupplement ? accepted.slice(0, targetCount) : accepted);
    return {
      targetCount,
      originalDates,
      accepted: finalAccepted,
      supplemented: supplemented.filter(item => finalAccepted.includes(item)),
      skipped,
      limitReached: autoSupplement && finalAccepted.length < targetCount,
      lastDate: finalAccepted.length ? finalAccepted[finalAccepted.length - 1].date : null,
    };
  }

  function defaultSettings(existingUser) {
    return {
      hasCompletedOnboarding: Boolean(existingUser),
      onboardingVersion: existingUser ? ONBOARDING_VERSION : 0,
      update: {
        autoCheck: true,
        wifiOnly: true,
        lastCheckedAt: "",
        downloadedVersion: "",
        downloadedApkPath: "",
      },
    };
  }

  function normalizeData(input, options = {}) {
    if (!input || typeof input !== "object") throw new Error("資料根節點格式錯誤");
    const data = clone(input);
    const now = options.now || new Date().toISOString();
    const existingUser = options.existingUser !== false;
    const studentsInput = assertArray(data.students, "學生", 5000);
    const lessonsInput = assertArray(data.lessons, "課程", 50000);
    const recordsInput = assertArray(data.lessonRecords || [], "上課紀錄", 50000);
    const transactionsInput = assertArray(data.lessonCreditTransactions || [], "堂數異動", 100000);
    const seen = new Set();

    const students = studentsInput.map((student, index) => {
      if (!student || typeof student !== "object") throw new Error(`第 ${index + 1} 位學生格式錯誤`);
      const id = assertSafeId(student.id, `第 ${index + 1} 位學生`);
      if (seen.has(`student:${id}`)) throw new Error(`學生 ID 重複：${id}`);
      seen.add(`student:${id}`);
      const billingType = student.billingType === "perLesson" ? "perLesson" : "package";
      return {
        ...student,
        id,
        name: text(student.name, 100).trim(),
        subject: text(student.subject, 100).trim(),
        phone: text(student.phone, 100).trim(),
        contactNote: text(student.contactNote, 500).trim(),
        billingType,
        totalLessons: billingType === "perLesson" ? null : Math.max(0, Math.trunc(numberOr(student.totalLessons))),
        usedLessons: Math.max(0, Math.trunc(numberOr(student.usedLessons))),
        pricePerLesson: Math.max(0, numberOr(student.pricePerLesson)),
        defaultDuration: [30, 45, 60, 90, 120].includes(Number(student.defaultDuration)) ? Number(student.defaultDuration) : 60,
        notes: text(student.notes, 2000),
        isDemoData: Boolean(student.isDemoData),
        createdAt: text(student.createdAt || now, 50),
        updatedAt: text(student.updatedAt || now, 50),
      };
    });
    const studentIds = new Set(students.map(student => student.id));

    const lessons = lessonsInput.map((lesson, index) => {
      if (!lesson || typeof lesson !== "object") throw new Error(`第 ${index + 1} 堂課格式錯誤`);
      const id = assertSafeId(lesson.id, `第 ${index + 1} 堂課`);
      if (seen.has(`lesson:${id}`)) throw new Error(`課程 ID 重複：${id}`);
      seen.add(`lesson:${id}`);
      const lessonType = lesson.lessonType === "trial" ? "trial" : "formal";
      const studentId = lesson.studentId ? assertSafeId(lesson.studentId, `課程 ${id} 的學生`) : "";
      if (lessonType === "formal" && !studentIds.has(studentId)) throw new Error(`課程 ${id} 找不到學生`);
      if (!isRealISODate(lesson.date)) throw new Error(`課程 ${id} 日期格式錯誤`);
      if (!CLOCK_TIME.test(String(lesson.startTime || "")) || !CLOCK_TIME.test(String(lesson.endTime || ""))) {
        throw new Error(`課程 ${id} 時間格式錯誤`);
      }
      if (timeToMinutes(lesson.startTime) >= timeToMinutes(lesson.endTime)) throw new Error(`課程 ${id} 結束時間必須較晚`);
      const recurrenceGroupId = lesson.recurrenceGroupId ? assertSafeId(lesson.recurrenceGroupId, `課程 ${id} 的排課批次`) : null;
      return {
        ...lesson,
        id,
        studentId,
        subject: text(lesson.subject, 100),
        date: lesson.date,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        mode: lesson.mode === "online" ? "online" : "inPerson",
        location: text(lesson.location, 500),
        notes: text(lesson.notes, 2000),
        status: LESSON_STATUSES.has(lesson.status) ? lesson.status : "scheduled",
        recurrenceGroupId,
        lessonType,
        trial: {
          name: text(lesson.trial?.name, 100),
          fee: Math.max(0, numberOr(lesson.trial?.fee)),
          source: text(lesson.trial?.source, 200),
          contact: text(lesson.trial?.contact, 300),
          result: TRIAL_RESULTS.has(lesson.trial?.result) ? lesson.trial.result : "pending",
          convertedStudentId: lesson.trial?.convertedStudentId && SAFE_ID.test(lesson.trial.convertedStudentId)
            ? lesson.trial.convertedStudentId
            : null,
        },
        deletedAt: lesson.deletedAt ? text(lesson.deletedAt, 50) : null,
        isDemoData: Boolean(lesson.isDemoData),
        startedAt: lesson.startedAt ? text(lesson.startedAt, 50) : null,
        recordId: lesson.recordId && SAFE_ID.test(String(lesson.recordId)) ? String(lesson.recordId) : null,
        createdAt: text(lesson.createdAt || now, 50),
        updatedAt: text(lesson.updatedAt || now, 50),
      };
    });
    const lessonIds = new Set(lessons.map(lesson => lesson.id));

    const lessonRecords = recordsInput.map((record, index) => {
      if (!record || typeof record !== "object") throw new Error(`第 ${index + 1} 筆課程紀錄格式錯誤`);
      const id = assertSafeId(record.id, `第 ${index + 1} 筆課程紀錄`);
      if (seen.has(`record:${id}`)) throw new Error(`課程紀錄 ID 重複：${id}`);
      seen.add(`record:${id}`);
      const lessonId = assertSafeId(record.lessonId, `課程紀錄 ${id} 的課程`);
      const studentId = assertSafeId(record.studentId, `課程紀錄 ${id} 的學生`);
      if (!lessonIds.has(lessonId) || !studentIds.has(studentId)) throw new Error(`課程紀錄 ${id} 參照不存在`);
      return {
        ...record,
        id,
        lessonId,
        studentId,
        status: LESSON_STATUSES.has(record.status) ? record.status : "completed",
        deductLesson: Boolean(record.deductLesson),
        note: text(record.note, 2000),
        deletedAt: record.deletedAt ? text(record.deletedAt, 50) : null,
        isDemoData: Boolean(record.isDemoData),
        recordedAt: text(record.recordedAt || now, 50),
        updatedAt: text(record.updatedAt || now, 50),
      };
    });

    const lessonCreditTransactions = transactionsInput.map((transaction, index) => {
      if (!transaction || typeof transaction !== "object") throw new Error(`第 ${index + 1} 筆堂數異動格式錯誤`);
      const id = assertSafeId(transaction.id, `第 ${index + 1} 筆堂數異動`);
      if (seen.has(`transaction:${id}`)) throw new Error(`堂數異動 ID 重複：${id}`);
      seen.add(`transaction:${id}`);
      const studentId = assertSafeId(transaction.studentId, `堂數異動 ${id} 的學生`);
      if (!studentIds.has(studentId)) throw new Error(`堂數異動 ${id} 找不到學生`);
      const relatedLessonId = transaction.relatedLessonId ? assertSafeId(transaction.relatedLessonId, `堂數異動 ${id} 的課程`) : null;
      return {
        ...transaction,
        id,
        studentId,
        type: CREDIT_TYPES.has(transaction.type) ? transaction.type : "manualAdjustment",
        amount: Math.trunc(numberOr(transaction.amount)),
        reason: text(transaction.reason, 500),
        relatedLessonId,
        createdAt: text(transaction.createdAt || now, 50),
        reversedAt: transaction.reversedAt ? text(transaction.reversedAt, 50) : null,
        isDemoData: Boolean(transaction.isDemoData),
      };
    });

    for (const student of students) {
      if (student.billingType !== "package") continue;
      const hasLedger = lessonCreditTransactions.some(transaction => transaction.studentId === student.id);
      if (hasLedger) continue;
      const openingBalance = Math.max(0, Number(student.totalLessons || 0) - Number(student.usedLessons || 0));
      if (!openingBalance) continue;
      lessonCreditTransactions.push({
        id: `credit_migration_${student.id}`,
        studentId: student.id,
        type: "manualAdjustment",
        amount: openingBalance,
        reason: "v0.7 migration opening balance",
        relatedLessonId: null,
        createdAt: now,
        reversedAt: null,
        isDemoData: Boolean(student.isDemoData),
        isMigration: true,
      });
    }

    const teacherSource = data.teacherProfile && typeof data.teacherProfile === "object" ? data.teacherProfile : {};
    const settingsSource = data.settings && typeof data.settings === "object" ? data.settings : {};
    const defaults = defaultSettings(existingUser);
    return {
      ...data,
      dataVersion: DATA_VERSION,
      version: "0.7.0",
      teacherProfile: {
        name: text(teacherSource.name || "林老師", 100).trim() || "林老師",
        phone: text(teacherSource.phone, 100).trim(),
        email: text(teacherSource.email, 200).trim(),
        lineId: text(teacherSource.lineId, 100).trim(),
        subjects: Array.isArray(teacherSource.subjects)
          ? [...new Set(teacherSource.subjects.map(item => text(item, 100).trim()).filter(Boolean))]
          : [],
        defaultLessonMode: teacherSource.defaultLessonMode === "online" ? "online" : (teacherSource.defaultLessonMode === "inPerson" ? "inPerson" : ""),
        defaultLocation: text(teacherSource.defaultLocation, 500),
        defaultDuration: [30, 45, 60, 90, 120].includes(Number(teacherSource.defaultDuration)) ? Number(teacherSource.defaultDuration) : 60,
        note: text(teacherSource.note, 2000),
        updatedAt: text(teacherSource.updatedAt, 50),
      },
      students,
      lessons,
      lessonRecords,
      lessonCreditTransactions,
      settings: {
        hasCompletedOnboarding: typeof settingsSource.hasCompletedOnboarding === "boolean"
          ? settingsSource.hasCompletedOnboarding
          : defaults.hasCompletedOnboarding,
        onboardingVersion: Math.max(0, Math.trunc(numberOr(settingsSource.onboardingVersion, defaults.onboardingVersion))),
        update: {
          ...defaults.update,
          ...(settingsSource.update && typeof settingsSource.update === "object" ? settingsSource.update : {}),
          autoCheck: settingsSource.update?.autoCheck !== false,
          wifiOnly: settingsSource.update?.wifiOnly !== false,
        },
      },
    };
  }

  function creditBalance(data, studentId) {
    return (data.lessonCreditTransactions || [])
      .filter(transaction => transaction.studentId === studentId && !transaction.reversedAt)
      .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  }

  function addCreditTransaction(data, transaction) {
    if (!data.lessonCreditTransactions) data.lessonCreditTransactions = [];
    if (transaction.relatedLessonId) {
      const duplicate = data.lessonCreditTransactions.find(item =>
        !item.reversedAt
        && item.studentId === transaction.studentId
        && item.relatedLessonId === transaction.relatedLessonId
        && item.type === transaction.type
      );
      if (duplicate) return { transaction: duplicate, created: false };
    }
    const normalized = {
      id: assertSafeId(transaction.id, "堂數異動"),
      studentId: assertSafeId(transaction.studentId, "堂數異動學生"),
      type: CREDIT_TYPES.has(transaction.type) ? transaction.type : "manualAdjustment",
      amount: Math.trunc(numberOr(transaction.amount)),
      reason: text(transaction.reason, 500),
      relatedLessonId: transaction.relatedLessonId ? assertSafeId(transaction.relatedLessonId, "堂數異動課程") : null,
      createdAt: transaction.createdAt || new Date().toISOString(),
      reversedAt: null,
      isDemoData: Boolean(transaction.isDemoData),
    };
    data.lessonCreditTransactions.push(normalized);
    return { transaction: normalized, created: true };
  }

  function reverseCreditTransaction(data, transactionId, reversedAt = new Date().toISOString()) {
    const transaction = (data.lessonCreditTransactions || []).find(item => item.id === transactionId);
    if (!transaction || transaction.reversedAt) return false;
    transaction.reversedAt = reversedAt;
    return true;
  }

  function sanitizeCsvCell(value) {
    let output = value == null ? "" : String(value);
    if (/^[=+\-@\t\r\n＝＋－＠]/.test(output)) output = `\t${output}`;
    return `"${output.replace(/"/g, '""')}"`;
  }

  return {
    DATA_VERSION,
    ONBOARDING_VERSION,
    SAFE_ID,
    ISO_DATE,
    CLOCK_TIME,
    addCreditTransaction,
    addDaysISO,
    creditBalance,
    dateToISO,
    defaultSettings,
    findConflicts,
    intervalsOverlap,
    isRealISODate,
    normalizeData,
    planRecurrence,
    reverseCreditTransaction,
    sanitizeCsvCell,
    timeToMinutes,
    weekdayNumber,
  };
});
