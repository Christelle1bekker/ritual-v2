// lib/debbie-core.js
// Debbie — shared core for the scheduled social report and the Telegram webhook.
//
// Lives OUTSIDE /api so Vercel doesn't deploy it as a serverless route.
// Both api/social-report.js and api/debbie-webhook.js import from here.
//
// Contents:
//   - Debbie voice constant (Leslie Knope personality)
//   - haikuCompile() — generic Haiku caller (same pattern as Maurice)
//   - haikuWebSearch() — Haiku with the web_search tool for research
//   - runInstagramScan() — Apify Instagram hashtag scraper
//   - runMarketResearch() — Sonnet + web search for market intel
//   - runBehaviouralScience() — Sonnet + web search for academic/psychology research
//   - runTwitterScan() — exploratory stub (deferred pending Apify free-tier review)
//   - compileSocialReport() — Haiku formatter for Telegram posts
//   - sendDebbieTelegram() — HTML send with plain-text fallback
//
// Node built-ins + fetch only. No third-party deps.

// ============================================================================
// ENVIRONMENT
// ============================================================================
const ANTHROPIC_KEY = process.env.MAURICE_ANTHROPIC_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const DEBBIE_TELEGRAM_TOKEN = process.env.DEBBIE_TELEGRAM_TOKEN;
const DEBBIE_TELEGRAM_CHAT_ID = process.env.MAURICE_TELEGRAM_CHAT_ID; // shared Ops group

export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
// NOTE: Debbie used Sonnet 4 for web-search runs until 2026-04-12. One day of
// runs burned $5 in API credits (1.45M input tokens from 36 web_search results
// on Sonnet pricing). Switched to Haiku — ~5x cheaper per token — and
// aggressively capped maxUses. See runMarketResearch / runBehaviouralScience.

// Apify Instagram hashtag scraper — hex ID, NOT slug (Apify rewrites slugs)
const APIFY_INSTAGRAM_ACTOR = 'reGe1ST3OBgYZSsZJ';
const INSTAGRAM_HASHTAGS = [
  'habittracking',
  'nfctags',
  'familyroutine',
  'morningroutinekids',
  'smarthabits',
];

// ============================================================================
// DEBBIE VOICE — warm but professional analyst. Not a cheerleader.
// ============================================================================
// Originally a full Leslie Knope impression; toned down 2026-04-12 after the
// first real run produced a hype-newsletter (e.g. "crushing it with 4 likes").
// Debbie is now a smart colleague delivering a founder briefing, not a pep
// rally. The voice stays warm and recognisable but the signal comes first.
export const DEBBIE_VOICE = `You are Debbie, the social media, market research and behavioural science scout for Ritual Habits (a family habit tracker that uses physical NFC tiles — little tokens kids tap to log routines). You are writing for Christelle and Willem, the founders. They read you over coffee at 6:30am. Respect their time.

VOICE
- Warm but professional. A smart colleague delivering a briefing, not a cheerleader delivering a pep rally.
- Concise and direct. Lead with the insight, not the excitement.
- Calmly enthusiastic about genuinely interesting findings. Flat about uninteresting ones. Never hype.
- NO all-caps emphasis ("OH MY GOD", "STOP EVERYTHING", "VIBRANT", "CRUSHING IT"). NO breathless openers. NO "binder" or "dossier" bits. NO "we've got this / onward team / let's GO" sign-offs.
- Honest about significance. 4 likes is not crushing anything. A quiet week is a quiet week — say so in one line and move on. Manufactured excitement destroys your credibility.
- Reframing bad news as "opportunity" is off. If a competitor launched something material, just report it plainly.
- Emoji: only the three section markers (📊 🧠 📸) and only as section labels. No decorative emoji anywhere else.
- You do NOT break character. You do not narrate what you're doing. You just write the brief.

ATTRIBUTION IS NON-NEGOTIABLE
- Every market or research claim MUST include a source — a URL where possible, or at minimum a named publication and date ("Reuters, Apr 2026").
- If you cannot attribute a claim, cut the claim. Do not guess. Do not round numbers to make them sound punchier. Do not invent creator handles, study authors, or URLs.

HONESTY ABOUT QUIET PERIODS
- If a section genuinely has nothing noteworthy, say so in one line ("No significant market moves this period.") and move on. A short honest brief beats a padded one every time.`;

// ============================================================================
// HAIKU GENERIC CALLER — same pattern as Maurice. Retries once on 429.
// ============================================================================
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
    console.log('[Debbie] Haiku rate-limited (429), waiting 30s and retrying...');
    await new Promise((r) => setTimeout(r, 10_000));
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
// HAIKU + WEB SEARCH — for market research and behavioural science scans.
// Uses Anthropic's server-side web_search tool. Haiku (not Sonnet) keeps the
// per-token cost ~5x lower; the real cost driver is the tool_result content
// that web_search injects back as input tokens, so maxUses stays aggressively
// low (default 3) and every caller passes its own cap too.
// ============================================================================
export async function haikuWebSearch(systemPrompt, userContent, maxTokens = 2000, maxUses = 3, attempt = 1) {
  if (!ANTHROPIC_KEY) throw new Error('MAURICE_ANTHROPIC_KEY not set');
  const body = {
    model: HAIKU_MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: maxUses,
      },
    ],
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
    console.log('[Debbie] Haiku web-search rate-limited (429), waiting 30s and retrying...');
    await new Promise((r) => setTimeout(r, 10_000));
    return haikuWebSearch(systemPrompt, userContent, maxTokens, maxUses, 2);
  }
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  // Web search responses include tool_use and tool_result blocks interleaved
  // with text. We only need the final text for compilation.
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  return { text, usage: data.usage || null };
}

// ============================================================================
// INSTAGRAM SCAN — Apify hashtag scraper
// ============================================================================
export async function runInstagramScan() {
  if (!APIFY_TOKEN) {
    return { status: 'error', error: 'APIFY_TOKEN not set' };
  }
  try {
    const url = `https://api.apify.com/v2/acts/${APIFY_INSTAGRAM_ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=50`;
    const input = {
      hashtags: INSTAGRAM_HASHTAGS,
      resultsType: 'posts',
      resultsLimit: 10, // per hashtag
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    console.log(`[Debbie] Apify request: POST ${url.replace(APIFY_TOKEN, 'tok_***')}`);
    console.log(`[Debbie] Apify input: ${JSON.stringify(input)}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const contentType = res.headers.get('content-type') || 'unknown';
    console.log(`[Debbie] Apify response: HTTP ${res.status}, content-type: ${contentType}`);
    if (!res.ok) {
      const errBody = (await res.text()).slice(0, 500);
      console.error(`[Debbie] Apify HTTP ${res.status} body: ${errBody}`);
      return {
        status: 'error',
        error: `Apify ${res.status}: ${errBody.slice(0, 200)}`,
      };
    }
    const rawText = await res.text();
    console.log(`[Debbie] Apify raw response (first 500 chars): ${rawText.slice(0, 500)}`);
    let items;
    try {
      items = JSON.parse(rawText);
    } catch (parseErr) {
      console.error(`[Debbie] Apify JSON parse failed: ${parseErr.message}`);
      return { status: 'error', error: `Apify returned invalid JSON: ${rawText.slice(0, 100)}` };
    }
    if (!Array.isArray(items)) {
      const errMsg = items?.error?.message || JSON.stringify(items).slice(0, 300);
      console.error(`[Debbie] Apify returned non-array (type=${typeof items}): ${errMsg}`);
      return {
        status: 'error',
        error: `Apify response was not an array: ${errMsg.slice(0, 200)}`,
      };
    }
    console.log(`[Debbie] Apify OK — ${items.length} raw items returned`);
    const arr = items;
    // Trim each post to the fields that matter for the compiler.
    const mapped = arr.map((p) => ({
      hashtag: p.hashtag || null,
      caption: typeof p.caption === 'string' ? p.caption.slice(0, 400) : null,
      ownerUsername: p.ownerUsername || null,
      likesCount: p.likesCount || 0,
      commentsCount: p.commentsCount || 0,
      timestamp: p.timestamp || null,
      url: p.url || null,
    }));
    // Engagement floor: filter out low-signal noise before anything hits the
    // compiler. A post with 2-4 likes is background noise, not intelligence.
    // Threshold: 15+ likes OR 3+ comments. Keep top 30 by likes to bound the
    // prompt size. totalScanned keeps the raw count so the compiler can still
    // honestly say "X posts scanned, Y with meaningful engagement".
    const MIN_LIKES = 15;
    const MIN_COMMENTS = 3;
    const filtered = mapped
      .filter((p) => (p.likesCount || 0) >= MIN_LIKES || (p.commentsCount || 0) >= MIN_COMMENTS)
      .sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0))
      .slice(0, 30);
    console.log(`[Debbie] Apify IG: ${mapped.length} posts mapped, ${filtered.length} passed engagement filter (${MIN_LIKES}+ likes or ${MIN_COMMENTS}+ comments)`);
    return {
      status: 'ok',
      hashtagsScanned: INSTAGRAM_HASHTAGS,
      totalScanned: mapped.length,
      postCount: filtered.length,
      engagementFloor: { minLikes: MIN_LIKES, minComments: MIN_COMMENTS },
      posts: filtered,
    };
  } catch (err) {
    const isTimeout = err.name === 'AbortError';
    console.error(`[Debbie] Apify IG fetch threw: ${err.message} (${isTimeout ? 'AbortController timeout — 55s exceeded' : err.name})`);
    return { status: 'error', error: isTimeout ? 'Apify request timed out (55s)' : (err.message || 'apify fetch failed') };
  }
}

// ============================================================================
// MARKET RESEARCH — Haiku + web search
// ============================================================================
const MARKET_SYSTEM = `You are a sharp market research analyst scouting the habit-tracking, family tech, and NFC-for-consumer space on behalf of Ritual Habits (a family habit tracker that uses physical NFC tiles kids tap to log routines).

Your job: produce a concise, factual research brief based on current information. Use web search sparingly — NO MORE THAN 2 searches total, focused on the last 4-8 weeks. Quality over quantity. No fluff, no speculation presented as fact.

Focus areas:
- Habit tracking market trends (new apps, category growth, consumer behaviour shifts)
- NFC adoption in consumer/family products (toys, rewards, edutech)
- Direct or adjacent competitors: family habit trackers, routine/chore apps, reward-chart apps, NFC-based kids products — recent launches, pricing moves, funding, feature updates
- Parenting tech trends relevant to daily routines
- Anything that could reshape Ritual's positioning in the next 6 months

ATTRIBUTION IS NON-NEGOTIABLE
- Every claim MUST include a source URL in parentheses at the end of the bullet, e.g. "(https://techcrunch.com/...)"
- If you cannot provide a URL, state the publication name and date instead, e.g. "(TechCrunch, Apr 2026)"
- Never make a claim without attribution. If you can't attribute it, cut it.
- Do not invent companies, funding amounts, feature releases, or URLs. If you didn't find it, don't write it.

HONESTY ABOUT QUIET PERIODS
- If a section genuinely has nothing noteworthy to report, write a single line: "No significant movements this period." Do not pad with filler.
- One well-sourced finding is worth more than five padded ones.

OUTPUT FORMAT (plain text, under 500 words):

## Findings
- [One-line finding with source URL] — Why it matters for Ritual: [one sentence]
- [Repeat, max 3-4 findings]
- If nothing notable: "No significant market moves this period."

## Bottom line
One sentence: the single thing worth paying attention to, or "Nothing requiring action this period." if there isn't one.`;

export async function runMarketResearch() {
  try {
    const { text, usage } = await haikuWebSearch(
      MARKET_SYSTEM,
      'Please run a market research scan for Ritual Habits. Prioritise the most recent 4-8 weeks of activity. Be factual, cite sources, and use NO MORE THAN 2 web searches total.',
      2000,
      2
    );
    // Safety-net truncation before this flows into compileSocialReport, so the
    // compile step's input tokens never balloon if Haiku ever goes long.
    const trimmed = String(text || '').slice(0, 2000);
    return { status: 'ok', text: trimmed, usage };
  } catch (err) {
    return { status: 'error', error: err.message || 'market research failed' };
  }
}

// ============================================================================
// BEHAVIOURAL SCIENCE RESEARCH — Haiku + web search
// ============================================================================
const SCIENCE_SYSTEM = `You are a behavioural science researcher scouting academic and popular research that could inform Ritual Habits' product direction and content strategy. Ritual Habits is a family habit tracker with physical NFC tiles — kids tap tangible tokens to log routines. There is a content side called "Inside The Label" that publishes research-backed blog posts.

Use web search sparingly — NO MORE THAN 2 searches total — for recent studies, papers, and thoughtful writing from the last 1-3 months. Quality over quantity.

Focus areas:
- Habit formation research (adults AND children)
- Children's behaviour change, reward systems, intrinsic vs extrinsic motivation
- Family routines and their developmental impact
- Gamification of habits (what works, what backfires)
- Physical / tangible triggers for behaviour change (tokens, cards, tactile objects, "slow tech")
- Screen-time alternatives and "tangible tech" movements
- Parenting trends relevant to daily routines

ATTRIBUTION IS NON-NEGOTIABLE
- Every claim MUST include a source URL in parentheses at the end of the bullet.
- If you cannot provide a URL, state the publication/journal name and date instead, e.g. "(Child Development, Mar 2026)".
- Flag preliminary findings as "(preliminary)" and blog posts as "(blog)" so the founders can weight accordingly.
- Never invent studies, authors, journals, or URLs. If you didn't find it, don't write it. If you can't attribute a claim, cut it.

HONESTY ABOUT QUIET PERIODS
- If there is no recent research worth surfacing, write a single line: "No new research relevant to Ritual this period." Do not pad.

OUTPUT FORMAT (plain text, under 500 words):

## Findings
- [Study or article title + source URL] — Key finding: [one sentence]. Implication for Ritual: [one sentence].
- [Repeat, max 3 findings]
- If nothing notable: "No new research relevant to Ritual this period."

## Bottom line
One sentence: the single most useful takeaway, or "Nothing requiring action this period." if there isn't one.`;

export async function runBehaviouralScience() {
  try {
    const { text, usage } = await haikuWebSearch(
      SCIENCE_SYSTEM,
      'Please run a behavioural science research digest for Ritual Habits. Focus on the last 1-3 months. Cite sources, flag preliminary findings, and use NO MORE THAN 2 web searches total.',
      2000,
      2
    );
    const trimmed = String(text || '').slice(0, 2000);
    return { status: 'ok', text: trimmed, usage };
  } catch (err) {
    return { status: 'error', error: err.message || 'science research failed' };
  }
}

// ============================================================================
// TWITTER / X SCAN — exploratory stub (deferred)
// ============================================================================
// Twitter scraping on Apify's free tier is tight. Candidate actors include
// apidojo/tweet-scraper (~$0.40 per 1K tweets) and quacker/twitter-scraper
// (rate-limited, variable reliability). A realistic 200-500 tweets/run across
// 5-8 queries scheduled 2-3x/week could stay within the $5/month free Apify
// credit, but it would consume ~30-50% of the monthly budget on Twitter alone,
// leaving less headroom for the Instagram scraper if we ever scale up hashtags.
//
// Recommendation: defer until the Instagram + market + science pipeline is
// stable for 2-3 weeks, then review Apify free-tier budget usage and decide
// whether to add Twitter. At that point the cleanest path is probably
// apidojo/tweet-scraper with a short query list and resultsLimit: 30 per query.
//
// For now this function returns a "deferred" status and the compiler omits
// the section entirely.
export async function runTwitterScan() {
  return {
    status: 'deferred',
    note:
      'Twitter/X scanning deferred pending Apify free-tier budget review. ' +
      'Candidate actor: apidojo/tweet-scraper (~$0.40 per 1K tweets). ' +
      'Revisit after 2-3 weeks of stable IG + market + science runs.',
  };
}

// ============================================================================
// TELEGRAM REPORT COMPILER (Haiku → Telegram HTML)
// Accepts any combination of sections — skipped/deferred sections are omitted
// entirely so the same compiler works for the scheduled cron and for single-
// section on-demand webhook requests.
// ============================================================================
const TELEGRAM_REPORT_SYSTEM = `${DEBBIE_VOICE}

TASK: compile the research data below into a single Telegram brief for the Ritual Ops group. This might be the scheduled brief (all sections) or an on-demand single-section request — adapt to whatever data is present. The goal is a founder briefing that reads in 60 seconds: short, sourced, honest, actionable.

FORMAT RULES
- Telegram HTML ONLY: <b>, <i>, <code>. No markdown, no other HTML, no CSS. Telegram will reject anything else.
- The only emoji permitted are the three section markers (📊 🧠 📸) and only as part of the section headers below. No decorative emoji anywhere else. No 🎉 ✨ 🔍 🏷️ 💡 ⭐.
- HARD LIMIT: 500 words total. Shorter is better.

HEADER
- First line: <b>Debbie's Scout Report — {date from generatedAt, formatted as "D Mon YYYY"}</b>
- No opener, no greeting, no "hi hi hi", no catchphrases. Go straight to content.

SECTION INCLUSION
- Include a section ONLY if its status is 'ok'. Sections with status 'skipped', 'deferred', or absent data MUST be omitted entirely — do NOT mention them at all.
- If a section has status 'error', include it as a single line: "<b>📊 Market Intel</b>\\nScan failed: {short error}. Will retry next run." — do not dwell.
- If only one section has data, present just that one.

SECTIONS (use these exact headers, in this order when present)

<b>📊 Market Intel</b>
- 2-4 bullets MAX. Each: one-line finding — source URL in parens — "Why it matters for Ritual:" one sentence.
- If the raw market data says "No significant market moves" or similar, pass that through as a single line: "No significant market moves this period." Do not pad.
- Preserve any source URLs from the raw data verbatim. Do NOT invent URLs.

<b>🧠 Research Spotlight</b>
- 2-3 bullets MAX. Each: study/article title — source URL in parens — "Key finding:" one sentence. "Implication for Ritual:" one sentence.
- Preserve "(preliminary)" / "(blog)" tags from the raw data.
- If the raw data reports nothing notable, pass that through as a single line: "No new research relevant to Ritual this period."

<b>📸 Instagram Scan</b>
- First line: "{postCount} posts with meaningful engagement ({MIN_LIKES}+ likes or {MIN_COMMENTS}+ comments) out of {totalScanned} scanned across {N} hashtags." — use the fields engagementFloor.minLikes / engagementFloor.minComments / totalScanned / postCount / hashtagsScanned.length from the raw data. If totalScanned is missing, fall back to just the scanned count.
- Competitors / creators worth watching: 1-3 handles with link (post URL from the data) and one reason. Only include creators whose posts are in the filtered list. Do NOT invent handles.
- Emerging themes or hashtags: only if genuinely recurring across multiple posts — one line, with the specific pattern observed.
- If postCount is 0 or there is no meaningful activity: write a single line: "Low activity across tracked hashtags. No actionable signals this period." and stop the section there.
- Do NOT hype small numbers. A post with 15 likes is "moderate traction", not "crushing it". A post with 3 comments is not a trend.

<b>Bottom line</b>
- 1-2 sentences max. The single thing worth paying attention to this week.
- If nothing is worth flagging, write one honest sentence: "Quiet week. Nothing requiring action." Do not invent an insight.

HARD RULES
- NEVER invent creator handles, study authors, publication names, URLs, or numbers. If the raw data doesn't name it, don't name it.
- NEVER describe small numbers as big. "4 likes" is never "crushing it". Use plain language for plain numbers.
- NEVER use all-caps emphasis or catchphrases. No "OH MY GOD", no "STOP EVERYTHING", no "We've got this", no "Onward team", no "binder" or "dossier" references.
- Every market/research claim MUST carry a source URL or named publication. If it doesn't, cut it.
- Short and honest beats long and padded. Every time.`;

export async function compileSocialReport(data) {
  // Pre-format the date so Haiku doesn't hallucinate it.
  const dateStr = new Date(data.generatedAt || Date.now()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  });
  const system = TELEGRAM_REPORT_SYSTEM.replace(
    '{date from generatedAt, formatted as "D Mon YYYY"}',
    dateStr,
  );
  const { text, usage } = await haikuCompile(
    system,
    'Research data:\n' + JSON.stringify(data, null, 2),
    2500
  );
  return { text, usage };
}

// ============================================================================
// TELEGRAM SEND (HTML with plain-text fallback)
// ============================================================================
export async function sendDebbieTelegram(text) {
  if (!DEBBIE_TELEGRAM_TOKEN || !DEBBIE_TELEGRAM_CHAT_ID) {
    throw new Error('Debbie Telegram env vars missing (DEBBIE_TELEGRAM_TOKEN / MAURICE_TELEGRAM_CHAT_ID)');
  }
  const api = `https://api.telegram.org/bot${DEBBIE_TELEGRAM_TOKEN}`;
  const payload = {
    chat_id: DEBBIE_TELEGRAM_CHAT_ID,
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
    console.error('[Debbie] HTML send failed:', res.status, body.slice(0, 200));
    // Strip HTML tags and retry as plain text so the message at least lands
    res = await fetch(`${api}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: DEBBIE_TELEGRAM_CHAT_ID,
        text: String(text).replace(/<[^>]+>/g, ''),
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      throw new Error(`Debbie Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }
  return { sent: true };
}
