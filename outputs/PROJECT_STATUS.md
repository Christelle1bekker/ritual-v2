# Ritual v2 — Project Status
**Last updated:** March 19, 2026
**Production URL:** https://ritual-v2-mu.vercel.app

---

## Waves Completed

### Wave 1+2 — March 17, 2026
Core bug fixes and new completion model.
- Fixed multi-user tile tap: habits with multiple assigned members always trigger "Who did this?"
- "Who did this?" filters to only the assigned members
- Fixed mobile header safe-area clipping
- Added `completion_type`: `'individual'` (each member tracked separately) or `'shared'` (one tap syncs to all)
- Completion type selector in Add habit + Manage Habits edit form
- Reset Points & Streaks admin action in Settings
- Restructured Add tab: Browse Templates + Create Custom workflow
- Data cleanup: all points and streaks reset to 0

### Wave 3 — March 17, 2026
Insights analytics dashboard + critical reliability fixes.
- **Daily reset detection**: `checkDateBoundary()` fires on app foreground + before every completion — fixes stale tap counts across midnight
- **Shared completion backfill**: switching Individual → Shared now retroactively syncs today's completions
- **React Error Boundary**: graceful crash screen instead of white screen
- **Insights tab**: full 6-card analytics layout (Family Highlights, Streak Watch, Time Patterns, Habit Health, Kids Leaderboard, Personal Bests)
- Analytics lazy-loaded (last 30 days), cached 5 min
- My Stats / Family toggle across all analytics cards
- Weekly chart label clipping fixed; household rate shows live %
- All `console.log()` calls removed
- Font loading moved from JS `@import` to HTML `<link>` preload

### Wave 3.1 — March 19, 2026
- Fixed duplicate percentage label in weekly chart
- Fixed analytics not filtering correctly for individual member view

### Wave 3.2 — March 19, 2026
- Insights tab UX improvements (card spacing, loading states)
- Hotfix: tap race condition where rapid taps could double-count

### Wave 3.3 — March 19, 2026
- **Timezone fix**: removed JS `completed_at: new Date().toISOString()` from completion upsert — now uses PostgreSQL `now()` default, which stores absolute `timestamptz`. JS reads it back in local browser timezone automatically.

### Wave 4 — March 19, 2026
Full Points & Rewards system.
- **Per-habit point values**: configurable (5 / 10 / 15 / 25 / 50 pts) in Add + Edit habit forms
- `handleComplete` / `handleUndo` use `habit.points` instead of hardcoded 10
- `CompletionFlash` shows dynamic "+{points} points"
- **Manage Rewards** in Set Up tab: emoji picker, name, cost presets, who can redeem, edit/delete
- Soft-delete rewards (`status = 'archived'`) to preserve redemption history
- **Functional redeem flow** in Family tab:
  - Shows filtered rewards (kids-only hidden from adults)
  - Redeem button enabled/disabled by affordability
  - Confirmation sheet with remaining balance preview
  - Creates `reward_redemptions` row (`status = 'pending'`)
  - Pending Requests card: adults can fulfil (Done) or cancel (refunds points); kids see own only
- New DB: `reward_redemptions` table + `rewards.assigned_to` + `rewards.status` columns
- `normalizeReward()` function; `fetchFamilyData` runs rewards through it

### Wave 4.1 — March 19, 2026
Fix reward creation UX — rewards were buried in Set Up tab.
- **`+ Add Reward` button** directly in Family tab rewards section (adults only)
- **8 pre-built templates**: dinner pick, movie night, extra screen time, stay up late, car music, weekend activity, $5 pocket money, $10 pocket money
- Clicking a template auto-populates all form fields
- Custom form: icon picker (20 emojis), name, points (25–500), who (Everyone / Kids)
- Improved empty state with emoji, description, and "Add First Reward" button
- No new DB changes — wires to existing `handleAddReward`

---

## What's Currently Working in Production

| Feature                          | Status     |
|----------------------------------|------------|
| Family PIN login / creation      | ✅ Working  |
| NFC tile tap → habit completion  | ✅ Working  |
| "Who did this?" overlay          | ✅ Working  |
| Per-member tap tracking          | ✅ Working  |
| Individual vs Shared habits      | ✅ Working  |
| Assign members to habits         | ✅ Working  |
| Active days filter               | ✅ Working  |
| Per-habit point values           | ✅ Working  |
| Points earn/undo on completion   | ✅ Working  |
| CompletionFlash with undo        | ✅ Working  |
| Add habits (templates + custom)  | ✅ Working  |
| Edit / delete habits             | ✅ Working  |
| Assign NFC tiles to habits       | ✅ Working  |
| Add rewards (Family tab modal)   | ✅ Working  |
| Add rewards (Set Up tab)         | ✅ Working  |
| Edit / delete rewards            | ✅ Working  |
| Redeem rewards (confirmation)    | ✅ Working  |
| Pending requests for adults      | ✅ Working  |
| Fulfil / cancel redemptions      | ✅ Working  |
| Family member add / edit         | ✅ Working  |
| Points leaderboard in Family tab | ✅ Working  |
| Insights analytics (6 cards)     | ✅ Working  |
| Daily reset detection            | ✅ Working  |
| Streak tracking                  | ✅ Working  |
| Error Boundary                   | ✅ Working  |
| Sound / haptic feedback          | ✅ Working  |
| Settings (logout, refresh, reset)| ✅ Working  |

---

## Known Issues / Limitations

1. **UTC date drift** — `todayKey()` uses UTC. For timezones well east of UTC (e.g. Melbourne UTC+11), taps before 11am local may land on the previous calendar date. Consistent within a session but can cause unexpected day resets near local midnight. Fix: replace `todayKey()` with local calendar date.

2. **Streak decay** — No server job to break streaks for missed days. Streaks are only incremented client-side on completion, never decremented for inactivity.

3. **`is_shared` vs `completion_type`** — Two partially overlapping fields. `is_shared` (boolean) affects the "Who did this?" trigger; `completion_type` ('shared'/'individual') controls sync behaviour. Could be consolidated into one field.

4. **`rewards.color`** — Present in DB schema and always set to a default on insert, but never shown in any UI element.

5. **No offline support** — App requires active Supabase connection. No local cache or queue for offline taps.

6. **No PWA manifest** — No `manifest.json` or app icons file. Add to Home Screen works via Safari's screenshot mechanism.

7. **App.js is one large file** — 3132 lines. No component files extracted. Works fine, but harder to navigate as the app grows.

8. **Habit deletion is hard delete** — No archive/soft-delete for habits (unlike rewards which are soft-deleted). Deleting a habit cascades and removes all completion history.

---

## What's Next to Build (Suggested)

### High priority
- **Local date fix** — Change `todayKey()` to use local calendar date instead of UTC to fix midnight boundary issues for non-UTC timezones.
- **Server-side streak reset** — Cron job (Supabase Edge Function) that resets member and habit streaks when a day is missed.
- **PWA manifest** — Add `manifest.json` + app icon so families can properly install to home screen with an icon.

### Medium priority
- **Habit archive / soft delete** — Preserve history when removing habits (same pattern as rewards `status = 'archived'`).
- **Notifications / reminders** — Web Push or in-app daily reminders for habits not yet completed.
- **Recurring reward templates** — Monthly reset so kids can re-earn pocket money each month.
- **Consolidate `is_shared` + `completion_type`** — Single unified field to simplify the completion model.

### Low priority / nice to have
- **Habit reordering** — Drag to reorder within a category.
- **Multi-family support** — Switch between families with one device.
- **Export / backup** — CSV export of completion history.
- **Component extraction** — Split App.js into separate component files once the feature set stabilises.
- **Offline support** — Queue completions in localStorage when offline; sync when reconnected.

---

## Commit History (recent)

| Commit    | Date        | Description                                        |
|-----------|-------------|----------------------------------------------------|
| `62b5f1e` | Mar 19 2026 | Wave 4.1: Fix reward creation & add templates      |
| `81fff97` | Mar 19 2026 | Wave 4: Per-habit points + functional rewards redemption |
| `912b556` | Mar 19 2026 | Wave 3.3: Fix timezone handling for completed_at   |
| `878b3c1` | Mar 19 2026 | Wave 3.2: Insights tab UX improvements             |
| `3422aed` | Mar 19 2026 | HOTFIX: Fix completion tap race condition (3.2)    |
| `2f73463` | Mar 19 2026 | Wave 3.1: Fix duplicate % + analytics filtering    |
| `4fec6d5` | Mar 17 2026 | Wave 3: Critical fixes + Insights analytics        |
| `3af7cb4` | Mar 17 2026 | Wave 1+2: Bug fixes, shared completion, UX         |
