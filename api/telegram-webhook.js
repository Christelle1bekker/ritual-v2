// api/telegram-webhook.js
// Maurice v2 — Telegram webhook endpoint.
//
// Handles on-demand health checks in the Ritual Ops group chat.
//
// Flow:
//   1. Verify the webhook secret from the URL (?secret=...)
//   2. Only accept messages from MAURICE_TELEGRAM_CHAT_ID (allow-list)
//   3. In groups, only respond to messages mentioning "maurice" (case-insensitive)
//      or to private chats with the bot
//   4. Classify intent via Haiku
//   5. Dispatch: status / health_check / usage_stats / full_report / greeting
//   6. Compile a Telegram-friendly reply with Haiku
//   7. Send via Telegram Bot API
//
// Returns 200 for all requests (Telegram retries on non-200s).

import {
  runAllHealthChecks,
  runUsageReport,
  haikuCompile,
  MAURICE_VOICE,
} from '../lib/maurice-core.js';

export const config = { maxDuration: 30 };

const TELEGRAM_TOKEN = process.env.MAURICE_TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.MAURICE_TELEGRAM_CHAT_ID;
const TELEGRAM_SECRET = process.env.MAURICE_TELEGRAM_SECRET;
const TELEGRAM_API = () => `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ============================================================================
// TELEGRAM API HELPERS
// ============================================================================
async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_TOKEN) {
    console.error('[Maurice Telegram] MAURICE_TELEGRAM_TOKEN not set');
    return;
  }
  try {
    const res = await fetch(`${TELEGRAM_API()}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // If HTML parse fails on Telegram's side, retry in plain text.
      const body = await res.text();
      console.error('[Maurice Telegram] sendMessage HTML failed:', res.status, body.slice(0, 200));
      await fetch(`${TELEGRAM_API()}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: stripHtml(text),
          disable_web_page_preview: true,
        }),
      });
    }
  } catch (err) {
    console.error('[Maurice Telegram] sendMessage threw:', err.message);
  }
}

async function sendTelegramAction(chatId, action) {
  if (!TELEGRAM_TOKEN) return;
  try {
    await fetch(`${TELEGRAM_API()}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch (_) {
    // Typing indicator is cosmetic — swallow errors
  }
}

function stripHtml(text) {
  return String(text).replace(/<[^>]+>/g, '');
}

// ============================================================================
// INTENT CLASSIFIER (Haiku)
// ============================================================================
const INTENT_SYSTEM = `${MAURICE_VOICE}

TASK: classify the user's incoming message into ONE action and respond with JSON only. No markdown, no backticks.

Possible actions:
- "status" — a quick yes/no on whether systems are healthy ("all good?", "how's everything", "status", "anything broken?")
- "health_check" — a detailed health report ("health check", "run the checks", "full health report")
- "usage_stats" — usage / activity data ("how many taps yesterday", "usage stats", "who's using it")
- "full_report" — everything, both health and usage ("full report", "everything", "give me the lot")
- "greeting" — hello, introductions, "what can you do" (this is the ONLY place Maurice gets to introduce himself in voice)
- "unknown" — you're not sure what they want

Respond ONLY with: {"action": "...", "reply": "..."}

The "reply" field is ONLY used for "greeting" and "unknown". For all other actions, leave "reply" as an empty string — the dispatcher will run the relevant checks and compile a voiced response separately.

For "greeting": a short in-character introduction (1-3 sentences). Maurice is pleased to be asked, lists what he can do, and does not break character.
For "unknown": a short in-character clarification nudge (1 sentence). Quietly apologetic, slightly precise about what he CAN do.

Both fields must be valid Telegram HTML (<b>, <i>, <code> allowed; nothing else).`;

async function interpretIntent(userMessage) {
  try {
    const { text } = await haikuCompile(INTENT_SYSTEM, userMessage, 200);
    let clean = text.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
    }
    const parsed = JSON.parse(clean);
    if (!parsed.action) throw new Error('no action');
    return parsed;
  } catch (_) {
    return {
      action: 'unknown',
      reply: "Right. I didn't quite follow that, which is almost certainly my fault. Try <b>health check</b>, <b>status</b>, or <b>usage stats</b> — those I can definitely do.",
    };
  }
}

// ============================================================================
// RESPONSE COMPILERS (Haiku → Telegram HTML)
// ============================================================================
const TELEGRAM_HEALTH_SYSTEM = `${MAURICE_VOICE}

TASK: compile the raw health results below into a concise Telegram message, in character.

RULES
- Telegram HTML only: <b>, <i>, <code>, <pre>. NO <div>, <span>, <p>, CSS, markdown, or anything else — Telegram will reject it.
- ✅ ⚠️ 🔴 emoji dots are allowed as traffic lights. No other emoji.
- Lead with a one-line Maurice opener — quietly pleased if everything is healthy, flustered-but-composed if not. Keep it to a single line, under 25 words.
- Then a one-line overall status (e.g. "<b>All systems operational.</b>" or "<b>Something is wrong.</b>")
- Then four short grouped blocks: <b>Frontend</b>, <b>Backend</b>, <b>Delivery</b>, <b>Monitoring</b>. Use line breaks (not lists) between items within a group.
- Show response times for URL + API checks — Maurice finds these genuinely interesting and may briefly comment on a notably quick or slow one (one comment MAX across the whole message).
- If a check is 'skipped' (e.g. Capgo when the key is absent), say so neutrally — do NOT flag it as a problem.
- If the bundle has changed, highlight it: <b>Bundle CHANGED:</b> vX → vY. Maurice finds deploys noteworthy.
- Close with a short in-character sign-off. One line. Never more than 8 words.
- Hard limit: under 300 words total. Personality is seasoning, not substance.`;

const TELEGRAM_USAGE_SYSTEM = `${MAURICE_VOICE}

TASK: compile the raw usage data below into a concise Telegram message, in character.

RULES
- Telegram HTML only: <b>, <i>, <code>. No markdown, no other HTML.
- Lead with a one-line Maurice opener acknowledging we're looking at usage. One line, in character, under 20 words.
- Then the facts: yesterday's total taps with a trend arrow (↑ ↓ →) vs the 7-day average. Then active families (list each by its label, e.g. "Family a1b2c3"), peak tapping hour (Melbourne time), new signups in the last 24h.
- Maurice may make ONE quietly dry observation if the numbers are notably up, down, flat, or quiet — something like "A quieter day. The data points look a little lonely." or "Activity is up, which is technically good news, though I rarely trust good news." Don't do more than one.
- Numbers and names stay accurate. Maurice never makes them funnier by rounding or exaggerating.
- Close with a one-line Maurice sign-off.
- Under 250 words total.`;

const TELEGRAM_FULL_SYSTEM = `${MAURICE_VOICE}

TASK: compile BOTH health and usage data into a single Telegram message, in character.

RULES
- Telegram HTML only: <b>, <i>, <code>. No markdown, no other HTML.
- Lead with a one-line Maurice opener ("Right. The full picture, coming up.") and overall health dot (✅ ⚠️ 🔴).
- Two labelled sections: <b>🏥 Health</b> and <b>📊 Usage</b>. (The 🏥 and 📊 are the ONLY non-status emoji permitted.)
- Under the Health section: tight factual summary grouped as Frontend / Backend / Delivery / Monitoring.
- Under the Usage section: taps yesterday with trend arrow, active families listed by label, peak hour, new signups.
- ONE in-character aside across the whole message — not per section, not per line. A single dry observation if warranted.
- Treat 'skipped' checks as neutral, never as problems.
- Close with a one-line Maurice sign-off.
- Under 500 words total.`;

async function compileTelegramHealth(health) {
  const { text } = await haikuCompile(
    TELEGRAM_HEALTH_SYSTEM,
    'Health results:\n' + JSON.stringify(health, null, 2),
    1000
  );
  return text;
}

async function compileTelegramUsage(usage) {
  const { text } = await haikuCompile(
    TELEGRAM_USAGE_SYSTEM,
    'Usage data:\n' + JSON.stringify(usage, null, 2),
    1000
  );
  return text;
}

async function compileTelegramFull(payload) {
  const { text } = await haikuCompile(
    TELEGRAM_FULL_SYSTEM,
    'Full report data:\n' + JSON.stringify(payload, null, 2),
    1500
  );
  return text;
}

// ============================================================================
// QUICK STATUS (no Haiku) — one-liner
// ============================================================================
function isAllGreen(health) {
  if (!health || health.error) return false;
  if (Array.isArray(health.urlChecks) && health.urlChecks.some((u) => !u.ok)) return false;
  const checks = [health.supabase, health.ssl, health.capgo, health.apiRoute, health.aasa, health.resend];
  for (const c of checks) {
    if (!c) continue;
    // 'skipped' is NOT a problem (e.g. Capgo without API key)
    if (c.status === 'error') return false;
    if (c.status === 'warning') return false;
    if (c.error) return false;
  }
  return true;
}

function formatIssues(health) {
  const issues = [];
  if (Array.isArray(health.urlChecks)) {
    for (const u of health.urlChecks) {
      if (!u.ok) issues.push(`🔴 ${u.url} — ${u.error || `HTTP ${u.status}`}`);
    }
  }
  const named = {
    'Supabase': health.supabase,
    'SSL': health.ssl,
    'Capgo': health.capgo,
    'API route': health.apiRoute,
    'AASA': health.aasa,
    'Resend': health.resend,
  };
  for (const [name, c] of Object.entries(named)) {
    if (!c) continue;
    if (c.status === 'error' || c.error) {
      issues.push(`🔴 ${name} — ${c.error || 'error'}`);
    } else if (c.status === 'warning' || c.warning) {
      issues.push(`⚠️ ${name} — ${c.message || c.error || 'warning'}`);
    }
  }
  return issues.length
    ? issues.join('\n')
    : "Something is off and yet I cannot specifically pinpoint what, which is — I won't lie to you — slightly more worrying than a specific problem.";
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
export default async function handler(req, res) {
  // Telegram uses POST. Anything else: 200 ok (stops retries).
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  // 1. Secret gate — URL param, verified server-side
  const url = new URL(req.url || '/', 'https://localhost');
  if (!TELEGRAM_SECRET || url.searchParams.get('secret') !== TELEGRAM_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse body defensively — Vercel sometimes passes it as raw, sometimes as JSON
  let update = req.body;
  if (typeof update === 'string') {
    try { update = JSON.parse(update); } catch (_) { update = {}; }
  }
  const message = update?.message;

  if (!message?.text) {
    return res.status(200).json({ ok: true });
  }

  // 2. Chat allow-list — only the Ritual Ops group
  if (!TELEGRAM_CHAT_ID || String(message.chat.id) !== TELEGRAM_CHAT_ID) {
    return res.status(200).json({ ok: true });
  }

  // 3. Mention gate — in group chats, require "maurice" in the text
  const lower = message.text.toLowerCase();
  const isPrivate = message.chat.type === 'private';
  const mentioned = isPrivate || lower.includes('maurice');
  if (!mentioned) {
    return res.status(200).json({ ok: true });
  }

  // 4. Work
  await sendTelegramAction(message.chat.id, 'typing');

  try {
    const intent = await interpretIntent(message.text);
    let reply;

    switch (intent.action) {
      case 'status': {
        const h = await runAllHealthChecks(null);
        if (isAllGreen(h)) {
          reply =
            '✅ <b>All systems operational.</b>\n' +
            "I have checked everything twice. The alternative is checking once, which is how one ends up with database fires.";
        } else {
          reply =
            '⚠️ <b>Right. We have a situation.</b>\n' +
            "Not a catastrophe, probably, but worth your attention:\n\n" +
            formatIssues(h);
        }
        break;
      }
      case 'health_check': {
        const h = await runAllHealthChecks(null);
        reply = await compileTelegramHealth(h);
        break;
      }
      case 'usage_stats': {
        const u = await runUsageReport();
        reply = await compileTelegramUsage(u);
        break;
      }
      case 'full_report': {
        const [h, u] = await Promise.all([
          runAllHealthChecks(null),
          runUsageReport(),
        ]);
        reply = await compileTelegramFull({ health: h, usage: u });
        break;
      }
      case 'greeting':
        reply =
          intent.reply ||
          "Hello. I'm Maurice. I monitor the health of Ritual Habits so that you don't have to — which is, I realise, the sort of thing one says before something goes terribly wrong. You can ask me for a <b>health check</b>, a <b>status</b>, <b>usage stats</b>, or if you're feeling brave, a <b>full report</b>. I shall be here. I am always here.";
        break;
      default:
        reply =
          intent.reply ||
          "Right. I didn't quite follow that, which is almost certainly my fault. Try <b>health check</b>, <b>status</b>, or <b>usage stats</b>.";
    }

    await sendTelegramMessage(message.chat.id, reply);
  } catch (err) {
    console.error('[Maurice Telegram] handler error:', err);
    await sendTelegramMessage(
      message.chat.id,
      "⚠️ Right. Well. Something has gone wrong <i>while I was checking whether things had gone wrong</i>, which I must say is an unusually galling situation. The 6:30am email should still work. Probably. I'll look into it."
    );
  }

  return res.status(200).json({ ok: true });
}
