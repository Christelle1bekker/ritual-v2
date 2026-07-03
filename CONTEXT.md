# Ritual v2 — Full Project Context

> Regenerated 2026-07-03 from the actual code on branch `ritual-dustoff`.
> The previous version of this file described the March-2026 web-only app and was badly stale.
> When this document and the code disagree, trust the code.

## What is Ritual?

Ritual is a **family habit-tracking app**: physical NFC stickers ("Tiles") placed around the home log habits when tapped with a phone. Warm, calm design (linen tones, serif headings, no gamification gimmicks). It ships as:

- a **native iOS app** (`com.ritualhabits.app`) — Capacitor 8 shell around the React app, distributed via TestFlight
- a **web app** at https://ritual-v2-mu.vercel.app (also the NFC-tap landing target)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 (CRA), **one ~6,350-line `src/App.js`**, no routing library, inline styles |
| Pure logic | `src/utils/stats.js` (dates/streaks/aggregation, unit-tested), `src/utils/fetchPaged.js` |
| Native shell | Capacitor 8: push notifications (APNs), haptics, NFC (`@capgo/capacitor-nfc`), splash, browser, preferences |
| OTA updates | `@capgo/capacitor-updater` (`autoUpdate: false` — bundles pushed deliberately, `notifyAppReady()` guards rollback) |
| Backend | Supabase (PostgreSQL via PostgREST + RPCs; Supabase Auth being phased in) |
| Serverless | Vercel functions in `api/` (streak cron, reminders, Maurice/Debbie Telegram bots) |
| Hosting | Vercel, auto-deploy on push to `main` |
| Tests | Jest via `react-scripts` — `npm test` (suites in `src/utils/*.test.js`) |

## Repo layout

```
ritual-v2/
├── src/
│   ├── App.js              ← entire UI (~6,350 lines; components listed below)
│   ├── index.js            ← entry: Capgo notifyAppReady, error boundary, render
│   ├── supabase.js         ← client init (Capacitor Preferences as auth storage on native)
│   ├── hooks/useNfcScanner.js
│   └── utils/
│       ├── stats.js        ← date/streak/aggregation helpers (UNIT-TESTED — edit with tests)
│       ├── fetchPaged.js   ← fetchAllPages(): pages past PostgREST's silent 1000-row cap
│       └── capacitorAuth.js
├── api/                    ← Vercel serverless functions (CANNOT import from src/)
│   ├── cron-streaks.js     ← daily streak reset (Vercel cron, 15:00 UTC = 1am AEST/2am AEDT)
│   ├── cron/reminders.js   ← habit reminders (Vercel cron, every 5 min)
│   ├── daily-report.js     ← "Maurice" daily health/usage report (cron-job.org, 06:30 AEST)
│   ├── telegram-webhook.js ← Maurice on-demand commands (Ritual Ops Telegram group)
│   ├── social-report.js    ← "Debbie" social/market scan (cron-job.org, few×/week)
│   ├── debbie-webhook.js   ← Debbie on-demand commands (Telegram)
│   └── nudge.js
├── lib/                    ← shared code for api/ functions
│   ├── maurice-core.js     ← health checks, usage queries, Telegram/email plumbing
│   └── debbie-core.js      ← Haiku + web-search + Apify Instagram scan
├── ios/App/                ← Xcode project (open App.xcodeproj, NOT a workspace)
├── migrations/             ← one-off SQL (idempotent; run in Supabase SQL editor)
├── schema.sql              ← canonical schema + numbered migration blocks (see drift note!)
├── scripts/                ← icon/splash generators (jimp/sharp)
├── spike/                  ← NFC-scanning spike docs + TestFlight handoff notes
├── capacitor.config.ts
└── vercel.json             ← crons, /t/:uid redirect, SPA rewrite, AASA header
```

## Core data conventions (violate these and stats break)

1. **The canonical "day" is a Melbourne calendar day** (`Australia/Melbourne`). All date keys are `YYYY-MM-DD` strings from `todayKey()`. Never do date math via `new Date('YYYY-MM-DD')` (parses as UTC midnight) — use `isoAddDays`/`mondayKeyOf` from `src/utils/stats.js`.
2. **Day-of-week arrays are Mon=0 … Sun=6** (`habits.days_active`; `null`/`[]` = every day). Weeks run Monday–Sunday.
3. **Completions are unique per (habit_id, member_id, date)**; `taps` increments per scan. **Undo leaves a `taps=0` row** — always filter `taps > 0`.
4. **Shared habits (`completion_type='shared'`) mirror one identical completion row to every assignee.** Any cross-member aggregation must dedupe by (habit, date) (`dedupeByHabitDay`) or it multiplies by family size.
5. **A "completed day" for streaks = any tap (`taps > 0`)**, deliberately not `taps >= target` (product decision, July 2026). The Today-screen "done" ring does use `taps >= target`.
6. **Streaks are schedule-aware for habits** (unscheduled days don't break them; `calcStreakFromDates(dates, todayStr, activeDays)`), **but member streaks are deliberately any-day** ("showed up" = completed anything).
7. **PostgREST silently caps un-ranged selects at 1000 rows.** Any query that can grow must go through `fetchAllPages` with a deterministic `.order()`.

## Database schema (Supabase)

`schema.sql` is the canonical record — read it; it is genuinely current except for the drift noted below. Summary:

- `families` — id, name, pin (NOT unique; login is name+PIN via `login_family` RPC), `is_solo`, `account_holder_id → auth.users` (nullable, auth-migration Phase 1)
- `members` — family_id, name, avatar, color, is_kid, points, streak, onboarding_complete
- `habits` — family_id, name/icon/category/color, location, target, streak, is_kid, is_custom, `tile_uid` (normalized NFC UID), is_shared, points, `assigned_member_ids uuid[]` (NULL = everyone), `days_active integer[]` (Mon=0), `completion_type` ('individual'|'shared')
- `completions` — habit_id, member_id, family_id, date, taps, completed_at, `backfilled_at` (set by "mark done yesterday"), UNIQUE(habit_id, member_id, date)
- `rewards` — family_id, name, points, icon, who, color, `assigned_to uuid[]`, status
- `reward_redemptions` — reward/member/family, points_spent, status pending|fulfilled|cancelled
- `maurice_health` — single-row bot heartbeat table (`migrations/2026-04-11_maurice-health.sql`)
- RPCs: `login_family`, `create_family`, `create_family_with_account_holder` (all SECURITY DEFINER)

⚠️ **Schema drift:** `members.push_token` and `habits.reminder_time` are used by the app but are **not in schema.sql** — they were added directly in the Supabase dashboard. Fold them into schema.sql next time it's touched.

**RLS is currently `using (true)` on all app tables** (PIN gates access at app level only). Staged account-holder policies for auth Phase 3 are written but **commented out** in schema.sql §22 — do not activate before `account_holder_id` backfill.

## Auth (transitional — two parallel systems)

1. **PIN**: family name + 4-digit PIN → `login_family` RPC; saved in `localStorage.ritual_savedPin`/`ritual_savedFamilyName`.
2. **Supabase email auth** (Netflix-style: one auth user owns a family via `families.account_holder_id`; members are in-app profiles). Sessions persist in Capacitor Preferences on native. Boot tries the auth session first, then falls back to saved PIN.

## Boot sequence (first meaningful paint)

`index.js` (Capgo `notifyAppReady`, error boundary) → render → mount effect: `supabase.auth.getSession()` → (auth path: families → members ∥ habits ∥ rewards; PIN path: `login_family` RPC → same three) → `fetchWeekAndTodayCompletions` (one paged query; today derived locally) → `setMounted(true)` unblocks the UI. Until then a "◈ Loading…" screen shows (native splash auto-hides at first paint). Analytics history is **not** fetched at boot — lazily on first Insights visit, 5-minute cache, invalidated on complete/undo/backfill/date-change.

## Insights & streaks

- `fetchAnalyticsData` pulls the family's **full completion history**, slimmed to `habit_id, member_id, date, taps` with `taps>0` server-side, paginated. Feeds all live Insights metrics: member/habit streaks, streak watch, weekly summary, habit formation (66-day), habit health, kids leaderboard, personal bests (true all-time records).
- `habits.streak` / `members.streak` in the DB are **caches**: incremented in `handleComplete`, reverted on undo, recomputed on backfill, reset overnight by `api/cron-streaks.js` (skips habits not scheduled yesterday). Insights prefers live computation and falls back to the DB value while analytics loads.
- All pure calculation logic lives in `src/utils/stats.js` with tests in `stats.test.js`. **Add a test when you change it.**

## NFC tiles

- Habit ↔ tile via `habits.tile_uid` (UID normalized: separators stripped, uppercased).
- URL formats: path `https://…/t/{uid}` (production; `t.ritualhabits.com.au/:uid` 301s there via vercel.json) and legacy `?tile={uid}`. Parsed by `parseTileUrl`.
- In-app scanning via `useNfcScanner` (`@capgo/capacitor-nfc`); deep links arrive through the Capacitor `appUrlOpen` listener. Associated domain: `applinks:app.ritualhabits.com.au`.
- Tap routing: shared/kid/unassigned/ambiguous → "Who did this?" overlay; single assignee → auto-complete.

## Scheduled jobs & bots

| Job | Trigger | What |
|---|---|---|
| `api/cron-streaks.js` | Vercel cron `0 15 * * *` (1am AEST/2am AEDT) | Resets stale habit/member streak caches for yesterday (schedule-aware, paged) |
| `api/cron/reminders.js` | Vercel cron `*/5 * * * *` | Habit reminder push notifications (`reminder_time`) |
| Maurice (`daily-report`, `telegram-webhook`) | cron-job.org 06:30 AEST + Telegram | Health-first daily report + on-demand ops checks; APNs via HTTP/2 |
| Debbie (`social-report`, `debbie-webhook`) | cron-job.org few×/week + Telegram | Social/market/behavioural-science scans (Haiku + web search + Apify) |

Secrets used by `api/`: `SUPABASE_SERVICE_KEY`, `CRON_SECRET`, `MAURICE_CRON_SECRET`, Telegram bot tokens, APNs key — all in Vercel env settings.

## UI component map (all in App.js — grep for `^function <Name>`)

`LoginScreen` (create/join/auth flows) · `TodayScreen` (adult) / `KidsTreeView` (kids tree-growth view) · `HabitCard` (hold-to-complete) · `CompletionFlash` (5s undo window) · `WhoDidThis` · `InactiveDayModal` · `CelebrationOverlay` · `FamilyScreen` (members, points, redemptions) · `AddScreen` (templates + custom habits + rewards) · `ManageHabitsScreen` (edit/delete/backfill) · `ManageTilesScreen` / `AssignTileModal` · `InsightsScreen` (stats cards, My Stats/Family toggle) · `SettingsScreen` · `ManageScreen` · `OnboardingFlow` · `PinInput`.

Modes: **solo mode** (`families.is_solo` + localStorage) hides family UI; **kids** get the tree view and orange styling.

## Environments & deployment

- **Web**: push to `main` → Vercel auto-deploys (~2 min). `REACT_APP_SUPABASE_URL` / `REACT_APP_SUPABASE_ANON_KEY` in Vercel env + `.env.local` for dev.
- **iOS**: bump build number in Xcode, Product → Archive → TestFlight (see `spike/c4-xcode-handoff.md` for the exact click-path). OTA JS updates via Capgo (manual channels; `autoUpdate: false`).
- **Supabase**: project `nupifxbhwfaqyjevmmde`. Schema changes = idempotent SQL in the dashboard editor, mirrored into `schema.sql` (and `migrations/` for one-offs).

## Known issues / current state (July 2026)

- Points writes are read-then-write (no atomic increment RPC) — concurrent completions on two devices can drop points.
- RLS is open until auth-migration Phase 3 (staged policies in schema.sql §22).
- Schema drift: `push_token`, `reminder_time` missing from schema.sql (see above).
- Docs history: streak/stats correctness pass + unit tests landed on `ritual-dustoff` (July 2026) — see `git log` for the fix series.
- `lib/maurice-core.js` usage queries are un-paged (reports undercount past 1000 rows; cosmetic).
