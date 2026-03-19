# Wave 3.3 — Timezone Fix

## Change

Removed `completed_at: new Date().toISOString()` from the main completion upsert in `handleComplete()`.

PostgreSQL's column default `now()` now handles the timestamp. This is the correct approach because:
- PostgreSQL stores `timestamptz` — the absolute moment in time with timezone info
- JavaScript `new Date(completedAt).getHours()` automatically converts to the user's local browser timezone when reading it back
- No manual timezone offset calculations are needed
- Works correctly for all timezones globally

## What was changed

**`src/App.js` — `handleComplete()` main upsert**

Before:
```js
{ habit_id: habitId, member_id: resolvedMember.id, family_id: family.id, date: today, taps: newTaps, completed_at: new Date().toISOString() }
```

After:
```js
{ habit_id: habitId, member_id: resolvedMember.id, family_id: family.id, date: today, taps: newTaps }
```

The shared completion upsert was already clean (no `completed_at` field).

## Note on `date` field

The `date` field (used for day-level grouping) still uses `todayKey()` which returns the UTC calendar date via `new Date().toISOString().split("T")[0]`. For Melbourne (UTC+11), this means taps before 11am local time are stored under the previous UTC calendar date. Both the save and fetch use the same `todayKey()` call, so completions remain consistent within a session — but this could cause a mid-day reset if the UTC midnight boundary is crossed while the app is open. If this becomes an issue, `todayKey()` should be changed to use local calendar date instead of UTC.
