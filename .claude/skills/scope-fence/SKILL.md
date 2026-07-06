---
name: scope-fence
description: Keeps changes exactly within the requested scope — adjacent problems get flagged, never silently fixed. Use this skill on every coding task, bug fix, review, or edit, especially small ones ("just fix X", "quick change", one-line tickets), because small tasks are where scope creep hides. Applies doubly to anything committed to the Beka, Ritual, or BekaSafe repos.
---

# Scope Fence

## Why this skill exists

The temptation is always virtuous: while fixing the requested bug, you notice a typo, a deprecated call, an ugly pattern — and you fix those too, helpfully. The cost shows up later, and in this workspace it is specific:

- The dual-machine workflow depends on the human being able to *mentally author* every diff. GitHub is the single source of truth between the Mac Mini and the MacBook; a commit containing five unrequested fixes is a diff nobody authored mentally, and it erodes the trust that makes `git pull` safe to run without re-reviewing everything.
- Unrequested changes near invariants (auth, RLS, cascades, entitlements) are exactly how invariants break — nobody scanned the invariant registry for a change nobody planned.
- When something regresses, a single-purpose commit makes the cause obvious. A "fix + tidy-up" commit makes every regression a forensic exercise.

## The rule

> Change what was asked. Everything else you notice goes in a findings log, not in the diff.

"What was asked" means the stated outcome, interpreted honestly — not the narrowest literal reading. If the requested fix *requires* touching an adjacent line to work at all, that is in scope. If it merely *invites* touching one, it is not.

## The findings log

Adjacent problems are valuable — the fence preserves them instead of smuggling them:

- End the task report with a short **Findings** section: each item is one line — what, where, why it matters, and a severity gut-call.
- Genuinely urgent discoveries (a security hole, data loss in progress, a broken compliance path) interrupt the task immediately and get surfaced before continuing. The fence stops silent fixes, not alarms.
- Never let a finding silently expand the current commit. If the human says "yes, fix that too", it becomes scope — ideally as its own commit.

## Commit discipline

One intent per commit. The commit message describes the requested change; if the diff contains anything the message doesn't cover, the fence has been breached — split the commit.

## What this skill does not mean

- It does not mean doing sloppy work inside scope. Within the fence, full quality applies.
- It does not forbid reading widely. Investigate anything; *change* only the target.
- It does not apply to explicitly exploratory tasks ("clean up this module as you see fit") — there, the stated scope *is* broad. The fence takes its size from the request.
