// api/daily-report.js
// Maurice v2 — daily automated HEALTH-FIRST report for Ritual Habits.
//
// Triggered by cron-job.org at 06:30 AEST with a Bearer MAURICE_CRON_SECRET header.
// Also callable with ?healthcheck=true (no auth) as a liveness probe — used by
// apiRouteCheck in lib/maurice-core.js to self-verify serverless functions are alive.
//
// Social/market research was removed in v2 (moves to the future Debbie agent).
// All shared logic lives in ../lib/maurice-core.js.

import {
  runAllHealthChecks,
  runUsageReport,
  runCompile,
  sendEmail,
  sendDailyTelegramReport,
  fallbackHtml,
  cronWatchdog,
  supabaseHealthCheck,
  melbourneDateISO,
} from '../lib/maurice-core.js';

export const config = { maxDuration: 60 };

// ============================================================================
// HEALTH SUMMARY (small helpers local to the handler response shape)
// ============================================================================
function deriveOverall(health) {
  if (!health || health.error) return 'error';
  const statuses = [];
  if (Array.isArray(health.urlChecks)) {
    statuses.push(...health.urlChecks.map((u) => (u.ok ? 'ok' : 'error')));
  }
  const add = (v) => {
    if (v?.status) statuses.push(v.status);
    else if (v?.ok === false) statuses.push('error');
    else if (v?.error) statuses.push('error');
    else if (v?.warning) statuses.push('warning');
  };
  add(health.supabase);
  add(health.ssl);
  add(health.capgo);
  add(health.apiRoute);
  add(health.aasa);
  add(health.resend);
  if (statuses.some((s) => s === 'error')) return 'error';
  if (statuses.some((s) => s === 'warning')) return 'warning';
  return 'ok';
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
export default async function handler(req, res) {
  // 0. Healthcheck escape hatch — no auth, used by self-ping from apiRouteCheck
  const url = new URL(req.url || '/', 'https://localhost');
  if (url.searchParams.get('healthcheck') === 'true') {
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  }

  // 1. Auth
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!process.env.MAURICE_CRON_SECRET || authHeader !== `Bearer ${process.env.MAURICE_CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();
  const tokenUsage = { compileInput: 0, compileOutput: 0 };

  // 2. Cron watchdog — reads previous last_run_at BEFORE we overwrite it later.
  //    Also tells us the previous bundle version so Capgo can detect changes.
  const watchdog = await cronWatchdog();
  const previousBundleVersion = watchdog.lastBundle || null;

  // 3. Parallel: full health block + usage block
  const [healthR, usageR] = await Promise.allSettled([
    runAllHealthChecks(previousBundleVersion),
    runUsageReport(),
  ]);

  const health =
    healthR.status === 'fulfilled'
      ? healthR.value
      : { error: healthR.reason?.message || 'health failed' };
  const usage =
    usageR.status === 'fulfilled'
      ? usageR.value
      : { error: usageR.reason?.message || 'usage failed' };

  const currentBundle = health?.capgo?.bundleVersion || null;

  // 4. Compile HTML via Haiku
  const rawData = {
    generatedAt: new Date().toISOString(),
    melbourneToday: melbourneDateISO(0),
    yesterday: melbourneDateISO(-1),
    tomorrow: melbourneDateISO(1),
    watchdog,
    health,
    usage,
  };

  let subject = `Maurice Daily Report — ${melbourneDateISO(-1)}`;
  let html = fallbackHtml(rawData);
  let compileError = null;
  try {
    const compiled = await runCompile(rawData);
    subject = compiled.subject;
    html = compiled.html;
    if (compiled.usage) {
      tokenUsage.compileInput = compiled.usage.input_tokens || 0;
      tokenUsage.compileOutput = compiled.usage.output_tokens || 0;
    }
  } catch (err) {
    compileError = err.message;
    console.error('[Maurice] Compile failed:', err.message);
  }

  // 5. Send email
  let emailSent = false;
  let emailError = null;
  try {
    await sendEmail(subject, html);
    emailSent = true;
  } catch (err) {
    emailError = err.message;
    console.error('[Maurice] Email send failed:', err.message);
  }

  // 6. Persist last_run_at ONLY when the email actually went out.
  //    Keeps the cron watchdog honest — missed email = missed run.
  let persistResult = null;
  let persistError = null;
  if (emailSent) {
    persistResult = await supabaseHealthCheck(currentBundle);
    if (persistResult.status !== 'ok') {
      persistError = persistResult.error || 'persist failed';
    }
  }

  // 6b. Bonus channel: post the Moss-voiced morning summary to the Ritual Ops
  //     Telegram group. Reuses the same health + usage data compiled for the
  //     email — no extra queries. If this fails, we log and move on. The email
  //     is the primary record; Telegram is the bonus, and must never fail the run.
  let telegramSent = false;
  let telegramError = null;
  if (emailSent) {
    try {
      await sendDailyTelegramReport({ health, usage, watchdog });
      telegramSent = true;
    } catch (err) {
      telegramError = err.message;
      console.error('[Maurice] Telegram morning post failed:', err.message);
    }
  }

  const elapsedMs = Date.now() - startTime;
  const totalTokens = tokenUsage.compileInput + tokenUsage.compileOutput;
  console.log(
    `[Maurice v2] done. elapsed=${elapsedMs}ms tokens=${totalTokens} ` +
      `compile=${tokenUsage.compileInput}/${tokenUsage.compileOutput} ` +
      `overall=${deriveOverall(health)}`
  );

  // 7. Response
  return res.status(200).json({
    success: emailSent,
    timestamp: new Date().toISOString(),
    elapsedMs,
    overall: deriveOverall(health),
    healthSummary: {
      urlsOk: Array.isArray(health.urlChecks)
        ? health.urlChecks.filter((u) => u.ok).length
        : 0,
      urlsTotal: Array.isArray(health.urlChecks) ? health.urlChecks.length : 0,
      supabase: health.supabase?.status === 'ok' || health.supabase?.families != null,
      sslDaysLeft: health.ssl?.daysLeft ?? null,
      capgoBundle: health.capgo?.bundleVersion || null,
      capgoChanged: health.capgo?.changed || false,
      apiRoute: health.apiRoute?.status || null,
      apiRouteMs: health.apiRoute?.responseTime || null,
      aasa: health.aasa?.status || null,
      resend: health.resend?.status || null,
      watchdog: watchdog?.status || null,
      watchdogHours: watchdog?.hoursSinceLastRun ?? null,
    },
    totalTaps: usage?.totalTapsYesterday ?? null,
    emailSent,
    telegramSent,
    errors: {
      health: health?.error || null,
      usage: usage?.error || null,
      compile: compileError,
      email: emailError,
      persist: persistError,
      telegram: telegramError,
    },
    tokenUsage,
  });
}
