---
name: verify-before-claim
description: Enforces that every claim about system state is backed by a fresh observation, not inference. Use this skill during ANY coding, debugging, deployment, migration, OTA update, build, or status-reporting task — especially before saying anything resembling "this works", "this should pass", "the fix is deployed", or "done". Also use it when resuming a session, when reporting progress, and when summarising what state a system is in. If the task touches Beka, Ritual, BekaSafe, Supabase, Capgo, Vercel, or Xcode builds, this skill applies.
---

# Verify Before Claim

## Why this skill exists

The most expensive failure mode in this workspace has never been a wrong answer — it has been a **confident unverified claim**. Real examples that motivated this skill:

- The Capgo OTA pipeline was reported as working while it had been **silently dormant** for weeks. Nothing errored. The claim "OTA updates are live" was inference from configuration, not observation of a delivered update.
- Migration history in the Beka Supabase project is drifted. Any claim of "migrations are in sync" based on reading the migrations folder is false by construction — only the live schema is truth.
- Tests that "should pass" have been reported as passing without being run, and a failing check is sometimes "fixed" by weakening the assertion instead of fixing the bug.

A claim costs nothing to make and everything to unwind. An observation costs one command.

## The core rule

> A claim about system state is only valid if it is backed by an observation made **after the most recent change** to that system.

Everything else in this skill is elaboration of that sentence.

## Banned vocabulary

Never write these phrases as conclusions:

- "This should work / should pass / should be fine"
- "The deploy is probably live"
- "This likely fixed it"
- "Everything looks correct" (when "looks" means "I read the code", not "I ran it")

Only two forms of status claim are permitted:

1. **Verified:** "I ran `<command>` at `<point in sequence>` and observed `<output>`."
2. **Unverified:** "Unverified — here is the exact command/check to confirm: `<command>`."

The second form is not a failure. Saying "unverified" is honest and cheap. Saying "done" when it isn't is the thing this skill kills.

## The verification ladder

When deciding how to verify, prefer the highest rung you can reach:

1. **End-to-end observation** — the actual user-visible behaviour (a magic link round-trip on a real device, an OTA version reported by the live app, an email arriving).
2. **Live-system query** — hit the running system (query the live Supabase schema, curl the healthcheck endpoint, check the deployed version endpoint).
3. **Executed test** — run the test suite or an isolation test and paste the result.
4. **Static check** — build succeeds, linter passes, types check.

Reading the code is rung zero. It is necessary but it verifies nothing about *state*.

## Project-specific verification hooks

These are the known truth-sources in this workspace. When making a claim in one of these areas, verification means this, not less:

| Claim | Required observation |
|---|---|
| "Migration applied" | Query the live schema on the target Supabase project. Never trust the migrations folder — history is drifted. |
| "OTA update live" (Ritual/Capgo) | The live app or Capgo dashboard reports the new version. Config being correct is not delivery. |
| "Build works" | The build actually completed on the machine in question. Signing is per-machine; a green build on the Mac Mini says nothing about the MacBook. |
| "Agent is healthy" (Maurice/Debbie/Pieter) | Hit the `?healthcheck=true` endpoint, or confirm a fresh snapshot row. Absence of error messages is not health — that is exactly how silent dormancy happens. |
| "Deep link / magic link works" | A real round-trip on a device, not a passing unit test. |
| "Deployed to Vercel" | The deployment URL serves the new behaviour, not "the push succeeded". |
| "Both machines in sync" | `git status` clean and `git log` matching origin on the machine being asked about. |

## When a test fails

Fixing a failing test by editing the assertion is only legitimate when the assertion was wrong about the *spec*. Before touching any assertion, write one sentence answering: "Is the test wrong about what the system should do, or is the system wrong?" If the answer is the system, the assertion is out of bounds.

## Resuming sessions

State claimed in a previous session is stale by default. On resume, re-verify anything load-bearing before building on it — especially "what's deployed", "what's migrated", and "which build number is current". Memory of state is not state.
