---
name: feedback-first
description: Before starting substantive work, identify — or build — the fastest automatic feedback loop, and run it at start and finish. Use this skill at the beginning of any coding session, feature build, refactor, or debugging task in any repo (beka/saam, ritual-v2, bekasafe, agent projects), and whenever starting work in an area that has no tests. Especially important for long or multi-step tasks where drift accumulates.
---

# Feedback First

## Why this skill exists

Independent testing of frontier models converged on one deeply practical finding: the capability gap between a stronger and a weaker model **shrinks dramatically when the environment gives immediate error feedback**. A mid-tier model with fast tests, linters, and healthchecks performs close to a top-tier model relying on raw self-verification. The most valuable "skill" is therefore partly not instructions at all — it is making the repo answer back.

Discipline written in markdown can be ignored under pressure. A failing test cannot. Every hour spent building a feedback loop is an hour that upgrades *every future session on that repo, on every model*.

## The session-start ritual

Before substantive edits (and after the `git pull` that starts any dual-machine session):

1. **Identify the fastest loop** for the area being touched — a test file, a build, a lint command, a healthcheck endpoint, an isolation-test suite.
2. **Run it once before changing anything.** This baselines the loop: if it fails now, the failure predates this session, and that fact is worth knowing before it gets blamed on new work.
3. If the honest answer to step 1 is "there is no loop" — see below.

## When there is no loop: build a smoke test first

If the area has no automatic check, the first deliverable of the task is a minimal smoke test — before the feature work. Minimal means minutes, not hours:

- A script that hits the healthcheck and version endpoints and asserts on the response.
- A single test that exercises the one invariant the task is most likely to break (the isolation tests T1–T7 for Beka's family model are the house example of this done right).
- A build-and-boot check where nothing finer exists.

This feels like a detour. It is the opposite: on a task of any length, the smoke test pays for itself the first time it catches drift mid-task instead of post-deploy — and it remains in the repo afterwards, compounding.

## During and after

- Re-run the loop at natural checkpoints on long tasks, not only at the end — drift caught at step 3 costs one step; drift caught at step 9 costs nine.
- The finish line is defined by `verify-before-claim`: the loop passing after the final change is the minimum bar for "done", and the result gets pasted, not paraphrased.

## Ratchet, never loosen

Feedback loops only compound if they stay trustworthy:

- Never weaken an assertion to make a loop pass (see `verify-before-claim` on when assertions may change).
- Never mark a flaky test as skipped without a logged finding (see `scope-fence` — flakiness is a finding, not an invisible edit).
- When a bug escapes to production or to the other machine, the closing step of the fix is asking: "what one-line check would have caught this?" — and adding it. The Capgo silent-dormancy incident is the canonical case: a version-endpoint check written after the fact would have caught weeks of dormancy in one cron run. Write that check *before* the next incident, not after.
