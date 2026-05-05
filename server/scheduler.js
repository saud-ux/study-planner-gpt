const DAY_MS = 86400000;

export function validatePlannerInput(input) {
  const errors = [];
  if (!input || typeof input !== "object") errors.push("Body must be an object.");
  const data = input?.data || {};
  if (!Array.isArray(data.subjects)) errors.push("data.subjects must be an array.");
  if (!Array.isArray(data.classes)) errors.push("data.classes must be an array.");
  if (!Array.isArray(data.assignments)) errors.push("data.assignments must be an array.");
  if (!Array.isArray(data.exams)) errors.push("data.exams must be an array.");
  if (!Array.isArray(data.commitments)) errors.push("data.commitments must be an array.");
  if (!input?.preferences || typeof input.preferences !== "object") errors.push("preferences are required.");
  return { ok: errors.length === 0, errors };
}

export function buildPlannerContext(input) {
  const data = normalizeData(input.data);
  const preferences = normalizePreferences(input.preferences);
  const range = resolveDateRange(preferences, data);
  const availability = buildAvailability(data, preferences, range);
  const studyItems = buildStudyItems(data, range);
  return { data, preferences, range, availability, studyItems };
}

export function repairSchedule(schedule, context) {
  const warnings = [];
  const slots = context.availability.map((slot) => ({ ...slot }));
  const cleaned = [];

  const candidates = Array.isArray(schedule) ? schedule : [];
  for (const item of candidates) {
    const type = item?.type === "break" ? "break" : "study";
    const start = Date.parse(item?.startTime);
    const end = Date.parse(item?.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      warnings.push("Dropped a schedule item with invalid times.");
      continue;
    }
    const startMin = toAbsoluteMinutes(new Date(start));
    const endMin = toAbsoluteMinutes(new Date(end));
    const duration = endMin - startMin;
    const max = type === "study" ? context.preferences.maximumSessionMinutes : 60;
    if (type === "study" && duration < context.preferences.minimumSessionMinutes) {
      warnings.push(`Dropped a study item shorter than ${context.preferences.minimumSessionMinutes} minutes.`);
      continue;
    }
    if (duration > max) {
      warnings.push(`Trimmed an overlong ${type} item.`);
    }
    const placed = reserveInSlots(slots, Math.min(duration, max), startMin, endMin);
    if (!placed) {
      warnings.push("Dropped an item that conflicted with busy time or another scheduled item.");
      continue;
    }
    cleaned.push(toPublicItem(item.subject || "Study", placed.start, placed.end, type));
  }

  if (!cleaned.some((item) => item.type === "study")) {
    const fallback = fallbackSchedule(context);
    return { schedule: fallback.schedule, warnings: [...warnings, ...fallback.warnings] };
  }

  return { schedule: cleaned.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)), warnings };
}

export function fallbackSchedule(context) {
  const warnings = [];
  const slots = context.availability.map((slot) => ({ ...slot }));
  const schedule = [];
  const dailyTotals = new Map();

  const items = [...context.studyItems].sort((a, b) => b.priority - a.priority);
  for (const item of items) {
    let remaining = item.minutes;
    while (remaining >= context.preferences.minimumSessionMinutes) {
      const best = chooseSlot(slots, context.preferences, dailyTotals);
      if (!best) break;
      const dayKey = minuteToDate(best.startMin);
      const already = dailyTotals.get(dayKey) || 0;
      const dailyLeft = Math.max(0, context.preferences.maxHoursPerDay * 60 - already);
      const duration = Math.min(
        remaining,
        context.preferences.preferredSessionMinutes,
        context.preferences.maximumSessionMinutes,
        best.endMin - best.startMin,
        dailyLeft
      );
      if (duration < context.preferences.minimumSessionMinutes) {
        best.startMin = best.endMin;
        continue;
      }
      const start = best.startMin;
      const end = start + duration;
      schedule.push(toPublicItem(item.subject, start, end, "study"));
      dailyTotals.set(dayKey, already + duration);
      best.startMin = end;
      remaining -= duration;

      if (context.preferences.breakEnabled && context.preferences.breakPlacement === "after") {
        const breakDuration = Math.min(context.preferences.breakMinutes, best.endMin - best.startMin);
        if (breakDuration >= 5) {
          schedule.push(toPublicItem("Break", best.startMin, best.startMin + breakDuration, "break"));
          best.startMin += breakDuration;
        }
      }
    }
  }

  if (!schedule.length) warnings.push("No schedule could be generated from the available free time.");
  return { schedule: schedule.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)), warnings };
}

function normalizeData(data) {
  return {
    subjects: Array.isArray(data.subjects) ? data.subjects.map((subject) => ({
      id: stringOrId(subject.id),
      name: subject.name || subject.nameEn || subject.nameAr || "Subject",
      difficulty: clampInt(subject.difficulty, 1, 5, 3),
      currentGrade: optionalNumber(subject.currentGrade ?? calculateGrade(subject.gradeComponents)),
      gradeComponents: Array.isArray(subject.gradeComponents) ? subject.gradeComponents : []
    })) : [],
    classes: normalizeBusy(data.classes, "class"),
    commitments: normalizeBusy(data.commitments, "commitment"),
    holidays: Array.isArray(data.holidays) ? data.holidays.filter(Boolean).map(String) : [],
    assignments: Array.isArray(data.assignments) ? data.assignments.map((item) => ({
      id: stringOrId(item.id),
      subjectId: String(item.subjectId || ""),
      title: String(item.title || "Assignment"),
      due: String(item.due || "")
    })) : [],
    exams: Array.isArray(data.exams) ? data.exams.map((item) => ({
      id: stringOrId(item.id),
      subjectId: String(item.subjectId || ""),
      title: String(item.title || "Exam"),
      date: String(item.date || ""),
      time: String(item.time || "09:00")
    })) : []
  };
}

function normalizePreferences(preferences) {
  return {
    scheduleMode: preferences.scheduleMode || "next7",
    customStartDate: preferences.customStartDate || "",
    customEndDate: preferences.customEndDate || "",
    semesterEnd: preferences.semesterEnd || "",
    studyWindowStart: preferences.studyWindowStart || "06:00",
    studyWindowEnd: preferences.studyWindowEnd || "23:00",
    preferredStudyTime: preferences.preferredStudyTime || "any",
    preferredSessionMinutes: clampInt(preferences.preferredSessionMinutes, 30, 180, 60),
    minimumSessionMinutes: clampInt(preferences.minimumSessionMinutes, 15, 90, 30),
    maximumSessionMinutes: clampInt(preferences.maximumSessionMinutes, 120, 180, 180),
    maxHoursPerDay: clampNumber(preferences.maxHoursPerDay, 1, 12, 5),
    restDays: Array.isArray(preferences.restDays) ? preferences.restDays.map(Number) : [],
    breakEnabled: Boolean(preferences.breakEnabled),
    breakPlacement: preferences.breakPlacement === "during" ? "during" : "after",
    breakMinutes: clampInt(preferences.breakMinutes, 5, 30, 10)
  };
}

function resolveDateRange(preferences, data) {
  const today = startOfDate(new Date());
  let start = preferences.customStartDate ? parseDate(preferences.customStartDate) : today;
  let end = addDays(start, 6);

  if (preferences.scheduleMode === "today") end = start;
  if (preferences.scheduleMode === "nearest") {
    const dates = [
      ...data.assignments.map((a) => parseDate(a.due)),
      ...data.exams.map((e) => parseDate(e.date))
    ].filter((date) => date && date >= today).sort((a, b) => a - b);
    end = dates[0] || end;
  }
  if (preferences.scheduleMode === "semester") {
    end = parseDate(preferences.semesterEnd) || end;
  }
  if (preferences.scheduleMode === "custom") {
    end = parseDate(preferences.customEndDate) || end;
  }
  if (!start || start < today) start = today;
  if (end < start) end = start;
  return { startDate: dateOnly(start), endDate: dateOnly(end) };
}

function buildAvailability(data, preferences, range) {
  const slots = [];
  const start = parseDate(range.startDate);
  const end = parseDate(range.endDate);
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = dateOnly(cursor);
    if (data.holidays.includes(date)) continue;
    if (preferences.restDays.includes(cursor.getDay())) continue;
    const dayStart = toAbsoluteMinutes(cursor, preferences.studyWindowStart);
    let dayEnd = toAbsoluteMinutes(cursor, preferences.studyWindowEnd);
    if (dayEnd <= dayStart) dayEnd += 1440;
    const busy = [
      ...data.classes.filter((item) => item.days.includes(cursor.getDay())),
      ...data.commitments.filter((item) => item.days.includes(cursor.getDay()))
    ].flatMap((item) => busyToAbsolute(cursor, item, dayStart, dayEnd));
    const mergedBusy = mergeIntervals(busy);
    let pointer = dayStart;
    for (const interval of mergedBusy) {
      if (interval.startMin > pointer) slots.push({ date, startMin: pointer, endMin: interval.startMin });
      pointer = Math.max(pointer, interval.endMin);
    }
    if (pointer < dayEnd) slots.push({ date, startMin: pointer, endMin: dayEnd });
  }
  return slots.filter((slot) => slot.endMin - slot.startMin >= preferences.minimumSessionMinutes);
}

function buildStudyItems(data, range) {
  const start = parseDate(range.startDate);
  const end = parseDate(range.endDate);
  const subjects = new Map(data.subjects.map((subject) => [subject.id, subject]));
  const items = [];
  for (const assignment of data.assignments) {
    const due = parseDate(assignment.due);
    if (!due || due < start || due > addDays(end, 30)) continue;
    const subject = subjects.get(assignment.subjectId);
    if (!subject) continue;
    items.push(makeStudyItem(subject, assignment.title, due, "assignment", 1, start));
  }
  for (const exam of data.exams) {
    const due = parseDate(exam.date);
    if (!due || due < start || due > addDays(end, 30)) continue;
    const subject = subjects.get(exam.subjectId);
    if (!subject) continue;
    items.push(makeStudyItem(subject, exam.title || "Exam", due, "exam", 2, start));
  }
  return items;
}

function makeStudyItem(subject, title, due, kind, weight, today) {
  const daysUntil = Math.max(0, Math.round((startOfDate(due) - startOfDate(today)) / DAY_MS));
  const gradeGap = subject.currentGrade == null ? 15 : Math.max(0, 90 - subject.currentGrade);
  const urgency = 1 + Math.max(0, 14 - Math.min(daysUntil, 14)) / 7;
  const priority = weight * urgency * (1 + subject.difficulty / 5) * (1 + gradeGap / 100);
  const minutes = Math.round(clampNumber(45 * priority, 30, kind === "exam" ? 360 : 180));
  return {
    subject: subject.name,
    title,
    kind,
    dueDate: dateOnly(due),
    difficulty: subject.difficulty,
    currentGrade: subject.currentGrade,
    priority: Number(priority.toFixed(3)),
    minutes
  };
}

function chooseSlot(slots, preferences, dailyTotals) {
  const valid = slots.filter((slot) => {
    const dayKey = minuteToDate(slot.startMin);
    return slot.endMin - slot.startMin >= preferences.minimumSessionMinutes &&
      (dailyTotals.get(dayKey) || 0) < preferences.maxHoursPerDay * 60;
  });
  if (!valid.length) return null;
  const preferred = valid.filter((slot) => {
    const minute = slot.startMin % 1440;
    if (preferences.preferredStudyTime === "morning") return minute < 12 * 60;
    if (preferences.preferredStudyTime === "evening") return minute >= 17 * 60;
    return true;
  });
  return (preferred.length ? preferred : valid).sort((a, b) => a.startMin - b.startMin)[0];
}

function reserveInSlots(slots, duration, requestedStart, requestedEnd) {
  for (const slot of slots) {
    const start = Math.max(slot.startMin, requestedStart);
    const end = Math.min(slot.endMin, requestedEnd);
    if (end - start >= duration) {
      const placed = { start, end: start + duration };
      splitReservedSlot(slots, slot, placed.start, placed.end);
      return placed;
    }
  }
  return null;
}

function splitReservedSlot(slots, slot, start, end) {
  const index = slots.indexOf(slot);
  const replacement = [];
  if (slot.startMin < start) replacement.push({ ...slot, endMin: start });
  if (end < slot.endMin) replacement.push({ ...slot, startMin: end });
  slots.splice(index, 1, ...replacement);
}

function normalizeBusy(items, fallbackType) {
  return Array.isArray(items) ? items.map((item) => ({
    id: stringOrId(item.id),
    type: String(item.type || fallbackType),
    name: String(item.name || item.title || fallbackType),
    days: Array.isArray(item.days) ? item.days.map(Number).filter((n) => n >= 0 && n <= 6) : [],
    startTime: item.startTime || "09:00",
    endTime: item.endTime || "10:00"
  })) : [];
}

function busyToAbsolute(date, item, windowStart, windowEnd) {
  let start = toAbsoluteMinutes(date, item.startTime);
  let end = toAbsoluteMinutes(date, item.endTime);
  if (end <= start) end += 1440;
  return [
    { startMin: start, endMin: end },
    { startMin: start - 1440, endMin: end - 1440 },
    { startMin: start + 1440, endMin: end + 1440 }
  ].map((interval) => ({
    startMin: Math.max(interval.startMin, windowStart),
    endMin: Math.min(interval.endMin, windowEnd)
  })).filter((interval) => interval.endMin > interval.startMin);
}

function mergeIntervals(intervals) {
  return intervals
    .filter((item) => item.endMin > item.startMin)
    .sort((a, b) => a.startMin - b.startMin)
    .reduce((merged, item) => {
      const last = merged[merged.length - 1];
      if (!last || item.startMin > last.endMin) merged.push({ ...item });
      else last.endMin = Math.max(last.endMin, item.endMin);
      return merged;
    }, []);
}

function calculateGrade(components) {
  if (!Array.isArray(components) || !components.length) return null;
  let earned = 0;
  let max = 0;
  let hasEarned = false;
  for (const component of components) {
    const componentMax = Number(component.max);
    const componentEarned = Number(component.earned);
    if (Number.isFinite(componentMax)) max += componentMax;
    if (Number.isFinite(componentEarned)) {
      earned += componentEarned;
      hasEarned = true;
    }
  }
  if (!max || !hasEarned) return null;
  return clampNumber((earned / max) * 100, 0, 100);
}

function toPublicItem(subject, startMin, endMin, type) {
  return {
    subject,
    startTime: minuteToIso(startMin),
    endTime: minuteToIso(endMin),
    type
  };
}

function toAbsoluteMinutes(date, time = "00:00") {
  const base = startOfDate(date).getTime() / 60000;
  const [hours, minutes] = String(time).split(":").map(Number);
  return base + (hours || 0) * 60 + (minutes || 0);
}

function minuteToIso(minutes) {
  const date = new Date(minutes * 60000);
  return [
    dateOnly(date),
    "T",
    String(date.getHours()).padStart(2, "0"),
    ":",
    String(date.getMinutes()).padStart(2, "0"),
    ":00"
  ].join("");
}

function minuteToDate(minutes) {
  return dateOnly(new Date(minutes * 60000));
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function startOfDate(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function dateOnly(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function stringOrId(value) {
  return value ? String(value) : Math.random().toString(36).slice(2, 10);
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Math.round(clampNumber(Number.isFinite(number) ? number : fallback, min, max));
}

function clampNumber(value, min, max, fallback = min) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}
