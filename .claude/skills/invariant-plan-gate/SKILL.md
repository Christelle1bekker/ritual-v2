---
name: invariant-plan-gate
description: Requires a short written plan — including a list of invariants that must survive the change — before any multi-file edit, refactor, schema migration, or architectural change. Use this skill whenever a task will touch more than one file, any database schema, any auth/RLS boundary, or any compliance-relevant code path in Beka, Ritual, or BekaSafe. Also use it when a task says "refactor", "restructure", "clean up", "migrate", or "rebuild", even casually.
---

# Invariant Plan Gate

## Why this skill exists

Smaller models rarely lose to complexity directly. They lose **the constraint they weren't currently looking at**. A change is made competently, file by file, and an invariant that lived three files away is broken without ever entering working memory.

The near-miss that motivates this: decommissioning Dashy required a `delete_family_cascade` patch, because deleting an apparently unrelated project could have severed Beka's App Store account-deletion compliance path. The dangerous change didn't look dangerous. The invariant was invisible from the file being edited.

Writing the plan is not bureaucracy — it is the act of loading the invariants into working memory *before* the first edit, when they can still shape the approach.

## The gate — two tiers

**Full plan (mandatory)** when the change touches any database schema, any auth/RLS boundary, any compliance-relevant code path, or when the task is worded "refactor", "restructure", "migrate", "rebuild", or "clean up" — however casually.

**Registry scan (lightweight)** for ordinary multi-file edits outside those categories: scan the invariant registry below and state inline either "invariants at risk: none" or the specific invariants touched (which escalates the task to a full plan). No four-part document required. The scan is the load-bearing behaviour; the document is only warranted when risk is.

For the full-plan tier: no edits until a plan exists containing these four parts. Keep it short — five to fifteen lines total. The value is in the thinking, not the document.

1. **Goal** — one sentence, the outcome (not the steps).
2. **Invariants at risk** — which items from the registry below (plus any task-specific ones) could this change touch? If the honest answer is "none", say so explicitly — writing "none touched" forces the scan.
3. **Unknowns** — what you don't currently know that could change the approach. Resolve or explicitly defer each one.
4. **Success criteria + verification** — what observation proves it worked (hand off to `verify-before-claim` for the standard).

If mid-task the plan turns out to be wrong, stop and revise the plan — do not pivot silently. A half-executed old plan plus a half-executed new one is the classic drift failure.

## Invariant registry

These are the standing invariants in this workspace. Scan this list at plan time for every gated change:

**Beka (saam repo, Supabase `gxcnltuopejmeozltgla`)**
- `delete_family_cascade` must remain intact — it is the App Store account-deletion compliance path.
- Migration history is drifted: never naive `db push`; reconcile history or apply idempotently. Claude Code owns and applies migrations directly.
- `family_entitlements` is the single source of truth for monetisation; `monetisation_enabled` stays dormant at launch.
- Family data isolation (the property proven by isolation tests T1–T7) must survive any change to invites, joins, or RLS.
- Magic-link / Universal Links auth flow (Rev 3) — deep-link handling is fragile under refactor.
- Android scaffold (parked branch `android-scaffold`, 2026-07-07): Android `versionCode`/`versionName` mirror the iOS build/marketing numbers — bump together (Capgo-lockstep lesson). Tooling quirk: `npx capacitor-assets generate --android` re-serialises `ios/App/App.xcodeproj/project.pbxproj` (formatting-only churn) — restore it, never commit it.

**Ritual**
- Capgo version lockstep and `--no-downgrade` — version fields must move together or OTA silently stops.
- RLS + PIN hashing are flagged security priorities; changes near auth must not widen access.
- Open `ios/App/App.xcodeproj`, not `.xcworkspace` (SPM, no workspace file).

**BekaSafe**
- `founder_approved` is enforced at three code layers; a change removing any one layer is a broken invariant even if the other two still hold.
- Invite-code signup gate must not acquire a bypass path.

**Cross-cutting**
- GitHub is the single source of truth between machines. Build-number bumps commit and push immediately. Never sync machines directly.
- Agents (Maurice/Debbie/Pieter) keep zero npm deps and the `?healthcheck=true` escape hatch before auth.

Maintain this registry: when a task reveals a new standing invariant, add it here as part of finishing the task.

## Boundaries, not scripts

The plan constrains *what must remain true*, not *every step to take*. Choose the path freely within the invariants. If two invariants genuinely conflict, stop and surface the conflict rather than quietly sacrificing one.
