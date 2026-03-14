# Ritual v2 — Full Project Context

## What is Ritual?

Ritual is a **family habit-tracking app** built with **React (CRA)** and **Supabase** (PostgreSQL backend), deployed on **Vercel**. It's designed around physical NFC tags (called "Tiles") placed around the home — you tap your phone to a tile to log a habit. The app is intentionally minimal, warm, and calm in design (think: linen tones, serif headings, no gamification gimmicks).

**Live URL:** https://ritual-v2-mu.vercel.app

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 (CRA), single `App.js` file (~1450 lines), no routing library |
| Backend | Supabase (PostgreSQL + REST API via JS SDK) |
| Auth | PIN-based (no email/password — family enters a 4-digit PIN) |
| Hosting | Vercel (auto-deploys from GitHub on push to `main`) |
| Fonts | Cormorant Garamond (headings) + DM Sans (body) via Google Fonts |
| CSS | Inline styles only + a small `<style>` tag for global/responsive rules |

---

## File Structure

```
ritual-v2/
├── src/
│   ├── App.js          ← entire app (~1450 lines, single file)
│   └── supabase.js     ← Supabase client init
├── schema.sql          ← DB schema (run once in Supabase SQL editor)
├── .env.local          ← local dev env vars (REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY)
├── .env.local.example  ← template
└── package.json
```

---

## Database Schema (Supabase / PostgreSQL)

All tables have Row Level Security enabled with `using (true)` policies (open access — PIN handles auth).

### `families`
```sql
id uuid PK, name text, pin text UNIQUE, created_at timestamp
```

### `members`
```sql
id uuid PK, family_id uuid FK→families, name text, avatar text (first letter of name),
color text (hex), is_kid boolean, points integer, streak integer, created_at timestamp
```

### `habits`
```sql
id uuid PK, family_id uuid FK→families, name text, icon text (emoji),
category text, category_id text, color text (hex), location text (tile location),
target integer (taps/day), streak integer, is_kid boolean, is_custom boolean,
tile_configured boolean, created_at timestamp
```

### `completions`
```sql
id uuid PK, habit_id uuid FK→habits, member_id uuid FK→members,
family_id uuid FK→families, date date, taps integer,
completed_at timestamp,
UNIQUE(habit_id, member_id, date)
```

### `rewards`
```sql
id uuid PK, family_id uuid FK→families, name text, points integer,
icon text (emoji), who text, color text, created_at timestamp
```

---

## App Architecture

### State (in `RitualApp` root component)
```js
family          // { id, name, pin, members[], habits[], rewards[] }
habits          // raw habits from DB (no tap data)
todayCompletions  // completions for today from DB
weekCompletions   // completions for this Mon–Sun from DB
currentMember   // which family member is active (shown in header)
tab             // "today" | "family" | "add" | "insights" | "settings"
flashData       // triggers full-screen completion animation
whoDidThis      // triggers member-selection overlay (for kids' habits)
```

### Key Computed Values (useMemo)
```js
habitsWithTaps  // habits merged with todayCompletions → adds .taps, .completedById, .completedBy
weekData        // [null|number, ...] × 7 — % complete per day this week (null = future)
```

### Data Flow
1. **App mount** → checks `localStorage.ritual_savedPin` → auto-logs in if valid
2. **Login** → `fetchFamilyData(pin)` → loads family + members + habits + rewards
3. **After login** → `fetchTodayCompletions()` + `fetchWeekCompletions()` run in parallel
4. **Habit tap** → optimistic update to `todayCompletions` state + background Supabase upsert
5. **Points** → optimistic update to `family.members[].points` + background Supabase update

### Supabase Helper Functions (module-level)
```js
fetchFamilyData(pin)         // families + members + habits + rewards in one query
fetchTodayCompletions(id)    // completions for today
fetchWeekCompletions(id)     // completions for Mon–Sun of current week
```

### Normaliser Functions
Convert Supabase snake_case → camelCase for React state:
```js
normalizeMember(m)    // is_kid → isKid, family_id → familyId, etc.
normalizeHabit(h)     // category_id → categoryId, tile_configured → tileConfigured, etc.
normalizeCompletion(c) // habit_id → habitId, member_id → memberId, etc.
```

---

## Component Structure

```
RitualApp (root)
├── LoginScreen         — welcome/create family/join family/add members
├── WhoDidThis          — overlay: "who completed this?" (kids habits)
├── CompletionFlash     — full-screen animation on tap (10s countdown + undo)
├── HabitCard           — single habit row with hold-to-complete + tile expand
├── TodayScreen         — hero progress + week chart + habit grid
├── FamilyScreen        — member list + points + rewards
├── AddScreen           — menu → add habit / custom ritual / rewards / tile setup
├── InsightsScreen      — stats cards (streaks, top habit, points, etc.)
└── SettingsScreen      — family info + PIN display + sign out
```

---

## Tabs (5)

| Tab | Icon | Content |
|---|---|---|
| Today | ◈ | Progress hero, week bar chart, habit grid |
| Family | ◉ | Member cards with points + streaks + nudge button |
| Add | ⊕ | Add habit / custom ritual / manage rewards / tile setup |
| Insights | ◎ | Stats cards |
| Settings | ⚙ | Family PIN, member list, sign out |

---

## How Tiles Work

1. Each habit has a `location` (e.g. "Bedroom door") and a `tile_configured` flag
2. In **Add → Tile Setup**, the URL for each habit is: `https://ritual-v2-mu.vercel.app?habit={uuid}`
3. User copies the URL, programs it onto an NFC sticker (tile)
4. When tapped, the app opens, reads `?habit=` param, finds the habit, and calls `handleComplete`
5. The `?habit=` param is then cleared from the URL (`window.history.replaceState`)
6. Once a tile is configured (URL copied), it shows "✅ Configured" and hides the URL (with a "Show URL" button to reveal it again)

---

## Key UX Details

- **Active member** — shown in top-right header as coloured avatar circles. Active one: scale 1.25 + glow ring + full opacity. Others: 0.4 opacity + grayscale. Click to switch.
- **Hold to complete** — habit cards don't complete on single tap. User must hold for ~1s (fills progress bar) OR tap through the expanded tile view. This prevents accidental completions.
- **Undo** — CompletionFlash shows "Undo tap · 10s" button. Also long-press on a completed card to undo.
- **Kids habits** — orange/warm styling, show "Who did this?" overlay instead of completing directly (for parents to assign to a child)
- **Custom rituals** — emoji picker (40 options) + name + location + target count (1–20) + category
- **Week chart** — only today's column shows the % number. Past days show height only. Future days are greyed out.
- **PIN** — only shown in Settings tab. Removed from family header and family tab subtitle.

---

## Design Tokens

```js
const C = {
  sand: "#E8E0D5", sandLight: "#F2EDE7", sandDark: "#C9BFB3",
  slate: "#3D4A4F", slateLight: "#5A6B72", slateDark: "#2A3438",
  warm: "#8B7355", warmLight: "#A08C6E",
  accent: "#C17B4E", accentLight: "#D4956A",  // terracotta/copper — primary CTA colour
  green: "#5C7A5E", greenLight: "#7A9E7C",
  white: "#FAF8F5", offwhite: "#F5F0EB",
  kids: "#E8854A", kidsLight: "#F0A070",       // brighter orange for kids habits
  kidsBlue: "#5B8DB8", kidsPurple: "#9B7EC8",
  error: "#C0504D",
};
```

---

## Responsive Layout

```css
/* Mobile (default): 390px wide, single column habits */
.ritual-root { max-width: 390px; margin: 0 auto; }
.habit-grid  { display: flex; flex-direction: column; gap: 10px; }
.tab-bar     { width: 390px; }

/* Desktop (768px+): 900px wide, 2-column habit grid */
@media (min-width: 768px) {
  .ritual-root { max-width: 900px; }
  .habit-grid  { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .tab-bar     { width: 900px; }
}
```

---

## Vercel Environment Variables

Both set in Vercel project settings → All Environments:

```
REACT_APP_SUPABASE_URL=https://nupifxbhwfaqyjevmmde.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## Habit Categories (built-in templates)

8 categories, each with 5–7 preset habits:
1. **Family & Chores** (🏠) — make bed, clear table, dishwasher, trash, feed pet, tidy room, school bag
2. **Health & Body** (💊) — medication AM/PM, water (target 8), vitamins, stretch, weigh in, skincare
3. **Screen-Free Time** (📵) — phone down at dinner/bedtime, homework focus, family screen-free hour
4. **Morning Routine** (☀️) — wake up, coffee/breakfast, brush teeth, exercise, journal, priorities, no phone 30min
5. **Learning & Growth** (📖) — read, instrument, language, study, podcast, flashcards
6. **Mindfulness** (🧘) — meditate, gratitude, wind-down, breathing, digital detox, pray/reflect
7. **Fitness** (🏋️) — workout, evening walk, stretching, water log, meal prep, recovery
8. **Kids Special** (⭐) — homework, reading, instrument, help with dinner, be kind, screen-free, outdoor play

---

## What's NOT Yet Built / Possible Next Steps

- **Streak logic** — `streak` field exists in DB but isn't incremented automatically yet (no server-side logic / cron). Currently always shows 0 unless manually updated.
- **Real-time sync** — currently no Supabase Realtime subscriptions. Data refreshes on login only.
- **Push notifications** — no nudge delivery (the "Nudge 👋" button updates local state only, doesn't send anything)
- **Reward redemption** — "Redeem" button renders but has no action
- **Multi-device sync for member selection** — `currentMember` is saved to localStorage per device, not DB
- **Streak auto-reset** — if you miss a day, streak doesn't reset automatically
- **Add rewards** — can view rewards but can't add new ones from the app (only the 3 seeded defaults)
- **Delete habits** — no delete habit functionality in the UI yet
- **Habit editing** — can add and configure habits but not rename/edit them after creation

---

## Supabase Project Details

- **Project URL:** https://nupifxbhwfaqyjevmmde.supabase.co
- **Region:** (auto-assigned)
- **Auth:** disabled (PIN-based, uses anon key with open RLS policies)

---

## Git / Deployment

- **Repo:** GitHub (connected to Vercel for auto-deploy)
- **Branch:** `main`
- **Latest commit:** `171bc10 — Migrate to Supabase backend + 9 UX fixes`
- **Vercel project:** `ritual-v2` under `christelle1bekkers-projects`
- **Production alias:** https://ritual-v2-mu.vercel.app
