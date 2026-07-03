# Ritual App — Claude Code Handoff

> Paste this file (or point a session at it) when starting work on Ritual.
> Regenerated 2026-07-03 on branch `ritual-dustoff` — the old version described the
> March-2026 web-only app on a Windows machine and was badly stale.
> Read CONTEXT.md for the full architecture; this file is the quick-start.

## Project in one sentence

**Ritual** is a family habit tracker — React 18 (CRA) in a single ~6,350-line `src/App.js`, Supabase backend, wrapped in a **Capacitor 8 iOS app** (`com.ritualhabits.app`) with NFC tile scanning, APNs push, and Capgo OTA updates; web build deployed on Vercel.

## URLs & services

| | |
|---|---|
| Live web app / NFC landing | https://ritual-v2-mu.vercel.app |
| Tile short domain | `t.ritualhabits.com.au/:uid` → 301 to `/t/:uid` |
| Supabase dashboard | https://supabase.com/dashboard/project/nupifxbhwfaqyjevmmde |
| Vercel project | `ritual-v2` under `christelle1bekkers-projects` |
| iOS distribution | TestFlight (Internal Testing) — archive steps in `spike/c4-xcode-handoff.md` |
| Ops alerts | "Ritual Ops" Telegram group (Maurice = health bot, Debbie = research bot) |

## Local development

```bash
npm start          # CRA dev server on localhost:3000 (needs .env.local with REACT_APP_SUPABASE_URL / _ANON_KEY)
npm test           # Jest — unit tests for src/utils/ (stats + pagination). KEEP GREEN.
npm run build      # production build; should be zero warnings
npx cap sync ios   # after changing web deps or capacitor config
open ios/App/App.xcodeproj   # NOT a .xcworkspace — Capacitor 8 + SPM uses the xcodeproj
```

Deploy web: push to `main` → Vercel auto-deploys. Deploy iOS: bump build number, Product → Archive → TestFlight.

## Where things live

- `src/App.js` — the entire UI. Find components with `grep -n "^function <Name>" src/App.js`; line numbers drift, don't trust old ones.
- `src/utils/stats.js` + `stats.test.js` — ALL pure date/streak/aggregation logic. Change logic ⇒ change tests.
- `src/utils/fetchPaged.js` — `fetchAllPages()`; use it for any Supabase select that can exceed 1000 rows.
- `api/` — Vercel functions (streak cron, reminders, Maurice/Debbie). **Cannot import from `src/`** (CRA boundary); small helpers are duplicated intentionally.
- `schema.sql` — canonical DB schema + numbered idempotent migration blocks. Mirror every DB change here.

## The five rules that prevent broken stats

1. Days are **Melbourne calendar days**, `YYYY-MM-DD` strings. Use `todayKey`/`isoAddDays`/`mondayKeyOf` — never `new Date('YYYY-MM-DD')` math (UTC parse).
2. Day-of-week arrays are **Mon=0 … Sun=6**; weeks are Mon–Sun.
3. Filter completions with **`taps > 0`** — undo leaves `taps=0` rows behind.
4. **Shared habits mirror identical completion rows to every assignee** — dedupe by (habit, date) (`dedupeByHabitDay`) before any cross-member sum.
5. Streak semantics (product decisions, July 2026): a completed day = **any tap** (not target-met); habit streaks are **schedule-aware** (`days_active`); member streaks are **any-day**. Today is always "in progress" — it never breaks a streak.

## Data flow in 30 seconds

Boot: if a same-day boot cache exists (`src/utils/bootCache.js`), the UI paints the last session's full state instantly and the server revalidates in the background — merged so on-screen progress can rise but never visibly drop (inviolable rule: a child's progress must never render as less than it truly is, not even for a frame). Cold boot: auth session (or saved PIN) → family + members + habits + rewards ∥ one paged week-completions query (today derived from it) → UI unblocks. Completions upsert on (habit_id, member_id, date); optimistic updates go to `todayCompletions` and are overlaid on the week via `mergeLiveToday`. Insights lazily pulls **full completion history** (slim columns, paginated, 5-min cache) and computes streaks/records live; DB `streak` columns are just caches maintained by `handleComplete`/undo/backfill + the 1am streak-reset cron.

## Working conventions for this repo

- Branch off `main`; everything is reviewed before merge. Commit per logical fix, cite `file:line` in messages.
- **Never `git add -A`** — stage only files you changed (Xcode and other sessions leave working-tree noise).
- DB migrations: **idempotent SQL only**, run via the Supabase SQL editor, mirrored into `schema.sql` — and **ask before running anything against production**.
- `npm test` and `npm run build` must pass before every commit.

## Current state / gotchas (July 2026)

- Auth is mid-migration: PIN login and Supabase email auth coexist (`families.account_holder_id`, Phase 1). Staged RLS for Phase 3 is **commented out** in schema.sql §22 — activating it before backfill locks everyone out.
- Former schema drift (`members.push_token`, `habits.reminder_time`) is reconciled in schema.sql block 23 / `migrations/2026-07-03_reconcile-drifted-columns.sql`; verify production types match `text` when running it.
- Points writes are read-then-write (no atomic increment) — known race under concurrent multi-device use.
- A streak/stats correctness pass with unit tests landed on `ritual-dustoff` (July 2026); see `git log --oneline` for the series before assuming a stats bug is unfixed.
- `test-results/` is Playwright output — should be gitignored, don't commit it.
