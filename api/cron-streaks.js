// api/cron-streaks.js
// Wave 6: Daily streak reset cron job
// Runs at 1:00 PM UTC daily (= midnight Melbourne time, AEDT UTC+11)
// Resets streaks to 0 for any habit or member that had no completions yesterday

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Service role key — NOT the anon key
);

function getYesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0]; // "YYYY-MM-DD"
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

  const yesterday = getYesterdayUTC();
  console.log(`Running streak reset for date: ${yesterday}`);

  try {
    // 1. Get all habits
    const { data: habits, error: hErr } = await supabase
      .from('habits')
      .select('id, family_id, streak');
    if (hErr) throw hErr;

    // 2. Get all completions from yesterday (taps > 0 only)
    const { data: completions, error: cErr } = await supabase
      .from('completions')
      .select('habit_id, member_id')
      .eq('date', yesterday)
      .gt('taps', 0);
    if (cErr) throw cErr;

    const completedHabitIds = new Set(completions.map(c => c.habit_id));
    const completedMemberIds = new Set(completions.map(c => c.member_id));

    // 3. Reset habit streaks where no completion yesterday
    const habitsToReset = habits
      .filter(h => h.streak > 0 && !completedHabitIds.has(h.id))
      .map(h => h.id);

    if (habitsToReset.length > 0) {
      const { error: hrErr } = await supabase
        .from('habits')
        .update({ streak: 0 })
        .in('id', habitsToReset);
      if (hrErr) throw hrErr;
    }

    // 4. Get all members
    const { data: members, error: mErr } = await supabase
      .from('members')
      .select('id, streak');
    if (mErr) throw mErr;

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
