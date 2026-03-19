# Ritual v2 — Project Context
**Last updated:** March 19, 2026 — after Wave 4.1

## What is Ritual?

Ritual is a family habit-tracking app built for NFC tile taps. Family members tap physical NFC tiles placed around the home to log habit completions. The app tracks streaks, points, and weekly progress, with a rewards system kids can redeem points against. Designed for iOS Safari (iPhone SE and newer) as a PWA-style web app.

**Production URL:** https://ritual-v2-mu.vercel.app
**Supabase project:** `nupifxbhwfaqyjevmmde`
**GitHub repo:** https://github.com/Christelle1bekker/ritual-v2
**Vercel:** auto-deploys from `main` branch push

---

## Tech Stack

| Layer    | Technology                                              |
|----------|---------------------------------------------------------|
| Frontend | React 18 (Create React App)                             |
| Styling  | Inline styles only — design token object `C`            |
| Database | Supabase (PostgreSQL + JS SDK v2 `^2.99.1`)             |
| Auth     | PIN-based family login (no user accounts)               |
| Hosting  | Vercel (auto-deploy from `main`)                        |
| NFC      | Web NFC API + URL routing (`?tile=` / `/t/`)            |
| Fonts    | DM Sans + Cormorant Garamond (Google Fonts, HTML preload) |

## File Structure

```
ritual-v2/
  src/
    App.js        3132 lines — entire frontend (single-file, no component splitting)
    index.js      ~65 lines  — React root + ErrorBoundary class
    supabase.js   9 lines    — Supabase client init (null-safe if env vars missing)
  schema.sql      207 lines  — DB schema + all 14 migration steps
  package.json    CRA config, @supabase/supabase-js ^2.99.1
  public/
    index.html    Google Fonts preload links (added Wave 3)
  vercel.json     SPA rewrite rule
  outputs/        Snapshot files for session handoff (not deployed)
```

**Build size:** 119.47 kB gzip (as of Wave 4.1)

---

## Wave History

| Wave  | Date        | Summary                                                   |
|-------|-------------|-----------------------------------------------------------|
| 1+2   | Mar 17 2026 | Bug fixes, shared completion type, multi-member assignment, UX |
| 3     | Mar 17 2026 | Insights tab, daily reset detection, error boundary, cleanup |
| 3.1   | Mar 19 2026 | Fix duplicate % label, analytics member filter fix        |
| 3.2   | Mar 19 2026 | Insights UX improvements + tap race condition hotfix      |
| 3.3   | Mar 19 2026 | Timezone fix: remove JS `completed_at`, let DB default it |
| 4     | Mar 19 2026 | Per-habit points, manage rewards UI, functional redeem flow |
| 4.1   | Mar 19 2026 | Fix reward creation: + Add Reward in Family tab + 8 templates |

---

## Feature List (Current)

### Core habit tracking
- NFC tile tap → logs completion for a habit
- Per-member tap counts; `target` taps needed for full completion
- "Who did this?" overlay for shared/multi-member habits
- Optimistic UI with undo (5-second window via `CompletionFlash`)
- Audio + haptic feedback on completion (toggle in settings)

### Habits
- Browse preset templates by category (Morning, Evening, Kids, etc.)
- Create custom habits with emoji, name, icon, color, location
- Assign to specific members (`assigned_member_ids` uuid[])
- Set active days (`days_active` 0=Mon…6=Sun; null = daily)
- Completion type: **Individual** (each person tracked separately) or **Shared** (one completion syncs to all assigned members)
- Per-habit **point value** configurable (5 / 10 / 15 / 25 / 50 pts)
- Assign NFC tile to habit (tile_uid)
- Edit or delete habits via Manage Habits

### Points & Rewards
- Members earn points on each habit completion (`habit.points`, default 10)
- **Family tab** shows per-member point totals + combined household total
- **Add Reward** button in Family tab (adults only) — opens modal with:
  - 8 pre-built templates: dinner pick, movie night, screen time, stay up late, car music, weekend activity, $5 pocket money, $10 pocket money
  - Custom form: icon picker (20 emojis), name, points cost (25–500), who (Everyone / Kids only)
- Full **redeem flow**: kid taps Redeem → confirmation sheet → pending request created
- **Pending Requests** card: adults see all family requests; can mark Done (fulfilled) or cancel (refunds points)
- Kids see only their own pending requests
- Rewards can also be managed (add/edit/delete) in Set Up tab

### Analytics (Insights tab)
- **Family Highlights**: Household Hero, Streak Champion, Early Bird, Night Owl, Shared Task MVP, Most Consistent
- **Streak Watch**: per-member milestone countdowns (e.g. "1 day from 10-day streak!")
- **When You Work Best**: time-of-day distribution (Early / Morning / Afternoon / Evening / Night)
- **Habit Health**: week-over-week completion delta per habit (requires `analyticsData`)
- **Kids Leaderboard**: ranked by weekly taps (only shown if family has kids)
- **Personal Bests**: weekly record detection and streak highs
- My Stats / Family toggle on all cards
- Analytics lazy-loaded when Insights tab is opened; cached 5 min

### Other
- Daily reset detection (`checkDateBoundary`) on `visibilitychange` and before each completion
- Streak tracking (per member and per habit)
- React Error Boundary — graceful crash screen
- Settings: logout, refresh data, reset points & streaks, manage tiles, sound toggle

---

## Database Schema

### `families`
| Column     | Type      | Notes                |
|------------|-----------|----------------------|
| id         | uuid PK   | gen_random_uuid()    |
| name       | text      | Display name         |
| pin        | text      | Unique login PIN     |
| created_at | timestamp |                      |

### `members`
| Column     | Type      | Notes                              |
|------------|-----------|------------------------------------|
| id         | uuid PK   |                                    |
| family_id  | uuid FK   | → families.id CASCADE              |
| name       | text      |                                    |
| avatar     | text      | Single character (first letter)    |
| color      | text      | Hex from MEMBER_COLORS palette     |
| is_kid     | boolean   | Controls kid-specific habit/reward visibility |
| points     | integer   | Default 0; mutated by completions and redemptions |
| streak     | integer   | Default 0                          |
| created_at | timestamp |                                    |

### `habits` (19 columns)
| Column              | Type      | Notes                                                     |
|---------------------|-----------|-----------------------------------------------------------|
| id                  | uuid PK   |                                                           |
| family_id           | uuid FK   | → families.id CASCADE                                     |
| name                | text      |                                                           |
| icon                | text      | Emoji                                                     |
| category            | text      | Display category name                                     |
| category_id         | text      | Slug                                                      |
| color               | text      | Hex color                                                 |
| location            | text      | Optional room/location label                              |
| target              | integer   | Taps needed for full completion (default 1)               |
| streak              | integer   | Default 0                                                 |
| is_kid              | boolean   | Legacy — prefer `assigned_member_ids`                     |
| is_custom           | boolean   | User-created vs template                                  |
| tile_uid            | text      | NFC UID: no colons, uppercase. e.g. `04969E5AC22A81`      |
| is_shared           | boolean   | true = show "Who did this?"; false = auto-assign to current member |
| points              | integer   | Per-habit point award on completion (default 10) — Wave 4 |
| assigned_member_ids | uuid[]    | NULL = everyone; array = specific members                 |
| days_active         | integer[] | 0=Mon…6=Sun; NULL = active daily                          |
| completion_type     | text      | `'individual'` or `'shared'` — Wave 2                     |
| created_at          | timestamp |                                                           |

**Constraint:** `completion_type IN ('individual', 'shared')`
**Indexes:** `idx_habits_tile_uid`, `idx_habits_assigned_members` (GIN), `idx_habits_completion_type`

### `completions`
| Column       | Type      | Notes                                              |
|--------------|-----------|----------------------------------------------------|
| id           | uuid PK   |                                                    |
| habit_id     | uuid FK   | → habits.id CASCADE                                |
| member_id    | uuid FK   | → members.id CASCADE                               |
| family_id    | uuid FK   | → families.id CASCADE                              |
| date         | date      | UTC calendar date (`todayKey()`)                   |
| taps         | integer   | Increments on each scan; 0 = incomplete            |
| completed_at | timestamp | Set by DB `now()` default (not JS — Wave 3.3 fix)  |
|              |           | UNIQUE (habit_id, member_id, date)                 |

**Indexes:** `idx_completions_family_date`, `idx_completions_habit_date`, `idx_completions_member_date`, `idx_completions_completed_at`

### `rewards`
| Column      | Type      | Notes                                           |
|-------------|-----------|-------------------------------------------------|
| id          | uuid PK   |                                                 |
| family_id   | uuid FK   | → families.id CASCADE                           |
| name        | text      |                                                 |
| points      | integer   | Cost in points to redeem                        |
| icon        | text      | Emoji                                           |
| who         | text      | `'Everyone'` or `'Kids'`                        |
| color       | text      | Hex (legacy field; not currently used in UI)    |
| assigned_to | uuid[]    | NULL = everyone; array = specific members — Wave 4 |
| status      | text      | `'active'` or `'archived'` (soft delete) — Wave 4 |
| created_at  | timestamp |                                                 |

**Index:** `idx_rewards_status` (partial, WHERE status = 'active')

### `reward_redemptions` (Wave 4)
| Column      | Type      | Notes                                                   |
|-------------|-----------|---------------------------------------------------------|
| id          | uuid PK   |                                                         |
| reward_id   | uuid FK   | → rewards.id CASCADE                                    |
| member_id   | uuid FK   | → members.id CASCADE                                    |
| family_id   | uuid FK   | → families.id CASCADE                                   |
| points_spent| integer   | Snapshot of cost at time of redemption                  |
| redeemed_at | timestamp | Default now()                                           |
| status      | text      | `'pending'` → `'fulfilled'` or `'cancelled'`            |
| fulfilled_at| timestamp | Set when parent marks Done                              |
| notes       | text      | Optional parent notes                                   |
| created_at  | timestamp |                                                         |

**Indexes:** `idx_redemptions_member`, `idx_redemptions_status`, `idx_redemptions_family`

---

## Key Application Logic

### Normalizer Functions

```js
normalizeHabit(h)      // DB row → camelCase JS; includes points: h.points || 10
normalizeMember(m)     // DB row → camelCase JS
normalizeReward(r)     // DB row → camelCase JS; maps assigned_to, status, who, color
normalizeCompletion(c) // DB row → camelCase JS; includes completedAt: c.completed_at
```

### Data Fetch Strategy

```
App login:       fetchFamilyData() — families + members + habits + rewards (all normalised)
App login:       fetchTodayCompletions() + fetchWeekCompletions()
Insights tab:    fetchAnalyticsData() — last 30 days; lazy, cached 5 min via analyticsLastFetched ref
Family tab:      fetchRedemptions() — pending only; lazy, refreshed every 60 s via redemptionsLastFetched ref
```

### Points Flow

```
handleComplete(habitId, member):
  1. habitPointValue = habit.points || 10
  2. Optimistic: update member.points + taps in local state
  3. Supabase upsert completions row
  4. Supabase rpc or update members set points = points + habitPointValue
  5. CompletionFlash shows "+{habitPointValue} points"

handleUndo(habitId):
  1. Reverses optimistic state
  2. Decrements DB member.points by habit.points || 10
  3. Deletes or decrements completion row
```

### Reward Redemption Flow

```
FamilyScreen:
  1. visibleRewards filtered by currentMember (kids-only hidden from adults; assigned_to respected)
  2. Redeem button: enabled if member.points >= reward.points
  3. Tap Redeem → setRedeemTarget(reward) → confirmation sheet
  4. Confirm → handleRedeemReward(rewardId, memberId):
       - Optimistic: deduct points from member in state
       - Insert reward_redemptions row (status = 'pending')
       - Reload redemptions

Adult fulfil:
  handleFulfillRedemption(redemptionId):
    - Update redemption status = 'fulfilled', fulfilled_at = now()
    - Remove from pendingRedemptions in state

Adult cancel:
  handleCancelRedemption(redemptionId, memberId, pointsToRefund):
    - Update redemption status = 'cancelled'
    - Refund points: members set points = points + pointsToRefund
    - Restore points in local state
```

### Completion Type Behavior

**`'individual'`** — Each member tracked independently. Tapping logs only to the tapping member.
**`'shared'`** — One completion syncs `taps` to all `assignedMemberIds`. Switching to shared mid-day backfills today's max taps to all members.

### Daily Reset Detection

```js
const checkDateBoundary = useCallback(() => {
  const today = todayKey();
  if (lastFetchDate && lastFetchDate !== today) {
    setLastFetchDate(today);
    // re-fetch todayCompletions + weekCompletions
    // invalidate analyticsData cache
  }
}, [lastFetchDate, family]);
// Called: on document visibilitychange + at start of every handleComplete
```

### Tile Tap Decision Tree

```
NFC tap → normalizeUID (strip colons, uppercase) → look up by tile_uid
  No habit found → AssignTileModal (link tile to habit or create new)
  Habit found:
    shouldAskWho = isKid || !assignedMemberIds || ids.length === 0 || ids.length > 1
    true  → WhoDidThis overlay (filtered to assigned members)
    false → check currentMember matches → handleComplete() or alert
```

### RitualApp — Key State

```js
// Core data
const [family, setFamily] = useState(null);          // { id, name, members[], rewards[] }
const [habits, setHabits] = useState([]);
const [todayCompletions, setTodayCompletions] = useState([]);
const [weekCompletions, setWeekCompletions] = useState([]);
const [currentMember, setCurrentMember] = useState(null);
const [redemptions, setRedemptions] = useState([]);

// UI
const [tab, setTab] = useState("today");
const [flashData, setFlashData] = useState(null);   // for CompletionFlash overlay
const [whoDidThis, setWhoDidThis] = useState(null); // habit waiting for member selection

// Analytics / caching
const [lastFetchDate, setLastFetchDate] = useState(() => todayKey());
const [analyticsData, setAnalyticsData] = useState(null);
const analyticsLastFetched = useRef(null);
const redemptionsLastFetched = useRef(null);
```

### Derived Memos

```js
habitsWithTaps     // all habits merged with today's completion taps for currentMember
myHabitsWithTaps   // filtered to habits assigned/visible to currentMember
```

---

## Component Map (App.js)

| Component / Function  | Line  | Purpose                                              |
|-----------------------|-------|------------------------------------------------------|
| `LoginScreen`         | ~339  | PIN entry + family creation                          |
| `WhoDidThis`          | ~534  | Overlay: pick which member completed a shared habit  |
| `CompletionFlash`     | ~583  | Full-screen flash with points, undo button           |
| `HabitCard`           | ~631  | Single habit tile with tap/undo                      |
| `TodayScreen`         | ~754  | Today tab: greeting, habit list, weekly chart        |
| `REWARD_TEMPLATES`    | 845   | 8 pre-built reward template objects                  |
| `REWARD_ICONS`        | 856   | 20 emoji options for custom rewards                  |
| `FamilyScreen`        | 858   | Family tab: members, points, pending redemptions, rewards |
| `AssignTileModal`     | ~1136 | Link an NFC tile UID to a habit                      |
| `ManageTilesScreen`   | ~1195 | List all tile assignments, remove tiles              |
| `ManageHabitsScreen`  | ~1296 | Edit/delete existing habits                          |
| `AddScreen`           | ~1449 | Set Up tab: browse templates, custom habit, manage rewards |
| `InsightsScreen`      | ~1912 | Insights tab: 6 analytics cards                      |
| `SettingsScreen`      | ~2341 | Logout, refresh, reset, manage tiles, sound toggle   |
| `RitualApp`           | ~2400 | Root component: all state, handlers, routing         |

---

## NFC URL Formats

```
Path-based (canonical): https://ritual-v2-mu.vercel.app/t/04969E5AC22A81
Query param (legacy):   https://ritual-v2-mu.vercel.app?tile=04:96:9E:5A:C2:2A:81
```

App normalizes UID on read: `raw.replace(/:/g, "").toUpperCase()`

---

## Known Limitations

1. **`is_shared` vs `completion_type`** — Two overlapping concepts. `is_shared` is still used in some "Who did this?" fallback paths alongside `completion_type`. Could be consolidated.
2. **`is_kid`** — Partially deprecated. Code uses it in some legacy paths; `assigned_member_ids` is the preferred mechanism.
3. **Streak logic** — Client-side only; no server cron to break streaks for missed days.
4. **`date` field uses UTC** — `todayKey()` returns UTC calendar date. For UTC+11 (Melbourne), taps before 11am local time land on the previous UTC date. Both save and fetch use the same key so it's consistent within a session, but can reset unexpectedly at UTC midnight.
5. **Single JS file** — App.js at 3132 lines. No component extraction into separate files.
6. **No offline support** — All reads/writes go directly to Supabase.
7. **No PWA manifest** — No `manifest.json` or app icons; Add to Home Screen uses screenshot fallback.
8. **No push notifications** — Reminder system not built.
9. **Habit deletion** — Accessible via Manage Habits UI, but no archive/soft-delete (hard delete).
10. **`rewards.color`** — Column exists in DB, set to a default on insert, but not surfaced in any UI.
