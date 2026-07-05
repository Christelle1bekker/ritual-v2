# Capgo OTA Restore — Phase 1 Investigation Report

**Date:** 2026-07-05 · **Branch:** `ops/restore-capgo-ota` · **Status:** Phase 1 complete, awaiting review before Phase 2 (staging the re-enable)

---

## Executive summary

- OTA autoUpdate was disabled in `cc0ca11` (2026-05-05) because a **stale Capgo cloud bundle silently and persistently replaced newer TestFlight-bundled JS** on Christelle's phone, reintroducing already-fixed bugs. It was an operational/publishing-discipline failure, **not an OTA↔NFC incompatibility** — the NFC changes in the same commit were unrelated smoke-test triage.
- The receive side is intact (plugin installed, `notifyAppReady()` correctly placed pre-render) and the send side is **live and valid** (app `com.ritualhabits.app` exists on Capgo, `production` channel active, credential works).
- Root-cause detail: Capgo's "no downgrade below native version" guardrail was structurally inert because the iOS `MARKETING_VERSION` is a flat `1.0` while bundles are `1.0.x` — every cloud bundle compares ≥ `1.0`, so downgrades were never blocked.
- **Recommendation: `autoUpdate: true`** (plain auto), plus three guardrails that make the May failure structurally impossible: version lockstep (`MARKETING_VERSION` = `package.json` version), channel downgrade protection, and a publish-with-every-native-build rule codified in the runbook.
- Flipping the flag today is a no-op until we publish a new bundle: the `production` channel bundle (1.0.44) equals the current app version, so no update would be delivered. The first real delivery is the verification bundle (1.0.45) per the ship-day runbook.

---

## 1. Why OTA was disabled — and whether the reason still applies

### The evidence

Commit `cc0ca11` (2026-05-05, "fix(app+ios): disable Capgo autoUpdate + explicit scan dismiss + bundle diag") bundles three unrelated fixes from a TestFlight build-22 smoke test. The OTA-relevant part, verbatim:

> 2. Capgo OTA permanently replaced our bundled JS with an older cloud
>    bundle mid-session. The [DEBUG] button vanished and stayed gone across
>    app restarts, confirming the swap was persistent, not just a hot reload.
>
> 3. The cloud bundle stuck on Christelle's phone post-swap is meaningfully
>    stale - predates fixes from TestFlight builds 11-18 (hold-to-undo,
>    hold-to-complete bugs reproduced). Capgo cloud has not been kept in
>    lockstep with TestFlight uploads from Willem's machine. autoUpdate:
>    true is therefore actively harmful here, not just inconvenient. Setting
>    to false until a Capgo publishing discipline is established.

The diff flipped `autoUpdate: true → false` in both `capacitor.config.ts` and `ios/App/App/capacitor.config.json`, and added a startup diagnostic (`src/index.js:16-25`) logging the active bundle.

### Not an NFC incompatibility

- The NFC hunk in `cc0ca11` (`src/hooks/useNfcScanner.js`: explicit `stopScanning()` after URL extraction) addressed a scan-sheet dismiss bug — issue #1 in the commit message, causally unconnected to the OTA swap (issues #2–3).
- The subsequent NFC churn (`b6311cd` remove → `50ff729` restore with 750ms settle delay) never touched the OTA flag.
- No commit, comment, TODO, or doc anywhere in history claims OTA interfered with NFC. `git log -S autoUpdate --all` shows exactly one on→off cycle, no reverts.
- The later NFC-reliability audit (`spike/nfc-reliability-audit.md`, 2026-07-03) even notes its fixes "can ship via Capgo" — treating OTA as compatible in principle.

### Does the reason still apply?

**Partially — and that's fixable without staying dark.** The stated condition for re-enabling was "until a Capgo publishing discipline is established." No discipline was ever established (no publish script, no CI, no runbook existed). The failure mode remains possible today if we flip the flag and then let the channel drift stale again. Phase 2 therefore pairs the flag flip with structural guardrails (§4) rather than relying on memory.

One latent trap worth naming: `package.json` is still `1.0.44` (bumped 2026-04-12) while roughly three months of code has landed since. Version numbers alone can lie about staleness — the runbook makes "bump before every publish" mandatory so a version number always identifies exactly one bundle.

---

## 2. Current state inventory (all claims verified firsthand)

| Item | Value | Evidence |
|---|---|---|
| `autoUpdate` (TS config) | `false` | `capacitor.config.ts:19` |
| `autoUpdate` (shipped iOS config) | `false` — agrees with TS | `ios/App/App/capacitor.config.json:15` |
| Other CapacitorUpdater keys | none (`channel`, `updateUrl`, `statsUrl`, `directUpdate` all unset → Capgo cloud defaults) | `capacitor.config.ts:18-20` |
| Android config | n/a — no `android/` directory yet | repo root |
| Plugin installed | `@capgo/capacitor-updater` **8.45.0** | `package.json:17`, lockfile |
| Plugin latest | **8.50.2** — same major, straight minor/patch run, no breaking changes; majors track Capacitor majors and this is a Capacitor 8 app (`@capacitor/core` 8.3.0, `package.json:9`) | `npm view` |
| `notifyAppReady()` | Called **unconditionally pre-render** (correct — prevents false rollback if app crashes to error boundary), plus belt-and-suspenders repeat | `src/index.js:9-14`; `src/App.js:4744` |
| Diagnostics | `current()` startup log; listeners for `updateAvailable` / `downloadComplete` / `downloadFailed` / `updateFailed` / `appReloaded` | `src/index.js:18-25`; `src/App.js:4752-4766` |
| Manual triggers | none — no `getLatest`/`download`/`set`/`setChannel` anywhere in src | grep |
| App ID | `com.ritualhabits.app`, identical in TS config, iOS config, and live on Capgo | `capacitor.config.ts:4`, `capacitor.config.json:2`, CLI |
| Publish credential | `~/.capgo` login key on this machine (works — see §3). No key in repo, no CI, no publish script | `package.json` scripts; no `.github/` |
| iOS native version | `MARKETING_VERSION = 1.0` (flat), `CURRENT_PROJECT_VERSION = 34` | `project.pbxproj:302,310` |
| Service worker | cache-firsts non-supabase hosts with no Capgo-host bypass — **not a blocker** (Capgo downloads run through native networking, not the webview fetch/SW pipeline), noted for completeness | `public/service-worker.js` |

## 3. Send side — live and valid (checked read-only, 2026-07-05)

`npx @capgo/cli app list / channel list / bundle list` with the local `~/.capgo` key:

- App **Ritual / `com.ritualhabits.app`** exists (created 2026-03-26).
- Channels: **`production`** (public, iOS+Android enabled, currently serving bundle **1.0.44**) and `dev` (private, 1.0.21).
- Bundles on server: only `1.0.21` (2026-03-29) and `1.0.44` (2026-04-12) survive; the early 1.0.2–1.0.34 run is gone. Last upload was ~3 months ago — consistent with the "not kept in lockstep" failure.
- Channel `production` update strategy: `major` (blocks major-version-crossing updates). The downgrade-under-native toggle (CLI `--no-downgrade`) shows disallowed in the channel listing, but see §4 — it can't bite until native versioning is fixed.
- **A publish would succeed today.** Nothing was uploaded (read-only commands only).

## 4. Root cause, precisely — and the guardrails that fix it

The May incident required three failures to line up:

1. **Stale channel** — the cloud bundle predated weeks of TestFlight-shipped JS (no publish discipline).
2. **Inert downgrade guardrail** — Capgo can refuse bundles older than the native app version, but the native `MARKETING_VERSION` is a flat `1.0` while bundles are `1.0.x`; every bundle satisfies `≥ 1.0`, so "older than native" was undetectable. Verified at `project.pbxproj:310`.
3. **autoUpdate applied whatever the channel served** — by design.

Staying dark only addresses #3 by abandoning OTA entirely. The guardrails staged in Phase 2 address #1 and #2 so #3 becomes safe:

- **Version lockstep:** set `MARKETING_VERSION` to the `package.json` version (1.0.45 for the restore build) and keep them in lockstep on every native build. Now "downgrade under native" is a real comparison.
- **Channel protection:** enforce `--no-downgrade` on `production` (idempotent `channel set`, in the runbook).
- **Publish discipline:** runbook rule — every native build day ends with `bundle upload` of the same JS to `production`; every publish is preceded by a `package.json` version bump; never re-upload an existing version.

## 5. Mechanism recommendation: `autoUpdate: true` (plain auto)

**Recommended.** Reasoning:

- **The failure was staleness, not timing.** A controlled/manual trigger (`getLatest` + `download` + `set`) would not have prevented the May incident — it would have pulled the same stale bundle. The fix is the guardrails above, which work identically under auto.
- **No NFC timing hazard.** Capgo v8's default auto behavior downloads in the background and applies the new bundle on backgrounding/relaunch — never a mid-foreground reload (we leave `directUpdate` unset). An NFC scan is a short foreground interaction; a bundle swap cannot interrupt it. The May "mid-session" swap is consistent with apply-on-background (the persistent part — surviving restarts — was the staleness problem, not the timing).
- **Matches the workflow.** "Ship JS fast without Xcode" was the whole point (bundles 1.0.2→1.0.34 in the first week), and it's the intended Android launch path. Manual triggers add code, states, and failure modes for a control we don't need; staged rollout is available later via Capgo channel settings without any code change.
- **Rollback safety is already correct:** `notifyAppReady()` fires unconditionally before React renders (`src/index.js:10`), so a bundle that crashes the app rolls back automatically.

## 6. Proposed Phase 2 (staged on branch, nothing shipped) — awaiting sign-off

1. `autoUpdate: true` in `capacitor.config.ts` + `npx cap sync`-propagated `ios/App/App/capacitor.config.json` — one commit.
2. Plugin bump 8.45.0 → 8.50.2 (safe same-major; lands in the same native build Willem is doing anyway) — separate commit.
3. Version alignment: `package.json` → **1.0.45**, `MARKETING_VERSION` → **1.0.45** — the restore build carries it.
4. Verification bundle: a small visible version marker change (the Settings screen already renders `Ritual v1.0.44` at `src/App.js:4332` — it will read `v1.0.45` plus a distinct marker), own commit, easy to revert.
5. Ship-day runbook (Willem's one Xcode build → publish 1.0.45 → verify on device → rollback procedure) appended to this file.

**Nothing merges, nothing uploads to Capgo, until sign-off. "Configured" ≠ "working" — OTA is only proven when the 1.0.45 marker appears on a real device after the native build.**
