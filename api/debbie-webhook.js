// api/debbie-webhook.js
// Debbie — Telegram webhook endpoint.
//
// Handles on-demand social/market/research requests in the Ritual Ops group chat.
//
// Flow:
//   1. Verify the webhook secret from the URL (?secret=...)
//   2. Only accept messages from MAURICE_TELEGRAM_CHAT_ID (allow-list)
//   3. In groups, only respond to messages mentioning "debbie" (case-insensitive)
//      or to private chats with the bot
//   4. Classify intent via Haiku
//   5. Dispatch: social_update / market_trends / research_digest / whats_new /
//                question / help / greeting
//   6. Compile a Telegram-friendly reply
//   7. Send via Telegram Bot API (HTML with plain-text fallback)
//
// Returns 200 for all requests (Telegram retries on non-200s).

import {
  runInstagramScan,
  runMarketResearch,
  runBehaviouralScience,
  runTwitterScan,
  compileSocialReport,
  haikuCompile,
  haikuWebSearch,
  DEBBIE_VOICE,
} from '../lib/debbie-core.js';

export const config = { maxDuration: 60 };

const TELEGRAM_TOKEN = process.env.DEBBIE_TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.MAURICE_TELEGRAM_CHAT_ID;
const TELEGRAM_SECRET = process.env.DEBBIE_TELEGRAM_SECRET;
const TELEGRAM_API = () => `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ============================================================================
// TELEGRAM API HELPERS
// ============================================================================
async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_TOKEN) {
    console.error('[Debbie Telegram] DEBBIE_TELEGRAM_TOKEN not set');
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
      console.error('[Debbie Telegram] sendMessage HTML failed:', res.status, body.slice(0, 200));
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
    console.error('[Debbie Telegram] sendMessage threw:', err.message);
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
const INTENT_SYSTEM = `${DEBBIE_VOICE}

TASK: classify the user's incoming message into ONE action and respond with JSON only. No markdown, no backticks.

Possible actions:
- "social_update" — user wants the latest Instagram scan ("social update", "instagram", "ig", "insta scan", "what's happening on instagram")
- "market_trends" — market research / competitors ("market trends", "market", "competitors", "competition", "what's the competition doing")
- "research_digest" — behavioural science ("research digest", "research", "science", "any new studies", "what does the science say")
- "whats_new" — combined brief of all three ("what's new", "everything", "full brief", "full report", "catch me up", "give me the lot")
- "help" — user is asking what Debbie can do ("help", "what can you do", "commands")
- "greeting" — hi / hello / introductions / first interaction
- "question" — a focused topic question that needs a web-search answer (e.g. "what do you know about dopamine and habit loops?", "any news on family tech startups in Europe?", "is the fidget toy trend still a thing?")
- "unknown" — you can't tell

Respond ONLY with: {"action": "...", "reply": "...", "question": "..."}

- "reply" is only used for greeting, help, and unknown. For data-driven actions, leave it as an empty string — the dispatcher will run the relevant work and compile a voiced response separately.
- "question" is only used for the "question" action. Echo back the user's actual question verbatim, but trim any mention of "debbie" (case-insensitive) so the downstream prompt isn't distracted.
- For "greeting": a brief, warm, professional intro under 50 words — what Debbie covers (Instagram, market intel, behavioural science) and the commands available. No catchphrases, no all-caps, no "hi hi hi".
- For "help": a short Telegram HTML message listing commands as <b>bold</b> keywords. Under 80 words. Plain and useful.
- For "unknown": a short polite nudge under 25 words, pointing to the main commands. No hype.
- All reply fields must be valid Telegram HTML (<b>, <i>, <code> allowed only).`;

async function interpretIntent(userMessage) {
  try {
    const { text } = await haikuCompile(INTENT_SYSTEM, userMessage, 400);
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
      reply:
        "I didn't quite catch that. Try <b>social update</b>, <b>market trends</b>, <b>research digest</b>, or <b>what's new</b> — or ask me a specific question.",
      question: '',
    };
  }
}

// ============================================================================
// FOCUSED QUESTION ANSWER — Haiku with web search
// ============================================================================
const QUESTION_SYSTEM = `${DEBBIE_VOICE}

TASK: Answer the user's specific question using web search. Topics you cover include: social media trends, market movements, competitors, habit formation research, behavioural science, children's behaviour, family routines, gamification, NFC/tangible tech, parenting trends — anything adjacent to Ritual Habits' space.

Use web search sparingly — NO MORE THAN 2 searches total — for current and factual information. Quality over quantity.

RULES
- Telegram HTML only: <b>, <i>, <code>. No markdown, no other HTML.
- Lead with the answer. No opener, no catchphrase, no sign-off.
- Every specific claim MUST include a source URL in parentheses, or a named publication + date if no URL is available. No attribution = cut the claim.
- If the question is outside Debbie's beat (engineering, legal, pricing internals), say so in one line and point back to what she CAN help with.
- Do NOT invent studies, authors, companies, creator handles, statistics, or URLs. If you didn't find it, say so plainly.
- If the search returns nothing useful, say "No solid sources on this in recent coverage — worth asking again in a week or two." Do not pad.
- HARD LIMIT: 400 words.`;

async function answerQuestion(question) {
  try {
    const { text } = await haikuWebSearch(QUESTION_SYSTEM, question, 1500, 2);
    return text;
  } catch (err) {
    console.error('[Debbie] question web search failed:', err.message);
    return (
      "Web search failed. Try again in a minute — if it keeps failing, something upstream is down."
    );
  }
}

// ============================================================================
// DEFAULT FALLBACK TEXTS (used if Haiku intent reply is empty)
// ============================================================================
const DEFAULT_GREETING =
  "I'm <b>Debbie</b>, your scout for Ritual Habits. I track Instagram 📸, market and competitor moves 📊, and behavioural science research 🧠 — sourced, short, honest. Try <b>social update</b>, <b>market trends</b>, <b>research digest</b>, or <b>what's new</b>, or ask me a specific question.";

const DEFAULT_HELP =
  "Commands:\n\n" +
  "• <b>social update</b> or <b>instagram</b> — latest IG scan\n" +
  "• <b>market trends</b> or <b>competitors</b> — market brief\n" +
  "• <b>research digest</b> or <b>science</b> — behavioural science findings\n" +
  "• <b>what's new</b> — combined brief of all three\n" +
  "• ask me a specific question — I'll web-search and bring sourced answers";

const DEFAULT_UNKNOWN =
  "I didn't quite catch that. Try <b>social update</b>, <b>market trends</b>, <b>research digest</b>, or <b>what's new</b> — or ask me a specific question.";

// ============================================================================
// MAIN HANDLER
// ============================================================================
export default async function handler(req, res) {
  // Telegram uses POST. Anything else: 200 ok (stops retries).
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true });
  }

  // 1. Secret gate — accepts either Telegram's native secret_token header
  //    (X-Telegram-Bot-Api-Secret-Token, set via setWebhook?secret_token=...)
  //    OR a ?secret= URL param, so both registration styles work.
  const url = new URL(req.url || '/', 'https://localhost');
  const headerSecret =
    req.headers['x-telegram-bot-api-secret-token'] ||
    req.headers['X-Telegram-Bot-Api-Secret-Token'];
  const urlSecret = url.searchParams.get('secret');
  const provided = headerSecret || urlSecret;
  if (!TELEGRAM_SECRET || provided !== TELEGRAM_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Parse body defensively — Vercel sometimes passes it as raw, sometimes as JSON
  let update = req.body;
  if (typeof update === 'string') {
    try {
      update = JSON.parse(update);
    } catch (_) {
      update = {};
    }
  }
  const message = update?.message;

  if (!message?.text) {
    return res.status(200).json({ ok: true });
  }

  // 2. Chat allow-list — only the Ritual Ops group
  if (!TELEGRAM_CHAT_ID || String(message.chat.id) !== TELEGRAM_CHAT_ID) {
    return res.status(200).json({ ok: true });
  }

  // 3. Mention gate — in group chats, require "debbie" in the text
  const lower = message.text.toLowerCase();
  const isPrivate = message.chat.type === 'private';
  const mentioned = isPrivate || lower.includes('debbie');
  if (!mentioned) {
    return res.status(200).json({ ok: true });
  }

  // 4. Work
  await sendTelegramAction(message.chat.id, 'typing');

  try {
    const intent = await interpretIntent(message.text);
    let reply;

    switch (intent.action) {
      case 'social_update': {
        const ig = await runInstagramScan();
        const compiled = await compileSocialReport({
          generatedAt: new Date().toISOString(),
          instagram: ig,
          market: { status: 'skipped' },
          science: { status: 'skipped' },
          twitter: { status: 'skipped' },
        });
        reply = compiled.text;
        break;
      }
      case 'market_trends': {
        const market = await runMarketResearch();
        const compiled = await compileSocialReport({
          generatedAt: new Date().toISOString(),
          instagram: { status: 'skipped' },
          market,
          science: { status: 'skipped' },
          twitter: { status: 'skipped' },
        });
        reply = compiled.text;
        break;
      }
      case 'research_digest': {
        const science = await runBehaviouralScience();
        const compiled = await compileSocialReport({
          generatedAt: new Date().toISOString(),
          instagram: { status: 'skipped' },
          market: { status: 'skipped' },
          science,
          twitter: { status: 'skipped' },
        });
        reply = compiled.text;
        break;
      }
      case 'whats_new': {
        // Webhook has a hard 60s ceiling (Vercel Hobby). The full four-scan
        // pipeline (IG + market + science + twitter) regularly exceeds that.
        //
        // Additional constraint: the Anthropic rate limit is 50K input
        // tokens/minute. Each web-search scan can consume 25-30K input tokens
        // from search results alone. Running two in parallel then compiling
        // blows through the rate limit, causing a 429 on the compile call.
        // The 30s retry wait then pushes total time past 60s → timeout.
        //
        // Fix: run scans SEQUENTIALLY so token consumption is spread out,
        // and skip Instagram (Apify, up to 55s on its own). The scheduled
        // social-report.js cron still runs the full parallel pipeline.
        const market = await runMarketResearch();
        const science = await runBehaviouralScience();
        const compiled = await compileSocialReport({
          generatedAt: new Date().toISOString(),
          instagram: { status: 'skipped' },
          market,
          science,
          twitter: { status: 'skipped' },
        });
        reply = compiled.text;
        break;
      }
      case 'question': {
        const q = (intent.question || message.text || '').replace(/debbie/gi, '').trim();
        reply = await answerQuestion(q || message.text);
        break;
      }
      case 'help':
        reply = intent.reply || DEFAULT_HELP;
        break;
      case 'greeting':
        reply = intent.reply || DEFAULT_GREETING;
        break;
      default:
        reply = intent.reply || DEFAULT_UNKNOWN;
    }

    await sendTelegramMessage(message.chat.id, reply);
  } catch (err) {
    console.error('[Debbie Telegram] handler error:', err);
    await sendTelegramMessage(
      message.chat.id,
      "Something failed on my side. Try again in a minute — if it keeps failing, check the Vercel logs for the debbie-webhook function.",
    );
  }

  return res.status(200).json({ ok: true });
}
