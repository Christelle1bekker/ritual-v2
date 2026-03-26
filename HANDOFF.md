# Ritual App — Claude Code Handoff

> Paste this entire file at the start of a new Claude Code session.

---

## Project in one sentence

**Ritual** is a family habit-tracking app built with React 18 (CRA) + Supabase (PostgreSQL), deployed on Vercel. Physical NFC stickers ("Tiles") placed around the home auto-complete habits when tapped with a phone.

---

## URLs & Services

| | |
|---|---|
| **Live app** | https://ritual-v2-mu.vercel.app |
| **Supabase dashboard** | https://supabase.com/dashboard/project/nupifxbhwfaqyjevmmde |
| **Vercel project** | `ritual-v2` under `christelle1bekkers-projects` |
| **Git repo** | `main` branch, last commit `fc8a3dc` |

---

## Local paths

```
C:/Users/Guest1/OneDrive/Desktop/Games/ritual-v2/   ← main working codebase
  src/App.js                                         ← entire frontend (~1500 lines, single file)
  schema.sql                                         ← canonical DB schema (up to date)
  public/
  package.json
```

---

## Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 (CRA), **single `App.js` file**, no routing library |
| Backend | Supabase (PostgreSQL + JS SDK) |
| Auth | 4-digit family PIN (no email/password) |
| Hosting | Vercel (auto-deploy from `main`) |
| Fonts | Cormorant Garamond (headings) + DM Sans (body) |
| CSS | Inline styles only + small `<style>` tag |

**No component files. No CSS files. Everything is in `src/App.js`.**

---

## Design Tokens (`C` object in App.js)

```js
sand: '#E8E0D5'      sandLight: '#F2EDE7'    sandDark: '#C9BFB3'
slate: '#3D4A4F'     slateLight: '#5A6B72'
accent: '#C17B4E'    // terracotta — primary CTA
green: '#5C7A5E'
kids: '#E8854A'      // orange, for kids habits
white: '#FAF8F5'
```

---

## Database Schema (current, production-verified as of 2026-03-15)

```sql
-- families
id uuid PK, name text, pin text, created_at timestamptz

-- members
id uuid PK, family_id uuid FK, name text, avatar text, color text,
is_kid boolean, points integer default 0, streak integer default 0

-- habits  ← KEY TABLE — see notes below
id uuid PK,
family_id uuid FK,
name text,
icon text,
category text,
category_id text,
color text,
location text,
target integer default 1,
streak integer default 0,
is_kid boolean default false,
is_custom boolean default false,
tile_uid text,
is_shared boolean default true,
points integer default 10,
assigned_member_ids uuid[],          -- NULL = everyone; array = specific members
daysActive text[],                   -- NULL = every day; array of day names

-- completions
id uuid PK, habit_id uuid FK, member_id uuid FK, family_id uuid FK,
date date, taps integer default 1
UNIQUE(habit_id, member_id, date)

-- rewards
id uuid PK, family_id uuid FK, name text, points integer, icon text,
who text, color text
```

### habits.assigned_member_ids — important rules

- `NULL` = habit is for **everyone** in the family
- `ARRAY[uuid1]` = assigned to one specific person
- `ARRAY[uuid1, uuid2]` = assigned to multiple specific people
- If **all** family members are selected → stored as `NULL` (same as "Everyone")
- GIN index exists: `idx_habits_assigned_member_ids`

---

## App Structure (5 tabs)

```
Today       → personal habit list for current member + hold-to-complete
Family      → all members' progress view
Add         → browse habit templates OR create custom habit
Insights    → streaks, points, completion charts
Settings    → manage members, manage habits, NFC tile assignment
```

---

## Key UX Patterns

- **Hold-to-complete** — 1 second press-and-hold fills a ring, then logs the habit (prevents accidental taps)
- **NFC tile tap** — URL `?tile=<UID>` or `/t/<UID>` path → auto-finds matching habit → completes it
- **CompletionFlash** — full-screen celebration animation + 10-second undo window
- **Who did this? overlay** — shown for kids habits or multi-person habits when it's ambiguous who completed it
- **Tile tap routing logic** (in `handleTileTap`):
  - `isKid` habit OR no assigned members → show "Who did this?" overlay
  - Assigned to exactly 1 person → auto-complete for that person
  - Assigned to multiple people including current member → auto-complete for current member
  - Otherwise → show overlay

---

## `normalizeHabit` — the shape used everywhere in React state

```js
{
  id, familyId, name, icon, category, categoryId, color,
  location, target, streak, isKid, isCustom, tileUid,
  isShared,                        // boolean
  points,                          // integer
  assignedMemberIds,               // null | uuid[]   ← NEW (was assignedMemberId string)
  daysActive,                      // null | string[]
}
```

---

## Multi-select habit assignment (completed 2026-03-15)

### What changed

**Old:** `assigned_member_id uuid` (single person or NULL)
**New:** `assigned_member_ids uuid[]` (array or NULL)

### App.js changes made (commit `fc8a3dc`)

1. **`normalizeHabit`** — reads `h.assigned_member_ids || null`
2. **`myHabitsWithTaps` filter** — `h.assignedMemberIds.includes(currentMember.id)`
3. **`handleAddHabit`** — writes `assigned_member_ids: h.assignedMemberIds || null`
4. **`handleEditHabit`** — `if ('assignedMemberIds' in updates) dbUpdates.assigned_member_ids = ...`
5. **Tile tap logic** — replaced single-person check with multi-person routing (see above)
6. **ManageHabitsScreen** — checkbox UI instead of radio buttons; badge shows "👥 Everyone" / "👤 Name" / "👤 Name, Name"
7. **AddScreen** — `habitSelectedMembers[]` / `customSelectedMembers[]` arrays (was string-based)

### DB migrations run (production)

```sql
-- 1. Added missing columns (migrations #2 and #3 that were never run)
ALTER TABLE habits ADD COLUMN IF NOT EXISTS is_shared boolean default true;
ALTER TABLE habits ADD COLUMN IF NOT EXISTS points integer default 10;

-- 2. Multi-select migration
ALTER TABLE habits ADD COLUMN IF NOT EXISTS assigned_member_ids UUID[];
CREATE INDEX IF NOT EXISTS idx_habits_assigned_member_ids ON habits USING GIN (assigned_member_ids);
UPDATE habits SET assigned_member_ids =
  CASE WHEN assigned_member_id IS NULL THEN NULL
       ELSE ARRAY[assigned_member_id] END
  WHERE assigned_member_ids IS NULL;
ALTER TABLE habits DROP COLUMN IF EXISTS assigned_member_id;
DROP INDEX IF EXISTS idx_habits_assigned_member;
```

---

## What is NOT yet built

| Feature | Notes |
|---|---|
| Streak auto-increment/reset | Field exists in DB, no logic written |
| Real-time sync | No Supabase Realtime subscriptions |
| Push notifications | Nudge button is UI-only, no backend |
| Reward redemption | Button renders, no action on click |
| Add rewards from UI | Only 3 seeded defaults exist |
| Delete habits | Not implemented |
| Edit/rename habits | Not implemented (habits can be edited in ManageHabitsScreen but the full edit form isn't wired) |

---

## How to run locally

```bash
cd C:/Users/Guest1/OneDrive/Desktop/Games/ritual-v2
npm start       # dev server on localhost:3000
npm run build   # production build (should be zero warnings)
```

## How to deploy

Push to `main` → Vercel auto-deploys (takes ~2 min). Check status at:
https://vercel.com/christelle1bekkers-projects/ritual-v2

---

## Supabase access

SQL editor: https://supabase.com/dashboard/project/nupifxbhwfaqyjevmmde/sql

All schema changes should also be reflected in `schema.sql` in the repo.

---

## App.js orientation (key line numbers — approximate, verify with grep)

| Section | What it does |
|---|---|
| `~L1–80` | Constants, design tokens (`C`), habit templates, category list |
| `~L83` | `normalizeHabit()` |
| `~L100–400` | Data fetching (`loadFamily`, `loadHabits`, `loadCompletions`) |
| `~L400–600` | Write operations (`handleAddHabit`, `handleEditHabit`, `handleComplete`) |
| `~L600–900` | NFC / tile handling (`handleTileTap`) |
| `~L900–1100` | Today screen + `myHabitsWithTaps` filter |
| `~L1100–1300` | AddScreen (template browser + custom habit form) |
| `~L1300–1500` | ManageHabitsScreen, SettingsScreen, InsightsScreen |

---

*Generated 2026-03-15 — commit `fc8a3dc`*
