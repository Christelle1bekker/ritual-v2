# Wave 4.1 — Fix Reward Creation

**Date:** March 19, 2026
**Build size:** 119.47 kB gzip (was 118.62 kB)
**Files changed:** `src/App.js`

---

## Problem

Wave 4 buried reward creation inside the Set Up tab. Users couldn't find how to add rewards from the Family tab, and there were no examples to help new families get started.

## What Changed

### `REWARD_TEMPLATES` constant (new, above FamilyScreen)

8 pre-built templates:
- 🍕 Choose dinner — 50 pts, Everyone
- 🎬 Movie night pick — 75 pts, Everyone
- 📱 Extra screen time — 100 pts, Kids
- 🌙 Stay up 30 mins late — 150 pts, Kids
- 🎵 Car music choice — 25 pts, Everyone
- 🎡 Weekend activity pick — 200 pts, Everyone
- 💵 $5 pocket money — 50 pts, Kids
- 💰 $10 pocket money — 100 pts, Kids

### `REWARD_ICONS` constant (new)

20 emoji icons available in the icon picker.

### `FamilyScreen` — new prop: `onAddReward`

New state added:
- `showAddReward` — controls modal visibility
- `newRewardName`, `newRewardIcon`, `newRewardPoints`, `rewardAudience` — form fields
- `handleCreateReward` — validates and calls `onAddReward`, then resets form

### Rewards section header — `+ Add Reward` button

Visible to adults only (`!currentMember.isKid`). Opens the add reward modal.

### Empty state — improved

Previous: plain grey text "add them in the Set Up tab"
Now: centred emoji + heading + description + "Add First Reward" button (adults only)

### Add Reward modal

Bottom sheet with:
1. **8 template cards** — clicking one auto-populates all form fields (with active highlight)
2. **Divider + "Customise" section** for manual entry:
   - 20-icon emoji picker
   - Name text input
   - Points cost pill selector (25 / 50 / 75 / 100 / 150 / 200 / 500)
   - Who can redeem toggle (Everyone / Kids only)
3. Cancel + Add Reward buttons (Add disabled until name is filled)

### RitualApp render call

Added `onAddReward={handleAddReward}` to FamilyScreen (already implemented in Wave 4).

---

## Testing Checklist

- [ ] Family tab → Rewards section → "Rewards Available" header has "+ Add Reward" button (adults only, not shown for kids)
- [ ] Click "+ Add Reward" → modal opens with 8 template cards
- [ ] Click a template → form fields auto-populate (icon, name, points, audience)
- [ ] Click "Add Reward" → modal closes → reward appears in list
- [ ] Empty rewards state → shows emoji + text + "Add First Reward" button
- [ ] Click "Add First Reward" → same modal opens
- [ ] Kid view → no "+ Add Reward" button, no "Add First Reward" button

---

## Deployment

```bash
git add src/App.js
git commit -m "Wave 4.1: Fix reward creation & add templates

- + Add Reward button in Family tab rewards section (adults only)
- Improved empty state with action button
- Add Reward modal with 8 pre-built templates (dinner, movie, screen time,
  stay up late, car music, weekend activity, pocket money $5/$10)
- Templates auto-populate form fields on click
- Custom form: icon picker, name, points (25-500), who (Everyone/Kids)
- Wired onAddReward prop into FamilyScreen render call"

git push origin main
```
