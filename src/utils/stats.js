// Pure date / streak / statistics helpers.
// Extracted from App.js so the calculation logic can be unit-tested in isolation.
// All date strings are YYYY-MM-DD. The app's canonical "day" is a Melbourne calendar day.

export const MELB_TZ = 'Australia/Melbourne';

export function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: MELB_TZ });
}

// Melbourne's yesterday, derived from Melbourne's today by pure string math.
// (Subtracting a device-local calendar day and then formatting in Melbourne
// goes wrong when the device timezone's DST transitions don't line up with
// Melbourne's — the "day" subtracted can be 23/25 real hours.)
export function getYesterdayKey(todayStr = todayKey()) {
  return isoAddDays(todayStr, -1);
}

export function getTodayIndex(todayStr = todayKey()) {
  const [y, m, d] = todayStr.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

export function getWeekDates(todayStr = todayKey()) {
  const [y, m, d] = todayStr.split('-').map(Number);
  const today = new Date(y, m - 1, d);
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(y, m - 1, d + mondayOffset + i);
    return date.toLocaleDateString('en-CA');
  });
}

// Safe date arithmetic on YYYY-MM-DD strings — avoids UTC parsing issues (#11)
export function isoAddDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return [dt.getFullYear(), String(dt.getMonth() + 1).padStart(2, '0'), String(dt.getDate()).padStart(2, '0')].join('-');
}

// Monday (YYYY-MM-DD) of the week containing dateStr. Component/string math
// only — parsing 'YYYY-MM-DD' with new Date() reads it as UTC midnight, which
// shifts the weekday (and the derived Monday) on devices west of UTC.
export function mondayKeyOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Mon=0
  return isoAddDays(dateStr, -dow);
}

// Compute current consecutive-day streak from an array of completion date strings.
// Today is treated as "in progress" — not completing today does NOT break the streak.
//
// activeDays (optional, Mon=0..Sun=6, null/[] = every day) makes the streak
// schedule-aware: a day the habit isn't scheduled neither breaks nor is
// required, but a completion on an off-day still extends the streak.
export function calcStreakFromDates(dates, todayStr = todayKey(), activeDays = null) {
  const dateSet = new Set(dates);
  if (dateSet.size === 0) return 0;
  const earliest = [...dateSet].sort()[0];
  const isActive = (s) => !activeDays || activeDays.length === 0 || activeDays.includes(getTodayIndex(s));
  let streak = dateSet.has(todayStr) ? 1 : 0;
  for (let d = isoAddDays(todayStr, -1); ; d = isoAddDays(d, -1)) {
    if (d < earliest) break;                 // nothing older can extend the streak
    if (dateSet.has(d)) { streak++; continue; }
    if (!isActive(d)) continue;              // not scheduled — skip without breaking
    break;                                   // scheduled day with no completion
  }
  return streak;
}

// Collapse completion rows to one per (habit, day), keeping the max-taps row.
// Shared habits mirror one identical row per assigned member; summing the raw
// rows counts the same completion once per member.
export function dedupeByHabitDay(completions) {
  const byKey = new Map();
  completions.forEach(c => {
    const k = `${c.habitId}_${c.date}`;
    const prev = byKey.get(k);
    if (!prev || (c.taps || 0) > (prev.taps || 0)) byKey.set(k, c);
  });
  return [...byKey.values()];
}

// Unique days within [startStr, endStr] (inclusive) on which a habit was
// completed. Family mode passes rows from several members — a habit
// "happened" on a day if ANY member completed it, so distinct dates must be
// counted, not rows, or rates exceed 100%.
export function uniqueCompletionDays(completions, habitId, startStr, endStr) {
  const days = new Set();
  completions.forEach(c => {
    if (c.habitId === habitId && c.taps > 0 && c.date >= startStr && c.date <= endStr) days.add(c.date);
  });
  return days.size;
}

// Habits a member completed TO TARGET on a given day. Rows are unique per
// (habit, member, date), so counting rows is safe once taps >= target is
// required — the same completed-day definition the live "today" view uses.
export function memberDayDoneCount(completions, dateStr, memberId, habits) {
  const targetById = new Map(habits.map(h => [h.id, h.target || 1]));
  return completions.filter(c =>
    c.date === dateStr && c.memberId === memberId &&
    targetById.has(c.habitId) && (c.taps || 0) >= targetById.get(c.habitId)
  ).length;
}

// Overlay the live today-completions state onto the week's completions.
// todayCompletions receives every optimistic update (taps, undo); the
// week fetch does not — without this merge, week-scoped stats are blind to
// anything logged today. Rows are keyed by (habit, member, date); the live
// row wins.
export function mergeLiveToday(weekCompletions, todayCompletions) {
  const key = (c) => `${c.habitId}_${c.memberId}_${c.date}`;
  const liveKeys = new Set(todayCompletions.map(key));
  return [
    ...weekCompletions.filter(c => !liveKeys.has(key(c))),
    ...todayCompletions,
  ];
}

// Most recent day strictly before todayStr on which the habit was scheduled.
// Every-day habits (null/[] activeDays) → yesterday. Falls back to yesterday
// if activeDays contains no valid weekday.
export function lastScheduledDayBefore(todayStr, activeDays = null) {
  const yesterday = isoAddDays(todayStr, -1);
  if (!activeDays || activeDays.length === 0) return yesterday;
  for (let i = 1; i <= 7; i++) {
    const d = isoAddDays(todayStr, -i);
    if (activeDays.includes(getTodayIndex(d))) return d;
  }
  return yesterday;
}
