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

// Compute current consecutive-day streak from an array of completion date strings.
// Today is treated as "in progress" — not completing today does NOT break the streak.
// Streak breaks only if yesterday AND today are both absent.
export function calcStreakFromDates(dates, todayStr = todayKey()) {
  const yesterday = isoAddDays(todayStr, -1);
  const unique = [...new Set(dates)].sort().reverse(); // newest first
  if (unique.length === 0) return 0;
  const most = unique[0];
  // Most recent completion is 2+ days ago — streak is definitively broken
  if (most < yesterday) return 0;
  // Count consecutive days backward from the most recent completion date
  let streak = 1;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === isoAddDays(unique[i - 1], -1)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
