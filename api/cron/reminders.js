import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import http2 from 'node:http2';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getMelbourneTime() {
  // Intl.DateTimeFormat with timeZone 'Australia/Melbourne' handles the
  // AEST (UTC+10, winter) / AEDT (UTC+11, summer) DST transition automatically.
  // en-CA produces YYYY-MM-DD date parts natively, and hour12:false gives 24h time.
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map(p => [p.type, p.value])
  );
  return {
    timeStr: `${parts.hour}:${parts.minute}`,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
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

function sendPush(deviceToken, title, body) {
  return new Promise((resolve) => {
    const jwtToken = makeApnsJwt();
    const payload = JSON.stringify({
      aps: { alert: { title, body }, sound: 'default' },
    });

    const client = http2.connect('https://api.push.apple.com');
    client.on('error', (err) => {
      console.error('[apns] connection error:', err.message);
      resolve(false);
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${jwtToken}`,
      'apns-topic': 'com.ritualhabits.app',
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    });

    let responseStatus = 0;
    let responseBody = '';

    req.on('response', (headers) => {
      responseStatus = headers[':status'];
    });
    req.on('data', (chunk) => { responseBody += chunk; });
    req.on('end', () => {
      client.close();
      if (responseStatus === 200) {
        resolve(true);
      } else {
        console.error(`[apns] send failed: ${responseStatus} ${responseBody}`);
        resolve(false);
      }
    });
    req.on('error', (err) => {
      console.error('[apns] request error:', err.message);
      client.close();
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
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
    console.log(`[reminders] no habits due — reason: ${habitsErr?.message || 'none in window'} — checked window: ${times.join(', ')} — habits in DB with reminder_time set: ${reminderCheck?.length ?? 0}`);
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

    // Kid profiles never hold a device token — their reminders are delivered
    // to every adult device in the family (the parent's phone is the device).
    const { data: pendingMembers } = await supabase
      .from('members')
      .select('id, name, push_token')
      .in('id', pendingIds);

    const { data: adults } = await supabase
      .from('members')
      .select('push_token')
      .eq('family_id', habit.family_id)
      .eq('is_kid', false)
      .not('push_token', 'is', null);
    const adultTokens = [...new Set((adults || []).map(a => a.push_token))];

    for (const member of (pendingMembers || [])) {
      // Adults with their own registered device get their own reminder;
      // everyone else's goes to the family's adult devices.
      const targets = member.push_token ? [member.push_token] : adultTokens;
      for (const target of targets) {
        const ok = await sendPush(
          target,
          `Time for: ${habit.name}`,
          `${member.name}, don't forget your ritual!`
        );
        if (ok) sent++;
      }
    }
  }

  console.log(`[reminders] done — notifications sent: ${sent}`);
  return res.status(200).json({ ok: true, sent });
}
