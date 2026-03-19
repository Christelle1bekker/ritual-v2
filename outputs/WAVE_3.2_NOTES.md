# Wave 3.2 — Insights Tab UX Improvements

## Changes

### Part 1: My Stats vs Family view separation

**1A. Family Highlights** — now only shown in Family view (`showFamily === true`). Personal stats don't need a household leaderboard.

**1B. Kids Leaderboard** — now only shown in Family view. Comparative data belongs in the family context.

**1C. Your Weekly Summary** — new card at the top of My Stats view. Shows:
- Habits completed this week (count / possible, with %)
- Current streak
- Best habit this week (highest completion rate)
- Friendly nudge when no completions yet

**1D. Streak Watch** — now context-aware:
- My Stats: titled "Your Streaks", shows only the current member's streak
- Family: titled "Everyone's Streaks", shows all members (up to 4)

---

### Part 2: Simplified time-of-day buckets

Reduced from 5 buckets to 3, covering the full 24 hours with no gaps:

| Bucket | Hours |
|--------|-------|
| 🌅 Morning | 6am – 12pm |
| ☀️ Afternoon | 12pm – 6pm |
| 🌙 Evening | 6pm – 6am (wraps midnight) |

Previously: Early morning / Morning / Afternoon / Evening / Night — had gaps and didn't capture late-night completions cleanly.

---

### Part 3: Empty state messages

All analytics cards now show friendly, encouraging messages when no data exists:

- **When You Work Best**: "Complete more habits to see when you're most productive! 🌟"
- **Habit Health**: "Track habits for a week to see health trends! 📈"
- **Personal Bests**: "Complete more habits to unlock achievements! 🎉"

---

### Part 4: completed_at timestamp fix

The completion upsert now explicitly sets `completed_at: new Date().toISOString()`.

Previously relied on the Supabase server default `now()` (UTC server time). Now the client sends its own timestamp, which JavaScript's `new Date().toISOString()` converts to UTC. When read back, `new Date(c.completedAt).getHours()` correctly converts to the user's local timezone for time-of-day analytics.

---

## Testing

See `TESTING_GUIDE.md` for step-by-step verification.
