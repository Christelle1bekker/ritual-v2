// api/cron-streaks.js
// Wave 6: Daily streak reset cron job
// Runs at 3:00 PM UTC daily (= 1am AEST / 2am AEDT)
// Resets streaks to 0 for any habit or member that had no completions yesterday

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service role key — NOT the anon key
);

function getYesterdayMelbourne() {
  // Subtract 24h then express in Melbourne timezone to get Melbourne's yesterday
  return new Date(Date.now() - 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
}

// Mon=0 … Sun=6 for a YYYY-MM-DD string (same convention as habits.days_active)
function dayIndexOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

// PostgREST silently caps un-ranged selects at 1000 rows; page through instead.
// buildQuery must return a fresh, deterministically-ordered builder each call.
async function fetchAllPages(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

export default async function handler(req, res) {
  // Security: only allow Vercel cron calls or requests with CRON_SECRET
  const authHeader = req.headers['authorization'];
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const yesterday = getYesterdayMelbourne();
  console.log(`Running streak reset for date: ${yesterday}`);

  try {
    // 1. Get all habits (paged — an un-ranged select caps at 1000 rows)
    const habits = await fetchAllPages(() => supabase
      .from('habits')
      .select('id, family_id, streak, days_active')
      .order('id', { ascending: true }));

    // 2. Get all completions from yesterday (taps > 0 only)
    const completions = await fetchAllPages(() => supabase
      .from('completions')
      .select('habit_id, member_id')
      .eq('date', yesterday)
      .gt('taps', 0)
      .order('id', { ascending: true }));

    const completedHabitIds = new Set(completions.map(c => c.habit_id));
    const completedMemberIds = new Set(completions.map(c => c.member_id));

    // 3. Reset habit streaks where no completion yesterday.
    // Skip habits that weren't scheduled yesterday (days_active, Mon=0):
    // a Mon/Wed/Fri habit must not be reset on Wednesday morning for an
    // empty Tuesday.
    const yesterdayIdx = dayIndexOf(yesterday);
    const habitsToReset = habits
      .filter(h => h.streak > 0
        && !completedHabitIds.has(h.id)
        && (!h.days_active || h.days_active.length === 0 || h.days_active.includes(yesterdayIdx)))
      .map(h => h.id);

    if (habitsToReset.length > 0) {
      const { error: hrErr } = await supabase
        .from('habits')
        .update({ streak: 0 })
        .in('id', habitsToReset);
      if (hrErr) throw hrErr;
    }

    // 4. Get all members (paged)
    const members = await fetchAllPages(() => supabase
      .from('members')
      .select('id, streak')
      .order('id', { ascending: true }));

    // 5. Reset member streaks where no completion yesterday
    const membersToReset = members
      .filter(m => m.streak > 0 && !completedMemberIds.has(m.id))
      .map(m => m.id);

    if (membersToReset.length > 0) {
      const { error: mrErr } = await supabase
        .from('members')
        .update({ streak: 0 })
        .in('id', membersToReset);
      if (mrErr) throw mrErr;
    }

    console.log(`Streak reset complete. Habits reset: ${habitsToReset.length}, Members reset: ${membersToReset.length}`);

    return res.status(200).json({
      success: true,
      yesterday,
      habitsReset: habitsToReset.length,
      membersReset: membersToReset.length,
    });

  } catch (err) {
    console.error('Streak reset error:', err);
    return res.status(500).json({ error: err.message });
  }
}
