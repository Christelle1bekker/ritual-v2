import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getMelbourneTime() {
  const now = new Date();
  // UTC+11 (AEDT) — adjust for AEST (UTC+10) when needed, but app uses UTC+11
  const melbourne = new Date(now.getTime() + 11 * 60 * 60 * 1000);
  const hh = String(melbourne.getUTCHours()).padStart(2, '0');
  const mm = String(melbourne.getUTCMinutes()).padStart(2, '0');
  return { timeStr: `${hh}:${mm}`, dateStr: melbourne.toISOString().split('T')[0] };
}

function makeApnsJwt() {
  const key = Buffer.from(process.env.APNS_AUTH_KEY, 'base64').toString('utf8');
  return jwt.sign({}, key, {
    algorithm: 'ES256',
    keyid: process.env.APNS_KEY_ID,
    issuer: process.env.APNS_TEAM_ID,
    expiresIn: '1h',
  });
}

async function sendPush(deviceToken, title, body) {
  const jwtToken = makeApnsJwt();
  const apnsUrl = `https://api.push.apple.com/3/device/${deviceToken}`;
  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: 'default' },
  });
  const res = await fetch(apnsUrl, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwtToken}`,
      'apns-topic': 'com.ritualhabits.app',
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    },
    body: payload,
  });
  return res.ok;
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (secret && auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { timeStr, dateStr } = getMelbourneTime();
  console.log(`[reminders] cron fired at Melbourne time ${timeStr} (date: ${dateStr})`);

  // Diagnostic: count members with push tokens
  const { data: tokenCheck } = await supabase.from('members').select('id').not('push_token', 'is', null);
  console.log(`[reminders] members with push_token: ${tokenCheck?.length ?? 0}`);

  // Diagnostic: count habits with any reminder_time set
  const { data: reminderCheck } = await supabase.from('habits').select('id').not('reminder_time', 'is', null);
  console.log(`[reminders] habits with reminder_time set: ${reminderCheck?.length ?? 0}`);

  // Find habits with reminder_time in a 5-minute window around current Melbourne time
  const [hh, mm] = timeStr.split(':').map(Number);
  const times = [];
  for (let delta = 0; delta < 5; delta++) {
    const totalMins = hh * 60 + mm + delta;
    const th = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
    const tm = String(totalMins % 60).padStart(2, '0');
    times.push(`${th}:${tm}`);
  }
  console.log(`[reminders] checking reminder_time window: ${times.join(', ')}`);

  const { data: habits, error: habitsErr } = await supabase
    .from('habits')
    .select('id, name, family_id, assigned_member_ids, reminder_time')
    .in('reminder_time', times);

  if (habitsErr || !habits?.length) {
    console.log(`[reminders] no habits due — reason: ${habitsErr?.message || 'none in window'}`);
    return res.status(200).json({ ok: true, sent: 0, reason: habitsErr?.message || 'No habits due' });
  }
  console.log(`[reminders] habits due in this window: ${habits.length}`);

  let sent = 0;
  const apnsJwt = makeApnsJwt();

  for (const habit of habits) {
    // Find assigned member IDs (null/empty = everyone in the family)
    let memberIds = habit.assigned_member_ids;
    if (!memberIds?.length) {
      const { data: famMembers } = await supabase
        .from('members')
        .select('id')
        .eq('family_id', habit.family_id);
      memberIds = (famMembers || []).map(m => m.id);
    }

    if (!memberIds?.length) continue;

    // Find which members haven't completed it today
    const { data: completions } = await supabase
      .from('completions')
      .select('member_id')
      .eq('habit_id', habit.id)
      .eq('date', dateStr)
      .gt('taps', 0);

    const completedIds = new Set((completions || []).map(c => c.member_id));
    const pendingIds = memberIds.filter(id => !completedIds.has(id));
    if (!pendingIds.length) continue;

    // Get push tokens for any pending member with a registered device.
    const { data: members } = await supabase
      .from('members')
      .select('id, name, push_token')
      .in('id', pendingIds)
      .not('push_token', 'is', null);

    for (const member of (members || [])) {
      if (!member.push_token) continue;
      const ok = await sendPush(
        member.push_token,
        `Time for: ${habit.name}`,
        `${member.name}, don't forget your ritual!`
      );
      if (ok) sent++;
    }
  }

  console.log(`[reminders] done — notifications sent: ${sent}`);
  return res.status(200).json({ ok: true, sent });
}
