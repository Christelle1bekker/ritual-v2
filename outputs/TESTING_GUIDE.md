# Wave 3.2 Testing Guide

## My Stats View

Select a member (e.g. Christelle) → ensure "My Stats" toggle is active.

- [ ] **Your Weekly Summary** card appears at top with her completions/streak/best habit
- [ ] **Family Highlights** does NOT appear
- [ ] **Kids Leaderboard** does NOT appear
- [ ] **Streak Watch** is titled "Your Streaks" and shows only her streak (not all 4 members)
- [ ] **When You Work Best** shows her personal time patterns (3 buckets)
- [ ] **Habit Health** shows only her assigned habits
- [ ] **Personal Bests** shows her individual records

## Family View

Click "Family" toggle.

- [ ] **Family Highlights** appears (Household Hero, Streak Champion, etc.)
- [ ] **Kids Leaderboard** appears (if family has kids)
- [ ] **Streak Watch** is titled "Everyone's Streaks" and shows all members
- [ ] **Your Weekly Summary** does NOT appear
- [ ] **When You Work Best** shows household patterns

## Time Buckets

Open Insights → When You Work Best.

- [ ] Shows exactly 3 rows: Morning, Afternoon, Evening
- [ ] Percentages add up to 100% (may vary by 1% due to rounding)
- [ ] A habit completed at 9pm shows in Evening bucket

## Empty States

If a member has no data:

- [ ] **When You Work Best** shows "Complete more habits to see when you're most productive! 🌟"
- [ ] **Habit Health** shows "Track habits for a week to see health trends! 📈"
- [ ] **Personal Bests** shows "Complete more habits to unlock achievements! 🎉"

## Timestamp Accuracy (Part 4)

1. Complete a habit at a known time (e.g. 9pm)
2. Go to Supabase Table Editor → `completions` table
3. Check `completed_at` column — should show a UTC timestamp that converts to ~9pm in your local timezone
4. Insights → When You Work Best → should show in Evening bucket
