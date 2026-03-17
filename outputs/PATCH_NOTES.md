# Wave 3.1 Patch Notes

**Date:** March 17, 2026
**Build size:** 115.8 kB gzip (+29 B vs Wave 3)
**Files changed:** `src/App.js`

---

## Bug Fixes

### Fix 1 — Duplicate percentage in "Family Progress This Week" header

**Symptom:** The percentage appeared twice — once in the header subtitle row (right side) and once as a floating label above today's bar in the chart.

**Root cause:** Wave 3 added a right-side `%` display to the subtitle flex row, but the bar chart already had a floating `{pct}%` label rendered above today's column (`position: absolute, top: -20`). Both showed the same value.

**Fix:** Removed the floating `{pct}%` label from today's bar. The right-side percentage in the subtitle row is the canonical display.

**Lines changed:** ~803–805 in `TodayScreen` weekly chart

---

### Fix 2 — "My Stats" analytics filtering ignored habit assignment

**Symptom:** When a member (e.g. Christelle) selected "My Stats" in the Insights tab, they saw completions and analytics for habits not assigned to them (e.g. Willem's "Workout").

**Root cause:** `filteredWeek` and `filteredAnalytics` useMemos only filtered by `c.memberId === currentMember.id`, but did not check `habit.assignedMemberIds`. A completion record exists for any member who tapped — so if Willem tapped a habit assigned only to Willem, his `memberId` completion row would still be included when filtering by Christelle's ID if she happened to have tapped it (or if shared logic created a record).

More critically, `habitHealth` iterated `habits.map(...)` using ALL habits, so it could display health stats for habits that aren't relevant to the current member.

**Fix:**

1. **`filteredWeek`** — Added secondary check: for each completion, look up the habit and verify `assignedMemberIds` is null/empty (everyone's habit) OR includes `currentMember.id`.

2. **`filteredAnalytics`** — Same secondary check applied.

3. **`habitHealth`** — Added `visibleHabits` pre-filter in My Stats mode: only iterate habits where `assignedMemberIds` is null/empty or includes `currentMember.id`.

**Lines changed:** ~1641–1665 (`filteredWeek`, `filteredAnalytics`), ~1754–1765 (`habitHealth`)

---

## Testing Checklist

- [ ] Family Progress chart: only one `%` visible (in subtitle row, not on bar)
- [ ] Insights tab → My Stats: Christelle sees only her assigned habits
- [ ] Insights tab → My Stats: habits assigned to Willem only don't appear in Habit Health
- [ ] Insights tab → Family: all habits + all members shown
- [ ] Toggle My Stats ↔ Family: data updates correctly
- [ ] Build: `npm run build` compiles without errors

---

## Deployment

```bash
git add src/App.js
git commit -m "Wave 3.1: Fix duplicate percentage + analytics filtering"
git push origin main
```
