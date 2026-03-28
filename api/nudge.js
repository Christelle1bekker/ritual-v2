import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function makeApnsJwt() {
  const key = Buffer.from(process.env.APNS_AUTH_KEY, 'base64').toString('utf8');
  return jwt.sign({}, key, {
    algorithm: 'ES256',
    keyid: process.env.APNS_KEY_ID,
    issuer: process.env.APNS_TEAM_ID,
    expiresIn: '1h',
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { memberId, familyId, title, body } = req.body;
  if (!memberId || !familyId || !title || !body) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: member, error } = await supabase
    .from('members')
    .select('push_token')
    .eq('id', memberId)
    .single();

  if (error || !member?.push_token) {
    return res.status(200).json({ ok: false, reason: 'No push token for member' });
  }

  const token = makeApnsJwt();
  const bundleId = 'com.ritualhabits.app';
  const apnsUrl = `https://api.push.apple.com/3/device/${member.push_token}`;

  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: 'default', badge: 1 },
  });

  const apnsRes = await fetch(apnsUrl, {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'content-type': 'application/json',
    },
    body: payload,
  });

  if (!apnsRes.ok) {
    const errBody = await apnsRes.text();
    console.error('❌ APNs error:', apnsRes.status, errBody);
    return res.status(502).json({ error: 'APNs delivery failed', detail: errBody });
  }

  return res.status(200).json({ ok: true });
}
