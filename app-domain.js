(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.XiaoKeBiaoDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DATA_VERSION = 8;
  const ONBOARDING_VERSION = 2;
  const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
  const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
  const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const CREDIT_TYPES = new Set(["purchase", "gift", "manualAdjustment", "deduction", "restoration", "refund"]);
  const LESSON_STATUSES = new Set(["scheduled", "inProgress", "completed", "studentLeave", "teacherLeave", "absent", "cancelled", "rescheduled"]);
  const TRIAL_RESULTS = new Set(["pending", "converted", "notContinuing", "followUp"]);
  const PRESET_DURATIONS = new Set([30, 45, 60, 90, 120, 180]);

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

  function normalizeDuration(value, fallback = 60) {
    const duration = Math.trunc(numberOr(value, fallback));
    return duration >= 15 && duration <= 360 ? duration : fallback;
  }

  function normalizeSubjects(value, legacySubject = "") {
    const source = Array.isArray(value)
      ? [...value]
      : typeof value === "string"
        ? value.split(/[,，、\n]/)
        : [];
    if (legacySubject) source.unshift(legacySubject);
    const seenSubjects = new Set();
    return source.map(item => text(item, 100).trim()).filter(item => {
      const key = item.toLocaleLowerCase();
      if (!item || seenSubjects.has(key)) return false;
      seenSubjects.add(key);
      return true;
    });
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
      onboardingCurrentStep: existingUser ? 5 : 1,
      contextualTips: {
        recurringConflict: false,
        lastLessonReminder: false,
        trialConversion: false,
        backup: false,
        deleteAndRestoreCredit: false,
        rescheduleScope: false,
      },
      notifications: { lastCreditReminderDate: "" },
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
      const subjects = normalizeSubjects(student.subjects, text(student.subject, 100).trim());
      const requestedDefaultSubject = text(student.defaultSubject, 100).trim();
      const defaultSubject = subjects.includes(requestedDefaultSubject) ? requestedDefaultSubject : (subjects[0] || "");
      return {
        ...student,
        id,
        name: text(student.name, 100).trim(),
        subject: defaultSubject,
        subjects,
        defaultSubject,
        phone: text(student.phone, 100).trim(),
        contactNote: text(student.contactNote, 500).trim(),
        billingType,
        totalLessons: billingType === "perLesson" ? null : Math.max(0, Math.trunc(numberOr(student.totalLessons))),
        usedLessons: Math.max(0, Math.trunc(numberOr(student.usedLessons))),
        pricePerLesson: Math.max(0, numberOr(student.pricePerLesson)),
        defaultDuration: normalizeDuration(student.defaultDuration),
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
        autoCompletedAt: lesson.autoCompletedAt ? text(lesson.autoCompletedAt, 50) : null,
        completionSource: ["system", "teacher"].includes(lesson.completionSource) ? lesson.completionSource : null,
        rescheduleHistory: Array.isArray(lesson.rescheduleHistory) ? lesson.rescheduleHistory.slice(-100).map(entry => ({
          from: {
            date: isRealISODate(entry?.from?.date) ? entry.from.date : lesson.date,
            startTime: CLOCK_TIME.test(String(entry?.from?.startTime || "")) ? entry.from.startTime : lesson.startTime,
            endTime: CLOCK_TIME.test(String(entry?.from?.endTime || "")) ? entry.from.endTime : lesson.endTime,
          },
          to: {
            date: isRealISODate(entry?.to?.date) ? entry.to.date : lesson.date,
            startTime: CLOCK_TIME.test(String(entry?.to?.startTime || "")) ? entry.to.startTime : lesson.startTime,
            endTime: CLOCK_TIME.test(String(entry?.to?.endTime || "")) ? entry.to.endTime : lesson.endTime,
          },
          changedAt: text(entry?.changedAt || now, 50),
          scope: ["only", "later", "series"].includes(entry?.scope) ? entry.scope : "only",
        })) : [],
        createdAt: text(lesson.createdAt || now, 50),
        updatedAt: text(lesson.updatedAt || now, 50),
      };
    });
    const lessonIds = new Set(lessons.map(lesson => lesson.id));
    const lessonsById = new Map(lessons.map(lesson => [lesson.id, lesson]));

    const lessonRecords = recordsInput.map((record, index) => {
      if (!record || typeof record !== "object") throw new Error(`第 ${index + 1} 筆課程紀錄格式錯誤`);
      const id = assertSafeId(record.id, `第 ${index + 1} 筆課程紀錄`);
      if (seen.has(`record:${id}`)) throw new Error(`課程紀錄 ID 重複：${id}`);
      seen.add(`record:${id}`);
      const lessonId = assertSafeId(record.lessonId, `課程紀錄 ${id} 的課程`);
      const referencedLesson = lessonsById.get(lessonId);
      if (!referencedLesson) throw new Error(`課程紀錄 ${id} 參照不存在`);
      const studentId = record.studentId ? assertSafeId(record.studentId, `課程紀錄 ${id} 的學生`) : "";
      if (referencedLesson.lessonType !== "trial" && !studentIds.has(studentId)) throw new Error(`課程紀錄 ${id} 參照不存在`);
      return {
        ...record,
        id,
        lessonId,
        studentId,
        status: LESSON_STATUSES.has(record.status) ? record.status : "completed",
        deductLesson: Boolean(record.deductLesson),
        autoCompleted: Boolean(record.autoCompleted),
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
      if (relatedLessonId && !lessonIds.has(relatedLessonId)) throw new Error(`堂數異動 ${id} 參照的課程不存在`);
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
      version: "0.8.0",
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
        defaultDuration: normalizeDuration(teacherSource.defaultDuration),
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
        onboardingCurrentStep: Math.min(5, Math.max(1, Math.trunc(numberOr(
          settingsSource.onboardingCurrentStep,
          Number(settingsSource.onboardingVersion || 0) < ONBOARDING_VERSION ? 1 : defaults.onboardingCurrentStep
        )))),
        contextualTips: {
          ...defaults.contextualTips,
          ...(settingsSource.contextualTips && typeof settingsSource.contextualTips === "object" ? settingsSource.contextualTips : {}),
        },
        notifications: {
          ...defaults.notifications,
          ...(settingsSource.notifications && typeof settingsSource.notifications === "object" ? settingsSource.notifications : {}),
          lastCreditReminderDate: text(settingsSource.notifications?.lastCreditReminderDate, 10),
        },
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

  function syncStudentUsedLessons(data, studentId) {
    const student = (data.students || []).find(item => item.id === studentId);
    if (!student) return 0;
    const activeLessonIds = new Set((data.lessons || [])
      .filter(lesson => lesson.studentId === studentId && !lesson.deletedAt)
      .map(lesson => lesson.id));
    const used = (data.lessonRecords || []).filter(record =>
      record.studentId === studentId
      && activeLessonIds.has(record.lessonId)
      && !record.deletedAt
      && record.deductLesson
    ).length;
    student.usedLessons = used;
    return used;
  }

  function requireIdFactory(options) {
    if (typeof options.idFactory !== "function") throw new Error("缺少安全 ID 產生器");
    return options.idFactory;
  }

  function completeLessonTransaction(data, options) {
    const lesson = (data.lessons || []).find(item => item.id === options.lessonId && !item.deletedAt);
    if (!lesson) throw new Error("找不到課程");
    const status = LESSON_STATUSES.has(options.status) ? options.status : "completed";
    const student = (data.students || []).find(item => item.id === lesson.studentId);
    if (lesson.lessonType !== "trial" && !student) throw new Error("找不到學生資料");
    const requestedDeduction = lesson.lessonType !== "trial"
      && student?.billingType === "package"
      && Boolean(options.deductLesson);
    const now = options.now || new Date().toISOString();
    const idFactory = requireIdFactory(options);
    if (!data.lessonRecords) data.lessonRecords = [];
    let record = (data.lessonRecords || []).find(item => item.lessonId === lesson.id && !item.deletedAt);
    const previousDeduction = Boolean(record?.deductLesson);
    const systemCompletion = options.completionSource === "system";

    if (requestedDeduction && !previousDeduction && student?.billingType === "package") {
      if (creditBalance(data, student.id) <= 0) throw new Error("此學生已沒有剩餘堂數，請先新增堂數或關閉扣堂");
      const restoration = (data.lessonCreditTransactions || []).find(item =>
        item.studentId === student.id
        && item.relatedLessonId === lesson.id
        && item.type === "restoration"
        && !item.reversedAt
      );
      if (restoration) restoration.reversedAt = now;
      const deduction = (data.lessonCreditTransactions || []).find(item =>
        item.studentId === student.id
        && item.relatedLessonId === lesson.id
        && item.type === "deduction"
      );
      if (deduction) deduction.reversedAt = null;
      else addCreditTransaction(data, {
        id: idFactory("credit"),
        studentId: student.id,
        type: "deduction",
        amount: -1,
        reason: "完成課程扣堂",
        relatedLessonId: lesson.id,
        createdAt: now,
        isDemoData: Boolean(lesson.isDemoData),
      });
    } else if (!requestedDeduction && previousDeduction && student?.billingType === "package") {
      const restoration = (data.lessonCreditTransactions || []).find(item =>
        item.studentId === student.id
        && item.relatedLessonId === lesson.id
        && item.type === "restoration"
      );
      if (restoration) restoration.reversedAt = null;
      else addCreditTransaction(data, {
        id: idFactory("credit"),
        studentId: student.id,
        type: "restoration",
        amount: 1,
        reason: "取消課程扣堂",
        relatedLessonId: lesson.id,
        createdAt: now,
        isDemoData: Boolean(lesson.isDemoData),
      });
    }

    if (record) {
      record.status = status;
      record.deductLesson = requestedDeduction;
      record.note = text(options.note, 2000);
      record.autoCompleted = systemCompletion;
      record.updatedAt = now;
    } else {
      record = {
        id: idFactory("record"),
        lessonId: lesson.id,
        studentId: lesson.studentId,
        status,
        deductLesson: requestedDeduction,
        autoCompleted: systemCompletion,
        note: text(options.note, 2000),
        deletedAt: null,
        recordedAt: now,
        updatedAt: now,
        isDemoData: Boolean(lesson.isDemoData),
      };
      data.lessonRecords.push(record);
    }
    lesson.status = status;
    lesson.recordId = record.id;
    lesson.updatedAt = now;
    lesson.notes = text(options.note || lesson.notes, 2000);
    lesson.autoCompletedAt = systemCompletion ? now : null;
    lesson.completionSource = systemCompletion ? "system" : "teacher";
    if (student) {
      syncStudentUsedLessons(data, student.id);
      student.updatedAt = now;
    }
    return { lesson, record };
  }

  function lessonEndTimestamp(lesson) {
    if (!lesson || !isRealISODate(lesson.date) || !CLOCK_TIME.test(String(lesson.endTime || ""))) return NaN;
    return new Date(`${lesson.date}T${lesson.endTime}:00`).getTime();
  }

  function autoCompleteOverdueLessons(data, options = {}) {
    const nowValue = options.now || new Date().toISOString();
    const nowTimestamp = new Date(nowValue).getTime();
    if (!Number.isFinite(nowTimestamp)) throw new Error("自動完成檢查時間格式錯誤");
    const idFactory = requireIdFactory(options);
    const completed = [];
    const attentionStudentIds = new Set();
    for (const lesson of (data.lessons || [])) {
      if (lesson.deletedAt || !["scheduled", "inProgress"].includes(lesson.status)) continue;
      const endTimestamp = lessonEndTimestamp(lesson);
      if (!Number.isFinite(endTimestamp) || endTimestamp > nowTimestamp) continue;
      const student = (data.students || []).find(item => item.id === lesson.studentId);
      const shouldDeduct = lesson.lessonType !== "trial"
        && student?.billingType === "package"
        && creditBalance(data, student.id) > 0;
      if (lesson.lessonType !== "trial" && student?.billingType === "package" && !shouldDeduct) {
        attentionStudentIds.add(student.id);
      }
      const result = completeLessonTransaction(data, {
        lessonId: lesson.id,
        status: "completed",
        deductLesson: shouldDeduct,
        note: lesson.notes || "",
        completionSource: "system",
        idFactory,
        now: nowValue,
      });
      completed.push({ ...result, deducted: shouldDeduct });
    }
    return {
      changed: completed.length > 0,
      completed,
      completedCount: completed.length,
      attentionStudentIds: [...attentionStudentIds],
    };
  }

  function rescheduleLessonTransaction(data, options) {
    const lesson = (data.lessons || []).find(item => item.id === options.lessonId && !item.deletedAt);
    if (!lesson) throw new Error("找不到課程");
    const nextDate = String(options.date || "");
    const nextStartTime = String(options.startTime || "");
    const nextEndTime = String(options.endTime || "");
    if (!isRealISODate(nextDate)) throw new Error("改期日期格式錯誤");
    if (!CLOCK_TIME.test(nextStartTime) || !CLOCK_TIME.test(nextEndTime) || timeToMinutes(nextStartTime) >= timeToMinutes(nextEndTime)) {
      throw new Error("改期結束時間必須晚於開始時間");
    }
    const now = options.now || new Date().toISOString();
    const idFactory = requireIdFactory(options);
    const previous = { date: lesson.date, startTime: lesson.startTime, endTime: lesson.endTime };
    const record = (data.lessonRecords || []).find(item => item.lessonId === lesson.id && !item.deletedAt);
    if (record) {
      completeLessonTransaction(data, {
        lessonId: lesson.id,
        status: "rescheduled",
        deductLesson: false,
        note: record.note || lesson.notes || "",
        completionSource: "teacher",
        idFactory,
        now,
      });
      record.status = "rescheduled";
      record.autoCompleted = false;
    }
    lesson.rescheduleHistory = Array.isArray(lesson.rescheduleHistory) ? lesson.rescheduleHistory : [];
    lesson.rescheduleHistory.push({
      from: previous,
      to: { date: nextDate, startTime: nextStartTime, endTime: nextEndTime },
      changedAt: now,
      scope: ["only", "later", "series"].includes(options.scope) ? options.scope : "only",
    });
    lesson.date = nextDate;
    lesson.startTime = nextStartTime;
    lesson.endTime = nextEndTime;
    lesson.status = "scheduled";
    lesson.startedAt = null;
    lesson.autoCompletedAt = null;
    lesson.completionSource = null;
    lesson.updatedAt = now;
    return { lesson, record, previous };
  }

  function deleteLessonTransaction(data, options) {
    const lesson = (data.lessons || []).find(item => item.id === options.lessonId && !item.deletedAt);
    if (!lesson) throw new Error("找不到課程");
    const now = options.now || new Date().toISOString();
    const idFactory = requireIdFactory(options);
    const record = (data.lessonRecords || []).find(item => item.lessonId === lesson.id && !item.deletedAt);
    const student = (data.students || []).find(item => item.id === lesson.studentId);
    let restoredTransactionId = null;
    if (options.restoreCredit && record?.deductLesson && student?.billingType === "package") {
      let restoration = (data.lessonCreditTransactions || []).find(item =>
        item.studentId === student.id
        && item.relatedLessonId === lesson.id
        && item.type === "restoration"
      );
      if (restoration) restoration.reversedAt = null;
      else {
        restoration = addCreditTransaction(data, {
          id: idFactory("credit"),
          studentId: student.id,
          type: "restoration",
          amount: 1,
          reason: "刪除已扣堂課程並加回",
          relatedLessonId: lesson.id,
          createdAt: now,
          isDemoData: Boolean(lesson.isDemoData),
        }).transaction;
      }
      restoredTransactionId = restoration.id;
    }
    lesson.deletedAt = now;
    lesson.updatedAt = now;
    lesson.deletion = {
      creditRestored: Boolean(restoredTransactionId),
      restorationTransactionId: restoredTransactionId,
      deletedAt: now,
    };
    if (record) {
      record.deletedAt = now;
      record.updatedAt = now;
    }
    if (student) {
      syncStudentUsedLessons(data, student.id);
      student.updatedAt = now;
    }
    return { lesson, record, restoredTransactionId };
  }

  function restoreLessonTransaction(data, options) {
    const lesson = (data.lessons || []).find(item => item.id === options.lessonId && item.deletedAt);
    if (!lesson) throw new Error("找不到已刪除課程");
    const now = options.now || new Date().toISOString();
    const record = (data.lessonRecords || []).find(item => item.lessonId === lesson.id);
    const student = (data.students || []).find(item => item.id === lesson.studentId);
    if (lesson.deletion?.restorationTransactionId) {
      reverseCreditTransaction(data, lesson.deletion.restorationTransactionId, now);
    }
    lesson.deletedAt = null;
    lesson.updatedAt = now;
    if (record) {
      record.deletedAt = null;
      record.updatedAt = now;
    }
    lesson.deletion = null;
    if (student) {
      syncStudentUsedLessons(data, student.id);
      student.updatedAt = now;
    }
    return { lesson, record };
  }

  function removeDemoData(data) {
    const demoStudentIds = new Set((data.students || []).filter(student => student.isDemoData).map(student => student.id));
    const protectedStudentIds = new Set([
      ...(data.lessons || []).filter(lesson => !lesson.isDemoData && demoStudentIds.has(lesson.studentId)).map(lesson => lesson.studentId),
      ...(data.lessonCreditTransactions || []).filter(transaction => !transaction.isDemoData && demoStudentIds.has(transaction.studentId)).map(transaction => transaction.studentId),
    ]);
    const removedStudentIds = new Set([...demoStudentIds].filter(id => !protectedStudentIds.has(id)));
    const removedLessonIds = new Set((data.lessons || []).filter(lesson => lesson.isDemoData).map(lesson => lesson.id));
    data.students = (data.students || [])
      .filter(student => !removedStudentIds.has(student.id))
      .map(student => protectedStudentIds.has(student.id) ? { ...student, isDemoData: false } : student);
    data.lessons = (data.lessons || []).filter(lesson => !removedLessonIds.has(lesson.id));
    data.lessonRecords = (data.lessonRecords || []).filter(record =>
      !record.isDemoData
      && !removedLessonIds.has(record.lessonId)
      && !removedStudentIds.has(record.studentId)
    );
    data.lessonCreditTransactions = (data.lessonCreditTransactions || []).filter(transaction =>
      !transaction.isDemoData
      && !removedStudentIds.has(transaction.studentId)
      && !removedLessonIds.has(transaction.relatedLessonId)
    );
    return { removedStudents: removedStudentIds.size, removedLessons: removedLessonIds.size };
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
    PRESET_DURATIONS,
    addCreditTransaction,
    addDaysISO,
    autoCompleteOverdueLessons,
    creditBalance,
    dateToISO,
    defaultSettings,
    completeLessonTransaction,
    deleteLessonTransaction,
    findConflicts,
    intervalsOverlap,
    isRealISODate,
    normalizeData,
    normalizeDuration,
    normalizeSubjects,
    planRecurrence,
    removeDemoData,
    reverseCreditTransaction,
    restoreLessonTransaction,
    rescheduleLessonTransaction,
    sanitizeCsvCell,
    timeToMinutes,
    syncStudentUsedLessons,
    weekdayNumber,
  };
});
