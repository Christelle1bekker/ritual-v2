---
name: agent-build-checklist
description: The Bekker Labs pattern for building monitoring/notification agents (Maurice, Debbie, Pieter, and successors) — every rule tied to a real production failure. Use this skill whenever creating, modifying, extending, or debugging any agent, cron-driven job, Telegram bot, healthcheck, monitoring script, or scheduled notification for Beka, Ritual, or BekaSafe — even for "small tweaks" to an existing agent.
---

# Agent Build Checklist

## Why this skill exists

Each rule below was paid for. Maurice's early versions failed silently, formatted messages inconsistently under LLM flakiness, and let one broken check take down the whole report. The single scariest failure class for a monitoring agent is not crashing — it is **dying quietly while everyone assumes it's watching**. This is the same failure shape as the Capgo pipeline going silently dormant: no errors, no output, no alarm.

An agent that crashes loudly is a bug. An agent that fails silently is a false sense of security, which is worse than no agent.

## The pattern

**Architecture**
- Zero npm dependencies. All logic in `lib/<agent>-core.js`, with thin `api/` handlers that only parse the request and call core. *Why:* dependencies are an update treadmill and a supply-chain surface for something that must run unattended for months; thin handlers keep the core testable without a server.
- Env vars namespaced with the agent's prefix (e.g. `PIETER_`). *Why:* multiple agents share Vercel projects and scopes; unprefixed vars collide silently.
- `vercel.json` must include the `/((?!api/).*)` rewrite. *Why:* omitting it has broken routing on every agent that forgot it.

**Failure isolation**
- Run every independent check through `Promise.allSettled`, never bare `Promise.all`. *Why:* with `Promise.all`, one failing check rejects the batch and the report never sends — the healthy checks' results are lost precisely when you most need a report saying "check 3 is broken".
- Each check's failure renders in the output as a visible per-check error line, not an omission. A missing section looks like "nothing to report"; a ❌ line looks like what it is.

**Output**
- The message formatter is deterministic code, not an LLM call. *Why:* Maurice's LLM-formatted reports varied in structure and occasionally dropped fields; a monitoring report must be boringly identical every day so anomalies jump out. If an LLM adds value (summarising), it augments a deterministic skeleton — it never owns the skeleton.

**Liveness (the non-negotiable)**
- Dead-man's switch: every successful run writes a snapshot row (e.g. `pieter_snapshots`) with a timestamp. Staleness of the latest snapshot is itself checkable, so "the agent hasn't run" becomes an observable fact rather than a silence.
- `?healthcheck=true` escape hatch on every handler, checked **before** auth. *Why:* when the agent breaks, the first question is "is the deployment even alive?" — if the healthcheck sits behind auth, an auth bug makes the agent undiagnosable exactly when it's broken.
- Scheduling via external cron (cron-job.org), not platform-internal cron. *Why:* the scheduler must fail independently of the deployment, and external cron gives its own execution history to check against the snapshots.

**Data hygiene**
- Aggregate-only in reports — counts and statuses, never user-identifiable data. *Why:* reports travel through Telegram; the agent must be safe to screenshot.

## Definition of done

An agent change is done when (per `verify-before-claim` standards):

1. The healthcheck endpoint returns healthy on the live deployment.
2. A real run has executed end-to-end and the message arrived in Telegram.
3. A fresh snapshot row exists with the expected timestamp.
4. At least one check has been deliberately broken in a test to confirm the run still completes and the failure renders visibly.

Step 4 is the one that gets skipped and the one that matters most: you are not testing that the agent works — you are testing that it **fails loudly**.
