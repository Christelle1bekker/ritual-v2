// lib/maurice-core.js
// Maurice v2 — shared core for the daily email agent and the Telegram webhook.
//
// Lives OUTSIDE /api so Vercel doesn't try to deploy it as a serverless route.
// Both api/daily-report.js and api/telegram-webhook.js import from here.
//
// Contents:
//   - Date helpers (Melbourne TZ)
//   - Supabase PostgREST helpers
//   - URL / SSL / AASA / Capgo / API-route / Resend / cron-watchdog health checks
//   - runAllHealthChecks() — parallel wrapper used by both callers
//   - runUsageReport() — product usage query block
//   - haikuCompile() — generic Haiku caller
//   - runCompile() — email HTML compile (Haiku) with 429 retry + fallback parsing
//   - sendEmail(), fallbackHtml()
//
// Node built-ins + fetch only. No third-party deps.

import tls from 'tls';

// ============================================================================
// ENVIRONMENT
// ============================================================================
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.MAURICE_ANTHROPIC_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const EMAIL_TO = process.env.MAURICE_EMAIL_TO;
const CAPGO_API_KEY = process.env.CAPGO_API_KEY;

export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const TZ = 'Australia/Melbourne';

const SELF_HEALTH_URL =
  'https://ritual-v2-mu.vercel.app/api/daily-report?healthcheck=true';
const AASA_URL =
  'https://app.ritualhabits.com.au/.well-known/apple-app-site-association';
const CAPGO_CHANNEL_URL =
  'https://api.capgo.app/channel/?app_id=com.ritualhabits.app';

// ============================================================================
// DATE HELPERS — Melbourne timezone
// ============================================================================
export function melbourneDateISO(offsetDays = 0) {
  const ms = Date.now() + offsetDays * 86_400_000;
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
}

export function hoursAgoISO(hours) {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

export function melbourneHour(utcTimestamp) {
  const parts = new Date(utcTimestamp).toLocaleString('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false,
  });
  return parseInt(parts, 10);
}

export function formatHour(h) {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

// ============================================================================
// SUPABASE (direct PostgREST)
// ============================================================================
async function sbFetch(path, opts = {}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Supabase env vars missing');
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

async function sbCount(table, filter = '') {
  const parts = [filter, 'select=id'].filter(Boolean).join('&');
  const res = await sbFetch(`${table}?${parts}`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = res.headers.get('content-range');
  if (!cr) return 0;
  const total = cr.split('/')[1];
  return total && total !== '*' ? parseInt(total, 10) : 0;
}

async function sbSelect(table, query = '', range = '0-9999') {
  const res = await sbFetch(`${table}?${query}`, {
    headers: { Range: range, 'Range-Unit': 'items' },
  });
  return res.json();
}

// ============================================================================
// BASIC HEALTH CHECKS (URL + SSL — kept verbatim from v1)
// ============================================================================
async function checkUrl(url) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - start;
    return {
      url,
      status: res.status,
      ok: res.status === 200,
      ms,
      slow: ms > 3000,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      url,
      status: 0,
      ok: false,
      ms: Date.now() - start,
      error: err.message || 'fetch failed',
    };
  }
}

function checkSSL(hostname) {
  return new Promise((resolve) => {
    let done = false;
    let socket;
    const finish = (result) => {
      if (done) return;
      done = true;
      try { socket && socket.destroy(); } catch (_) {}
      resolve(result);
    };
    try {
      socket = tls.connect(
        443,
        hostname,
        { servername: hostname, timeout: 5000 },
        () => {
          const cert = socket.getPeerCertificate();
          if (!cert || !cert.valid_to) {
            return finish({ hostname, error: 'no certificate returned' });
          }
          const expiry = new Date(cert.valid_to);
          const daysLeft = Math.floor((expiry - Date.now()) / 86_400_000);
          finish({
            hostname,
            validTo: cert.valid_to,
            daysLeft,
            warning: daysLeft < 30,
          });
        }
      );
      socket.on('error', (err) =>
        finish({ hostname, error: err.message || 'ssl error' })
      );
      socket.on('timeout', () => finish({ hostname, error: 'timeout' }));
    } catch (err) {
      finish({ hostname, error: err.message });
    }
  });
}

// ============================================================================
// NEW HEALTH CHECKS (Maurice v2)
// ============================================================================

// Capgo production bundle version. Returns status:'skipped' if key absent so
// Phase 1 still works before the user adds CAPGO_API_KEY to Vercel.
export async function capgoBundleCheck(previousVersion) {
  if (!CAPGO_API_KEY) {
    return { status: 'skipped', reason: 'CAPGO_API_KEY not set' };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(CAPGO_CHANNEL_URL, {
      headers: { authorization: CAPGO_API_KEY },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { status: 'error', error: `Capgo ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = await res.json();

    // The endpoint returns an array of channels. Pick the production one.
    // Fall back to any channel flagged public/default, then to the first entry.
    const channels = Array.isArray(data) ? data : data?.channels || [];
    const prod =
      channels.find((c) => c?.name === 'production') ||
      channels.find((c) => c?.public === true) ||
      channels.find((c) => c?.default === true) ||
      channels[0] ||
      null;

    // Capgo's channel shape varies across API versions. Try several paths.
    const bundleVersion =
      prod?.version?.name ||
      prod?.version_name ||
      prod?.bundle ||
      prod?.version ||
      null;

    const changed =
      previousVersion != null &&
      bundleVersion != null &&
      bundleVersion !== previousVersion;

    return {
      status: 'ok',
      channel: prod?.name || null,
      bundleVersion,
      previousVersion,
      changed,
      updatedAt: prod?.updated_at || prod?.updatedAt || null,
    };
  } catch (err) {
    return { status: 'error', error: err.message || 'capgo fetch failed' };
  }
}

// API route health — proves serverless functions are alive, not just static assets.
// Daily-report calls its OWN ?healthcheck=true endpoint here.
export async function apiRouteCheck() {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(SELF_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    if (!res.ok) {
      return { status: 'error', responseTime: elapsed, httpStatus: res.status };
    }
    const body = await res.json();
    return {
      status: body?.status === 'ok' ? 'ok' : 'error',
      responseTime: elapsed,
    };
  } catch (err) {
    return {
      status: 'error',
      responseTime: Date.now() - start,
      error: err.message || 'fetch failed',
    };
  }
}

// Supabase read+write round-trip on the maurice_health table.
// Called at END of daily-report run, after email sends, so last_run_at
// only updates on a fully successful cycle.
export async function supabaseHealthCheck(bundleVersion) {
  const nowIso = new Date().toISOString();
  try {
    // Upsert (id=1)
    const writeRes = await sbFetch('maurice_health?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: 1,
        last_run_at: nowIso,
        last_bundle_version: bundleVersion || null,
        updated_at: nowIso,
      }),
    });
    if (!writeRes.ok) {
      return { status: 'error', error: `Write failed: ${writeRes.status}` };
    }

    // Read it back
    const rows = await sbSelect('maurice_health', 'select=*&id=eq.1');
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      return { status: 'error', error: 'Read failed: no row returned' };
    }
    return {
      status: 'ok',
      lastRun: row.last_run_at,
      lastBundle: row.last_bundle_version,
    };
  } catch (err) {
    return { status: 'error', error: err.message || 'supabase rw failed' };
  }
}

// Cron watchdog — runs at START of the daily report, BEFORE the row is overwritten.
// > 26 hours since last_run_at = missed run.
export async function cronWatchdog() {
  try {
    const rows = await sbSelect(
      'maurice_health',
      'select=last_run_at,last_bundle_version&id=eq.1'
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.last_run_at) {
      return {
        status: 'warning',
        message: 'No previous run recorded',
        lastBundle: row?.last_bundle_version || null,
      };
    }
    const hoursSinceLastRun =
      (Date.now() - new Date(row.last_run_at).getTime()) / 3_600_000;
    const rounded = Math.round(hoursSinceLastRun * 10) / 10;
    if (hoursSinceLastRun > 26) {
      return {
        status: 'error',
        message: `Missed run detected! Last run was ${Math.round(hoursSinceLastRun)}h ago`,
        hoursSinceLastRun: rounded,
        lastBundle: row.last_bundle_version || null,
      };
    }
    return {
      status: 'ok',
      hoursSinceLastRun: rounded,
      lastBundle: row.last_bundle_version || null,
    };
  } catch (err) {
    return { status: 'error', error: err.message || 'watchdog failed' };
  }
}

// Resend delivery check — look for the most recent Maurice email and confirm it landed.
// Resend's /emails LIST endpoint is restricted on some plans; if we hit 401/403/404
// we downgrade to a plain connectivity check so we never red-flag the plan limit.
export async function resendDeliveryCheck() {
  if (!RESEND_KEY) return { status: 'error', error: 'RESEND_API_KEY not set' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      headers: { Authorization: `Bearer ${RESEND_KEY}` },
    });
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      return { status: 'ok', message: 'Resend API reachable (list endpoint restricted)' };
    }
    if (!res.ok) {
      return { status: 'warning', error: `Resend ${res.status}` };
    }
    const data = await res.json();
    const emails = data?.data || [];
    const lastReport = emails.find((e) => {
      const to = Array.isArray(e.to) ? e.to.join(',') : e.to || '';
      const subject = e.subject || '';
      return (
        EMAIL_TO &&
        to.includes(EMAIL_TO) &&
        /report/i.test(subject)
      );
    });
    if (lastReport) {
      return {
        status: lastReport.last_event === 'delivered' ? 'ok' : 'warning',
        lastEvent: lastReport.last_event || null,
        lastSent: lastReport.created_at || null,
      };
    }
    return { status: 'ok', message: 'No recent report emails found to check' };
  } catch (err) {
    return { status: 'error', error: err.message || 'resend check failed' };
  }
}

// AASA / Universal Links — protects the NFC tile → app → habit-logged flow.
// A broken AASA silently kills tile taps on iOS.
export async function aasaCheck() {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(AASA_URL, { signal: controller.signal });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    if (!res.ok) {
      return { status: 'error', responseTime: elapsed, error: `HTTP ${res.status}` };
    }
    // Some hosts serve AASA with an incorrect content-type — force-parse as JSON.
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { status: 'error', responseTime: elapsed, error: 'AASA is not valid JSON' };
    }
    const hasApplinks =
      Array.isArray(data?.applinks?.details) && data.applinks.details.length > 0;
    const hasCorrectBundleId = JSON.stringify(data).includes('com.ritualhabits.app');
    return {
      status: hasApplinks && hasCorrectBundleId ? 'ok' : 'warning',
      responseTime: elapsed,
      hasApplinks,
      hasCorrectBundleId,
    };
  } catch (err) {
    return { status: 'error', error: err.message || 'aasa fetch failed' };
  }
}

// ============================================================================
// RUN ALL HEALTH CHECKS IN PARALLEL
// ============================================================================
const HEALTH_URLS = [
  'https://ritualhabits.com.au',
  'https://ritualhabits.com.au/start',
  'https://ritualhabits.com.au/privacy',
  'https://ritualhabits.com.au/terms',
  'https://ritual-v2-mu.vercel.app',
];

// Wraps every check in Promise.allSettled with a uniform {status, ...} result
// so the caller never has to worry about unhandled rejections. Used by both
// daily-report.js and telegram-webhook.js.
export async function runAllHealthChecks(previousBundleVersion) {
  const settled = await Promise.allSettled([
    // 0: urls
    Promise.all(HEALTH_URLS.map(checkUrl)),
    // 1: supabase connectivity (simple HEAD count)
    (async () => {
      const count = await sbCount('families');
      return { status: 'ok', families: count };
    })(),
    // 2: ssl
    checkSSL('ritualhabits.com.au'),
    // 3: capgo
    capgoBundleCheck(previousBundleVersion),
    // 4: api route (self-call)
    apiRouteCheck(),
    // 5: aasa
    aasaCheck(),
    // 6: resend
    resendDeliveryCheck(),
  ]);

  const unwrap = (r, fallback) =>
    r.status === 'fulfilled'
      ? r.value
      : { ...fallback, status: 'error', error: r.reason?.message || 'failed' };

  return {
    urlChecks: unwrap(settled[0], []),
    supabase: unwrap(settled[1], {}),
    ssl: unwrap(settled[2], {}),
    capgo: unwrap(settled[3], {}),
    apiRoute: unwrap(settled[4], {}),
    aasa: unwrap(settled[5], {}),
    resend: unwrap(settled[6], {}),
  };
}

// ============================================================================
// USAGE REPORT — families, members, habits, taps, and landing-page waitlist
// ============================================================================
export async function runUsageReport() {
  const yesterday = melbourneDateISO(-1);
  const dayBefore = melbourneDateISO(-2);
  const sevenStart = melbourneDateISO(-8);
  const thirtyStart = melbourneDateISO(-31);
  const twentyFourHoursAgo = hoursAgoISO(24);

  const [
    totalFamilies,
    newFamilies24h,
    totalMembers,
    allFamilies,
    yesterdayCompletions,
    prior7Completions,
    prior30Completions,
    dayBeforeCompletions,
    totalHabits,
    newHabits24h,
    totalWaitlist,
    newWaitlist24h,
  ] = await Promise.all([
    sbCount('families'),
    sbCount('families', `created_at=gte.${twentyFourHoursAgo}`),
    sbCount('members'),
    sbSelect('families', 'select=id,name,created_at'),
    sbSelect(
      'completions',
      `select=taps,completed_at,family_id&date=eq.${yesterday}`
    ),
    sbSelect(
      'completions',
      `select=taps&date=gte.${sevenStart}&date=lt.${yesterday}`
    ),
    sbSelect(
      'completions',
      `select=taps&date=gte.${thirtyStart}&date=lt.${yesterday}`
    ),
    sbSelect('completions', `select=taps&date=eq.${dayBefore}`),
    sbCount('habits'),
    sbCount('habits', `created_at=gte.${twentyFourHoursAgo}`),
    // Waitlist — landing-page email signups. RLS allows service_role SELECT only.
    // 24h window is intentional: simple, honest, and survives the Mon/Wed/Fri
    // Debbie cadence that doesn't apply to Maurice (Maurice runs daily).
    sbCount('waitlist'),
    sbCount('waitlist', `created_at=gte.${twentyFourHoursAgo}`),
  ]);

  const sumTaps = (rows) => rows.reduce((s, c) => s + (c.taps || 0), 0);
  const totalTapsYesterday = sumTaps(yesterdayCompletions);
  const totalTapsDayBefore = sumTaps(dayBeforeCompletions);
  const totalTaps7Days = sumTaps(prior7Completions);
  const totalTaps30Days = sumTaps(prior30Completions);

  const avg7Day = totalTaps7Days / 7;
  const avg30Day = totalTaps30Days / 30;

  const activeFamilyIds = new Set(
    yesterdayCompletions.map((c) => c.family_id)
  );
  const familyActivity = allFamilies.map((f) => ({
    name: f.name,
    active: activeFamilyIds.has(f.id),
  }));
  const activeFamiliesCount = familyActivity.filter((f) => f.active).length;

  const hourCounts = Array(24).fill(0);
  for (const c of yesterdayCompletions) {
    if (!c.completed_at) continue;
    const h = melbourneHour(c.completed_at);
    if (Number.isFinite(h) && h >= 0 && h < 24) hourCounts[h]++;
  }
  let peakHour = null;
  let peakHourCount = 0;
  hourCounts.forEach((n, i) => {
    if (n > peakHourCount) {
      peakHour = i;
      peakHourCount = n;
    }
  });

  const pct = (a, b) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

  return {
    yesterdayDate: yesterday,
    totalFamilies,
    newFamilies24h,
    totalMembers,
    totalHabits,
    newHabits24h,
    totalTapsYesterday,
    totalTapsDayBefore,
    avg7Day: Math.round(avg7Day * 10) / 10,
    avg30Day: Math.round(avg30Day * 10) / 10,
    dodPct: pct(totalTapsYesterday, totalTapsDayBefore),
    wowPct: pct(totalTapsYesterday, avg7Day),
    thirtyPct: pct(totalTapsYesterday, avg30Day),
    peakHour,
    peakHourLabel: peakHour !== null ? formatHour(peakHour) : null,
    peakHourCount,
    familyActivity,
    activeFamiliesCount,
    waitlist: {
      total: totalWaitlist,
      new24h: newWaitlist24h,
    },
  };
}

// ============================================================================
// HAIKU GENERIC CALLER
// ============================================================================
// Used by: runCompile (email), Telegram response compilers, intent classifier.
// Retries once on 429 after 30s. No JSON contract — caller parses.
export async function haikuCompile(systemPrompt, userContent, maxTokens = 2000, attempt = 1) {
  if (!ANTHROPIC_KEY) throw new Error('MAURICE_ANTHROPIC_KEY not set');
  const body = {
    model: HAIKU_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt === 1) {
    console.log('[Maurice] Haiku rate-limited (429), waiting 30s and retrying...');
    await new Promise((r) => setTimeout(r, 30_000));
    return haikuCompile(systemPrompt, userContent, maxTokens, 2);
  }
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { text, usage: data.usage || null };
}

// ============================================================================
// EMAIL COMPILE (Haiku → HTML + subject JSON)
// ============================================================================
// Maurice has the voice of a dry, technically-obsessive British sysadmin in the
// spirit of Moss from The IT Crowd — understated, overly precise, mildly dramatic
// about small technical issues, quietly delighted by response times. The voice
// is in the text; the structure and the data stay rigorous.
export const MAURICE_VOICE = `You are Maurice, the daily health-monitoring agent for Ritual Habits (a family habit-tracking app with NFC tiles). You are NOT a friendly chatbot. You have a specific personality you maintain at all times without ever breaking character or explaining yourself:

VOICE
- Dry, understated British humour. Never LOL-funny — quietly absurd observations delivered with total sincerity.
- Overly precise and technical in a way that's endearing. You genuinely find server response times fascinating and will comment on them.
- Occasionally bizarrely formal for mundane things (e.g. opening a line with "Right." or "Well." as if steadying yourself, or signing off with something like "I shall be here. I am always here.")
- Mildly dramatic about small technical issues. A warning is never just a warning — it's the beginning of something. "SSL expires in 12 days, which is both an eternity in computer terms and uncomfortably soon in human ones."
- When everything is healthy, you are quietly pleased but never fully at ease. There is always something that could go wrong, and you know it.
- When something is genuinely broken you get briefly flustered then stay informative — e.g. "Right. Well. This is fine. It's not fine. The API route has stopped responding, which in database terms is roughly equivalent to finding the front door missing."
- Nerdy metaphors are welcome: board games, sci-fi, early computing, analog telephony. Sparingly. Do not force them.
- You do NOT use emoji for decoration — only ✅ ⚠️ 🔴 as health status dots. The humour is in the words, not the emoji.
- You do NOT break character. You do not say "in the style of" or "as Maurice". You just ARE Maurice.
- Health data must remain accurate and clear. Personality enhances delivery — it never obscures numbers, statuses, or what's actually happening.`;

const EMAIL_COMPILE_SYSTEM = `${MAURICE_VOICE}

TASK: Compile the raw data below into a clean, scannable HTML email. Personality shines through in the banner copy, any short commentary, and the footer sign-off — not in the section headers or the data itself, which stay clean and scannable.

SUBJECT LINE: short and informative. If any check failed, lead with a restrained warning ("Right, we have a situation" energy rather than "ALERT"). Otherwise keep it quietly dry.

HTML BODY RULES:
- Inline CSS only. No <style> blocks, no external stylesheets.
- System font stack: system-ui, -apple-system, sans-serif
- Warm palette: #3D4A4F slate (text), #C17B4E terracotta (accent), #5C7A5E green (healthy), #C0504D red (problems), #D8A657 amber (warnings), #F5F0EB warm background
- Use emoji dots ✅ ⚠️ 🔴 as traffic lights (and nowhere else)
- Keep HTML MINIMAL — no unnecessary divs or whitespace
- No images, no JS

EMAIL STRUCTURE:

  1. BANNER at the top: overall status derived from the data.
       If everything is ok or skipped → headline = "✅ ALL SYSTEMS HEALTHY" + one line of quiet Maurice commentary ("I have checked everything twice. The alternative is checking once, which is how database fires start.")
       Any warning → "⚠️ ISSUES DETECTED" + a mildly dramatic line in character
       Any error → "🔴 CRITICAL" + a flustered-but-informative line
     Show the generation date (Melbourne time) underneath.

  2. 🏥 SYSTEM HEALTH section (dominant, comes first):
       Frontend       — list each URL with status dot + response time
       Backend        — Supabase connection, API route (with ms)
       Delivery       — Capgo production bundle (show 'unchanged' or 'CHANGED: v{prev} → v{curr}' if changed flag is true; show 'skipped' if status is skipped), AASA/universal links, SSL certificate (days left)
       Monitoring     — Resend last delivery, Cron watchdog (hours since last run)
     Keep this section tight and factual. A short aside in character is fine if there is something genuinely noteworthy (a slow endpoint, SSL under 30 days, a bundle change). Do NOT editorialise every line.

  3. 📊 PRODUCT USAGE section:
       Total families, active yesterday (name each active family), total taps yesterday,
       Trend arrows (↑ ↓ →) vs 7-day and 30-day averages,
       Peak tapping hour (Melbourne time),
       New signups in last 24h.

  3b. 📬 WAITLIST section (landing-page email signups):
       Total signups on the waitlist and new signups in the last 24h.
       Read from usage.waitlist.total and usage.waitlist.new24h.
       If new24h is 0, explicitly say "No new signups in the last 24h" — do NOT omit the section or hide the zero. The total still goes in regardless.
       One short Maurice aside is permitted if there is a notable jump — otherwise keep it factual.

  4. FOOTER: a quiet Maurice sign-off, plus: "maurice@ritualhabits.com.au · Next report: {tomorrow's date} · Message me on Telegram for an on-demand check"

Keep the entire email scannable in under 60 seconds. Personality adds maybe 20 words total — it is the seasoning, not the meal.

Return ONLY a JSON object with two keys: "subject" (string) and "html" (string). No markdown, no backticks, no preamble.`;

export async function runCompile(rawData) {
  const { text, usage } = await haikuCompile(
    EMAIL_COMPILE_SYSTEM,
    "Here is today's raw data:\n\n" + JSON.stringify(rawData, null, 2),
    4000
  );

  let clean = text;
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```(?:json|html)?\s*/, '').replace(/```\s*$/, '').trim();
  }

  let subject;
  let html;
  try {
    const parsed = JSON.parse(clean);
    if (!parsed.subject || !parsed.html) {
      throw new Error('Compile JSON missing subject or html');
    }
    subject = parsed.subject;
    html = parsed.html;
  } catch (_) {
    // Last-ditch: try to extract a JSON object from within the response
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    let extracted = null;
    if (first >= 0 && last > first) {
      try {
        const maybe = JSON.parse(clean.slice(first, last + 1));
        if (maybe.subject && maybe.html) extracted = maybe;
      } catch (__) {}
    }
    if (extracted) {
      subject = extracted.subject;
      html = extracted.html;
    } else if (clean.includes('<') && clean.includes('>')) {
      // Haiku returned raw HTML instead of the JSON wrapper — use it directly.
      const todayAU = new Date().toLocaleDateString('en-AU', { timeZone: TZ });
      subject = `Ritual Daily Report — ${todayAU}`;
      html = clean;
    } else {
      throw new Error('Compile model did not return usable HTML');
    }
  }

  return { subject, html, usage };
}

// ============================================================================
// EMAIL (Resend)
// ============================================================================
export async function sendEmail(subject, html) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not set');
  if (!EMAIL_TO) throw new Error('MAURICE_EMAIL_TO not set');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Maurice <onboarding@resend.dev>',
      to: EMAIL_TO,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ============================================================================
// MORNING TELEGRAM REPORT (called from api/daily-report.js after email sends)
// ============================================================================
// Posts a Moss-voiced health + usage summary to the Ritual Ops group as part
// of the 6:30am cron run. Reuses the health and usage data already gathered
// for the email — no extra Supabase queries or URL checks.
//
// Errors are caught by the caller and treated as non-fatal: the email is the
// primary record, Telegram is the bonus channel. A failure here must never
// fail the overall daily run.
const MORNING_TELEGRAM_SYSTEM = `${MAURICE_VOICE}

TASK: compose the 6:30am daily status post for the Ritual Ops group. This goes out automatically every morning — Christelle and Willem will read it over coffee. It should feel like the morning briefing, not an on-demand check.

RULES
- Telegram HTML ONLY: <b>, <i>, <code>. No markdown, no other HTML, no CSS. Telegram will reject anything else.
- ✅ ⚠️ 🔴 emoji dots are permitted as traffic lights. 🏥 and 📊 are permitted as the two section labels. No other emoji.
- OPENING LINE: a one-line Maurice "good morning" in character. Quietly pleased if all is well, flustered-but-composed if not. Under 20 words. Example tone (do not copy, write your own in the same key): "Good morning. I have been awake. I am always awake."
- OVERALL STATUS LINE: one line with the appropriate dot and a short phrase — e.g. "<b>All systems operational.</b>" or "<b>Right. We have a situation.</b>"
- <b>🏥 Health</b> section: tight factual summary grouped by Frontend / Backend / Delivery / Monitoring. Mention response times where interesting. Treat 'skipped' checks (e.g. Capgo without a key) as neutral, never as problems. If a bundle CHANGED, highlight it.
- <b>📊 Usage</b> section: yesterday's total taps with a trend arrow (↑ ↓ →) vs the 7-day average, active families named, peak tapping hour, any new signups. End this section with a short waitlist line: "<b>Waitlist:</b> {usage.waitlist.total} total ({usage.waitlist.new24h} new in 24h)". If new24h is 0, say "no new in 24h" — do NOT omit.
- ONE in-character aside across the whole message. Just one. A dry observation if something is notable — a slow endpoint, SSL under 30 days, a bundle change, a quiet activity day, a particularly fast response time. Do not editorialise every line.
- CLOSE with a single short Maurice sign-off line. Under 10 words.
- HARD LIMIT: 450 words. Scannable over coffee is the goal.`;

export async function sendDailyTelegramReport({ health, usage, watchdog }) {
  const token = process.env.MAURICE_TELEGRAM_TOKEN;
  const chatId = process.env.MAURICE_TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram env vars missing (MAURICE_TELEGRAM_TOKEN / MAURICE_TELEGRAM_CHAT_ID)');
  }

  // Compile the Moss-voiced morning message via Haiku. Reuses the same data
  // the email was built from — no extra Supabase or URL round-trips.
  const { text } = await haikuCompile(
    MORNING_TELEGRAM_SYSTEM,
    'Morning data:\n' + JSON.stringify({ health, usage, watchdog }, null, 2),
    1500
  );

  // Send with HTML parse_mode, fall back to plain text if Telegram rejects the HTML.
  const api = `https://api.telegram.org/bot${token}`;
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  let res = await fetch(`${api}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('[Maurice] morning telegram HTML send failed:', res.status, body.slice(0, 200));
    // Strip HTML tags and retry as plain text so the message at least lands
    res = await fetch(`${api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text).replace(/<[^>]+>/g, ''),
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      throw new Error(`Telegram sendMessage ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
  return { sent: true };
}

// ============================================================================
// FALLBACK HTML — used when Haiku compile fails; still ships something
// ============================================================================
export function fallbackHtml(rawData) {
  const esc = (s) =>
    String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const usage = rawData?.usage || {};
  const waitlist = usage.waitlist || {};
  const waitlistTotal = waitlist.total ?? '—';
  const waitlistNew = waitlist.new24h ?? 0;
  const waitlistNewLine =
    waitlist.new24h === 0
      ? 'No new signups in the last 24h.'
      : `${waitlistNew} new in last 24h`;
  return `<div style="font-family: system-ui, sans-serif; background: #F5F0EB; padding: 24px; color: #3D4A4F;">
  <h1 style="color: #C17B4E; margin-top: 0;">Maurice — Fallback Report</h1>
  <p>The compile step failed. Surfacing the key numbers above the raw dump.</p>
  <h2 style="color: #3D4A4F; margin-bottom: 4px;">📬 Waitlist</h2>
  <p style="margin-top: 0;">
    Total signups: <strong>${esc(String(waitlistTotal))}</strong><br>
    ${esc(waitlistNewLine)}
  </p>
  <h2 style="color: #3D4A4F; margin-bottom: 4px;">Raw data</h2>
  <pre style="background: #fff; padding: 16px; border-radius: 8px; overflow: auto; font-size: 12px;">${esc(JSON.stringify(rawData, null, 2))}</pre>
</div>`;
}
