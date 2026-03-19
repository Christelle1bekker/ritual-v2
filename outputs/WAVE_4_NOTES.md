# Wave 4 — Points & Rewards

**Date:** March 19, 2026
**Build size:** 118.62 kB gzip (was 115.8 kB)
**Files changed:** `src/App.js`, `schema.sql`

---

## What Changed

### Part 1 — Per-habit point values

**Previously:** Every habit completion always awarded exactly 10 points (hardcoded).

**Now:** Each habit has its own point value (default 10), configurable when adding or editing.

- `normalizeHabit`: now includes `points: h.points || 10`
- `handleComplete` / `handleUndo`: use `habit.points || 10` instead of literal `10`
- **CompletionFlash**: shows `+{habit.points} points` (was always "+10 points")
- **Add habit — "setTarget" view**: new "Points per completion" pill selector (5, 10, 15, 25, 50 pts)
- **Add custom ritual**: same points picker added before the Completion tracking section
- **Manage Habits edit form**: same points picker added after the "Times per day" stepper

---

### Part 2 — Manage Rewards (Add tab)

The rewards view in the Add/Set Up tab was previously a read-only list. It's now a full management screen.

**New UI:**
- **Emoji picker** — 20 preset reward icons
- **Name field** — text input
- **Points cost picker** — pill buttons: 100, 250, 500, 750, 1000, 2000
- **Who can redeem** — "👥 Everyone" or "⭐ Kids only"
- **Edit button** on each existing reward (loads form pre-filled)
- **Delete button** on each existing reward (archives in DB; shows confirm dialog)
- **Add / Save Changes** button

**New handlers in RitualApp:** `handleAddReward`, `handleEditReward`, `handleDeleteReward`

Delete archives (sets `status = 'archived'`) rather than hard deleting, to preserve redemption history.

---

### Part 3 — Functional Redeem flow (Family tab)

**Previously:** "Redeem" button was visual only — non-functional.

**Now:** Full redeem, pending, and fulfil/cancel flow.

#### Rewards display
- Filters rewards to what's relevant to `currentMember` (Kids-only rewards hidden from adults)
- Shows member's current point balance below the header
- Redeem button is enabled (coloured) if member has enough points
- Disabled state shows "Need X more pts"

#### Redeem confirmation sheet
- Tapping "Redeem" opens a bottom sheet with reward details and remaining balance preview
- Confirm deducts points optimistically, creates a `reward_redemptions` row (`status = 'pending'`)
- Parent note: "A parent will need to approve and fulfil this reward"

#### Pending Requests section
- Shows above the rewards list when there are pending redemptions
- **Adults** see all family pending requests — can mark ✓ Done (fulfilled) or ✕ cancel (refunds points)
- **Kids** see only their own pending requests (no action buttons)
- Shows redeemer name, reward icon/name, points spent, and request date

**New handlers in RitualApp:** `handleRedeemReward`, `handleFulfillRedemption`, `handleCancelRedemption`

**New state in RitualApp:** `redemptions` (array), `redemptionsLastFetched` (ref)
Redemptions are lazy-loaded when the Family tab is opened (refreshes every 60 seconds).

---

### Part 4 — Database

**`normalizeReward`** — new normaliser function (used in `fetchFamilyData` and `handleAddReward`):
- Maps `assigned_to`, `status` fields
- `fetchFamilyData` now runs rewards through `normalizeReward`

**`schema.sql` — Migration step 14** (new):
```sql
alter table rewards add column if not exists assigned_to uuid[];
alter table rewards add column if not exists status text default 'active';
create table if not exists reward_redemptions (...);
-- + indexes and comments
```

**SQL to run on production DB:**
```sql
-- Wave 4: Reward columns
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS assigned_to uuid[];
ALTER TABLE rewards ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_rewards_status ON rewards(status) WHERE status = 'active';

-- Wave 4: Redemptions table
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id uuid REFERENCES rewards(id) ON DELETE CASCADE,
  member_id uuid REFERENCES members(id) ON DELETE CASCADE,
  family_id uuid REFERENCES families(id) ON DELETE CASCADE,
  points_spent integer NOT NULL,
  redeemed_at timestamp DEFAULT now(),
  status text DEFAULT 'pending',
  fulfilled_at timestamp,
  notes text,
  created_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_redemptions_member ON reward_redemptions(member_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_status ON reward_redemptions(status);
CREATE INDEX IF NOT EXISTS idx_redemptions_family ON reward_redemptions(family_id, status);
```

---

## Testing Checklist

### Per-habit points
- [ ] Add a new habit → points picker shows (5, 10, 15, 25, 50) → default is 10
- [ ] Select 25 pts → add habit → complete it → CompletionFlash shows "+25 points"
- [ ] Member's point balance increments by 25 (not 10)
- [ ] Edit habit in Manage Habits → change points to 50 → save → next completion awards 50
- [ ] Undo a completion → points deducted by correct amount

### Manage Rewards
- [ ] Set Up tab → Manage Rewards → see emoji picker, name, cost, who
- [ ] Add a reward → appears in list immediately
- [ ] Edit a reward → form pre-fills → save → list updates
- [ ] Delete a reward → confirm dialog → removed from list

### Redeem flow
- [ ] Family tab → Rewards Available section shows filtered rewards
- [ ] Member with enough points → Redeem button is coloured and clickable
- [ ] Member without enough points → shows "Need X more pts" (greyed out)
- [ ] Tap Redeem → confirmation sheet appears with correct balance preview
- [ ] Confirm → points deducted from member → pending request appears
- [ ] Adult view → Pending Requests section shows → "✓ Done" fulfils it → disappears
- [ ] Adult cancels → points refunded to member
- [ ] Kid view → only their own pending requests shown (no action buttons)

### Points display
- [ ] CompletionFlash: shows dynamic points ("+25 points" not "+10 points")
- [ ] Family tab header: member points update after completion

---

## Deployment

```bash
git add src/App.js schema.sql
git commit -m "Wave 4: Per-habit points + functional rewards redemption

Features:
- Configurable per-habit point values (5/10/15/25/50 pts)
  - Add/edit habit forms include points picker
  - handleComplete/handleUndo use habit.points
  - CompletionFlash shows dynamic point value
- Full manage rewards UI in Set Up tab
  - Add/edit/delete rewards with emoji, name, cost, who
  - handleAddReward, handleEditReward, handleDeleteReward
- Functional Redeem flow in Family tab
  - Redeem button checks affordability, shows confirmation
  - Creates reward_redemptions row (pending status)
  - Pending requests section for parents to fulfil/cancel
  - Kids see their own pending requests only
- DB: reward_redemptions table + rewards.assigned_to/status columns
- normalizeReward function, fetchFamilyData uses it"

git push origin main
```
