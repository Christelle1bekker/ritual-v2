// api/social-report.js
// Debbie — scheduled social media + market + behavioural science scan.
//
// Triggered by cron-job.org a few times a week with Bearer MAURICE_CRON_SECRET
// (reuses Maurice's cron secret so no new env var is needed).
// Also callable with ?healthcheck=true (no auth) as a liveness probe.
//
// Flow:
//   1. Auth
//   2. Run Instagram scan, market research, science research, twitter stub in parallel
//   3. Compile a Leslie-Knope-voiced Telegram post via Haiku
//   4. Send to the Ritual Ops group via Debbie's Telegram bot
//   5. Return JSON summary
//
// All shared logic lives in ../lib/debbie-core.js.

import {
  runInstagramScan,
  runMarketResearch,
  runBehaviouralScience,
  runTwitterScan,
  compileSocialReport,
  sendDebbieTelegram,
} from '../lib/debbie-core.js';

export const config = { maxDuration: 60 };

// ============================================================================
// FALLBACK POST — structured plain-ish HTML if the Haiku compiler throws.
// The scheduled run should never fail silently: if we have any data at all,
// we want the team to see it. Tone matches the new briefing voice — no hype,
// no catchphrases — so the fallback isn't embarrassingly off-key.
// ============================================================================
function buildFallbackPost(data) {
  const esc = (s) =>
    String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const dateStr = new Date(data.generatedAt || Date.now()).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Australia/Melbourne',
  });

  const lines = [];
  lines.push(`<b>Debbie's Scout Report — ${esc(dateStr)}</b>`);
  lines.push('<i>Formatter failed; raw findings below.</i>');

  if (data.market?.status === 'ok' && data.market?.text) {
    lines.push('');
    lines.push('<b>📊 Market Intel</b>');
    lines.push(esc(String(data.market.text).slice(0, 1500)));
  } else if (data.market?.status === 'error') {
    lines.push('');
    lines.push(`<b>📊 Market Intel</b>`);
    lines.push(`Scan failed: ${esc(data.market.error || 'unknown error')}. Will retry next run.`);
  }

  if (data.science?.status === 'ok' && data.science?.text) {
    lines.push('');
    lines.push('<b>🧠 Research Spotlight</b>');
    lines.push(esc(String(data.science.text).slice(0, 1500)));
  } else if (data.science?.status === 'error') {
    lines.push('');
    lines.push(`<b>🧠 Research Spotlight</b>`);
    lines.push(`Scan failed: ${esc(data.science.error || 'unknown error')}. Will retry next run.`);
  }

  if (data.instagram?.status === 'ok') {
    const ig = data.instagram;
    const totalScanned = ig.totalScanned ?? ig.postCount ?? 0;
    const postCount = ig.postCount || 0;
    const hashtagCount = ig.hashtagsScanned?.length || 0;
    const floor = ig.engagementFloor || { minLikes: 15, minComments: 3 };
    lines.push('');
    lines.push('<b>📸 Instagram Scan</b>');
    if (postCount === 0) {
      lines.push('Low activity across tracked hashtags. No actionable signals this period.');
    } else {
      lines.push(
        `${postCount} posts with meaningful engagement (${floor.minLikes}+ likes or ${floor.minComments}+ comments) out of ${totalScanned} scanned across ${hashtagCount} hashtags.`,
      );
      const top = (ig.posts || []).slice(0, 3);
      for (const p of top) {
        lines.push(
          `• @${esc(p.ownerUsername || 'unknown')} — ${p.likesCount || 0} likes, ${p.commentsCount || 0} comments${p.url ? ' (' + esc(p.url) + ')' : ''}`,
        );
      }
    }
  } else if (data.instagram?.status === 'error') {
    lines.push('');
    lines.push('<b>📸 Instagram Scan</b>');
    lines.push(`Scan failed: ${esc(data.instagram.error || 'unknown error')}. Will retry next run.`);
  }

  lines.push('');
  lines.push('<b>Bottom line</b>');
  lines.push('Formatter failed — see raw findings above.');
  return lines.join('\n');
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
export default async function handler(req, res) {
  // 0. Healthcheck escape hatch (no auth)
  const url = new URL(req.url || '/', 'https://localhost');
  if (url.searchParams.get('healthcheck') === 'true') {
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  // 1. Auth — reuses Maurice's cron secret
  const authHeader = req.headers['authorization'];
  if (!process.env.MAURICE_CRON_SECRET) {
    console.error('[Debbie] MAURICE_CRON_SECRET env var is not set — rejecting cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (authHeader !== `Bearer ${process.env.MAURICE_CRON_SECRET}`) {
    console.error(`[Debbie] Cron auth failed — expected Bearer token, got: ${authHeader ? 'mismatched token' : 'no Authorization header'}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const startTime = Date.now();

    // 2. Run all four scans in parallel. Twitter is a stub that returns quickly.
    const [igR, marketR, scienceR, twitterR] = await Promise.allSettled([
      runInstagramScan(),
      runMarketResearch(),
      runBehaviouralScience(),
      runTwitterScan(),
    ]);

    const unwrap = (r, label) =>
      r.status === 'fulfilled'
        ? r.value
        : { status: 'error', error: r.reason?.message || `${label} failed` };

    const data = {
      generatedAt: new Date().toISOString(),
      instagram: unwrap(igR, 'instagram'),
      market: unwrap(marketR, 'market'),
      science: unwrap(scienceR, 'science'),
      twitter: unwrap(twitterR, 'twitter'),
    };

    // 3. Compile via Haiku → Telegram HTML
    let post;
    let compileError = null;
    try {
      const compiled = await compileSocialReport(data);
      post = compiled.text;
    } catch (err) {
      compileError = err.message;
      console.error('[Debbie] Compile failed:', err.message);
      post = buildFallbackPost(data);
    }

    // 4. Send to the Ritual Ops group
    let telegramSent = false;
    let telegramError = null;
    try {
      await sendDebbieTelegram(post);
      telegramSent = true;
    } catch (err) {
      telegramError = err.message;
      console.error('[Debbie] Telegram send failed:', err.message);
    }

    const elapsedMs = Date.now() - startTime;
    console.log(
      `[Debbie] done. elapsed=${elapsedMs}ms ig=${data.instagram.status} ` +
        `market=${data.market.status} science=${data.science.status} ` +
        `sent=${telegramSent}`,
    );

    // 5. Response
    return res.status(200).json({
      success: telegramSent,
      timestamp: new Date().toISOString(),
      elapsedMs,
      summary: {
        instagramStatus: data.instagram.status,
        instagramPosts: data.instagram.postCount || 0,
        marketStatus: data.market.status,
        scienceStatus: data.science.status,
        twitterStatus: data.twitter.status,
      },
      telegramSent,
      errors: {
        instagram: data.instagram.error || null,
        market: data.market.error || null,
        science: data.science.error || null,
        compile: compileError,
        telegram: telegramError,
      },
    });
  } catch (err) {
    console.error('[Debbie] Unhandled error in social-report handler:', err);
    return res.status(500).json({ error: err.message || 'internal error' });
  }
}
