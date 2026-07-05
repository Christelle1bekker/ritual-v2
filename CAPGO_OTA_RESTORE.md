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

**Nothing merges, nothing uploads to Capgo, until sign-off. "Configured" ≠ "working" — OTA is only proven when the verification marker appears on a real device after the native build.**

---
---

# Part 2 — Staged changes & ship-day runbook

**Staged:** 2026-07-05, on `ops/restore-capgo-ota`. Nothing merged, nothing published.

## What is staged on the branch

| Commit | What it does |
|---|---|
| `6ec0aa1` | Phase 1 investigation report (Part 1 above) |
| `cf2a185` | `autoUpdate: true` in `capacitor.config.ts` + `ios/App/App/capacitor.config.json` |
| `cb7f55a` | `@capgo/capacitor-updater` 8.45.0 → 8.50.2 (same major, no migration) |
| `246ead9` | Version alignment 1.0.45: `package.json`, `MARKETING_VERSION` (was flat `1.0`), UI marker |
| runbook commit — **tagged `ota-build-point`** | This runbook. **The native build is cut from this tag.** |
| branch tip (after the tag) | **VERIFICATION BUNDLE** — 1.0.46 + `Ritual v1.0.46 (OTA)` marker. Deliberately *excluded* from the native build so the OTA delivery is visibly distinguishable from the natively-bundled JS. Merged and published only in step E, after the build is on a device. |

---

## ⚠️ THE THREE GUARDRAILS — load-bearing, permanent, not optional

These three rules — not the `autoUpdate` flag — are what prevent a repeat of May 2026 (stale cloud bundle silently downgrading newer shipped JS, `cc0ca11`). OTA sat dead for two months because "establish publishing discipline later" was never written anywhere enforceable. This section is that enforceable place. If any of these lapses, turn `autoUpdate` off again.

### Guardrail 1 — `MARKETING_VERSION` ↔ `package.json` lockstep
Every native build sets `MARKETING_VERSION` (both occurrences in `ios/App/App.xcodeproj/project.pbxproj`) equal to the `package.json` version at that moment. Between native builds, JS-only releases bump `package.json` **upward only**. Result: every bundle version is ≥ the native version it lands on, so Capgo's built-in "never install a bundle older than the native app" check has a real number to compare. (It was inert for the whole May incident because native said flat `1.0` and every `1.0.x` bundle passed.)

### Guardrail 2 — `--no-downgrade` on the `production` channel
Server-side backstop: even if versions are ever mishandled, Capgo refuses to serve a bundle whose version is below the requesting device's native version. Applied in step E3; **idempotent — safe to re-run any time you're unsure:**
```sh
npx @capgo/cli channel set production com.ritualhabits.app --no-downgrade --apikey "$(cat ~/.capgo)"
```

### Guardrail 3 — publish with every native build
The `production` channel must never fall behind what's shipped through TestFlight/App Store. **Same day as any native build upload**, publish the identical JS to the channel (steps B/E give the exact commands). A device that already has newer native JS won't take the equal-version bundle (no-op), but a device on an older native build gets brought current — the channel never again serves something older than the newest shipped JS.

### Standing bump rules after ship day

| You changed… | Then… |
|---|---|
| JS only | Bump `package.json` patch version → `npm run build` → `bundle upload` to `production`. Two commands, no Xcode. |
| Anything native (plugin add/update, config, entitlements) | Bump `package.json` AND set `MARKETING_VERSION` to match → native build via Xcode → TestFlight → **and** upload the same JS to the channel (Guardrail 3). |

When the Android app lands, the same rules apply unchanged — the `production` channel already has Android enabled.

---

## Ship-day runbook

Every step is labelled **CC** (Claude Code runs it in a terminal — these are not requests to a human) or **Willem (Xcode GUI)** (physically impossible from a terminal: Xcode archive/upload/signing UI only). Almost everything is CC.

**There is only one machine** (established 2026-07-05): the Mac Mini runs on Christelle's account, and the canonical checkout — the same one steps A/E use — is **`/Users/christellebekker/Developer/ritual-v2`** (see `MACHINES.md`). "Build machine" and "this Mac" are the same working copy, which means CC can run step B in the same session as step A, and Willem opens Xcode right here.

### A. Merge & push the build point — **CC** (this Mac)

```sh
cd /Users/christellebekker/Developer/ritual-v2
git switch main
git pull --ff-only origin main
git merge --no-ff ota-build-point      # everything EXCEPT the verification bundle
git push origin main
git push origin ota-build-point ops/restore-capgo-ota
```
The default merge-commit message is fine; if editing it, write it to a temp file and use `git commit -F <tempfile>` (house convention). **Merge order is deliberate:** the build point merges to main *before* the native build; the verification commit merges *after* the build is verified on-device (step E1). Never let the verification commit into a native build — it would make the OTA test unfalsifiable.

### B. Prepare the build — **CC** (same machine, same checkout as step A)

```sh
cd /Users/christellebekker/Developer/ritual-v2
git fetch origin
git switch main
git pull --ff-only origin main
npm ci
npm run build
npx cap sync ios
```
`npx cap sync ios` copies `build/` into the native shell, regenerates `ios/App/App/capacitor.config.json` from `capacitor.config.ts`, and refreshes the SPM plugin sources (the SPM package points at `node_modules`, so the 8.50.2 updater arrives via `npm ci`).

**Verify the build will carry the right config — all four must pass (CC):**
```sh
grep -A 2 '"CapacitorUpdater"' ios/App/App/capacitor.config.json
#   → must show   "autoUpdate": true
grep -o 'Ritual v1\.0\.[0-9]*' build/static/js/main.*.js
#   → must print  Ritual v1.0.45        (NOT 1.0.46 — that would mean the
#                                        verification commit leaked into the build)
grep MARKETING_VERSION ios/App/App.xcodeproj/project.pbxproj
#   → must print  MARKETING_VERSION = 1.0.45;   (twice)
node -e "console.log(require('./package-lock.json').packages['node_modules/@capgo/capacitor-updater'].version)"
#   → must print  8.50.2
```

**Bump the TestFlight build number (CC).** Check the current value, then set both occurrences to the next integer (example: 34 → 35):
```sh
grep -n 'CURRENT_PROJECT_VERSION' ios/App/App.xcodeproj/project.pbxproj
sed -i '' 's/CURRENT_PROJECT_VERSION = 34;/CURRENT_PROJECT_VERSION = 35;/g' ios/App/App.xcodeproj/project.pbxproj
```

**Commit whatever the prep changed (CC — explicit paths, never `git add .`):**
```sh
git add ios/App/App/capacitor.config.json ios/App/App.xcodeproj/project.pbxproj
git status --short   # confirm nothing else is staged
printf 'chore(ios): sync native shell and bump build for OTA restore build\n' > /tmp/ritual-msg.txt
git commit -F /tmp/ritual-msg.txt
git push origin main
```

**Clear stale DerivedData so the archive can't carry an old config (CC):**
```sh
rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
```

### C. Archive & upload — **Willem (Xcode GUI)** — the only human-required steps

1. Open **`/Users/christellebekker/Developer/ritual-v2/ios/App/App.xcodeproj`** — the `.xcodeproj` itself. Known gotcha: this project uses **Swift Package Manager** (`ios/App/CapApp-SPM`), *not* CocoaPods — there is no `.xcworkspace` to look for.
2. Wait for **"Resolving Package Graph"** (status bar) to finish before doing anything.
3. Top bar: scheme **App**, destination **Any iOS Device (arm64)**.
4. Sanity check: App target → **General** tab → Version **1.0.45**, Build = the number CC set in step B.
5. **Product → Clean Build Folder** (belt-and-suspenders on top of the DerivedData wipe).
6. **Product → Archive**. When the Organizer opens: **Distribute App → App Store Connect → Upload**, accept the automatic-signing prompts (team `UDB2JG9XK6`).
7. Done when the upload succeeds. Landed = App Store Connect "build has completed processing" email (typically 5–30 min), after which the build appears in TestFlight.

### D. Install & pre-OTA sanity check — phone in hand (either of you), CC has nothing to run

1. Install the new build from **TestFlight** on the test iPhone.
2. Open the app → Settings screen → footer must read **`Ritual v1.0.45`**. That's the natively-bundled JS — OTA has not acted yet.
3. Optional deeper check: phone plugged in → Console.app, filter `Capgo` → expect `[Capgo] notifyAppReady() called at index.js startup` and `[Capgo] active bundle on startup: BUILTIN`.

**STOP. Explicit go/no-go before anything is published to Capgo (per standing rule: no bundle upload without sign-off).**

### E. Publish the verification bundle — **CC** (this Mac; the Capgo key already lives in `~/.capgo` here)

```sh
cd /Users/christellebekker/Developer/ritual-v2
git switch main
git pull --ff-only origin main
git merge --no-ff ops/restore-capgo-ota     # brings in ONLY the verification commit now
git push origin main
npm ci
npm run build
grep -o 'Ritual v1\.0\.[0-9]* (OTA)' build/static/js/main.*.js
#   → must print  Ritual v1.0.46 (OTA)
```
Apply Guardrail 2 (idempotent), then upload:
```sh
npx @capgo/cli channel set production com.ritualhabits.app --no-downgrade --apikey "$(cat ~/.capgo)"
npx @capgo/cli bundle upload com.ritualhabits.app --channel production --apikey "$(cat ~/.capgo)"
#   version is auto-read from package.json → 1.0.46
#   path is auto-read from capacitor.config webDir → build/
```
Confirm server-side (CC):
```sh
npx @capgo/cli bundle list com.ritualhabits.app --apikey "$(cat ~/.capgo)"    # 1.0.46 listed
npx @capgo/cli channel list com.ritualhabits.app --apikey "$(cat ~/.capgo)"   # production → 1.0.46
```

### F. Watch the device pull it — the live proof

How the update triggers with `autoUpdate: true` (no `directUpdate`): the plugin **downloads in the background while the app is open, and applies the new bundle when the app is backgrounded** — it never yanks the bundle mid-foreground-use (which is also why there's no NFC-scan hazard).

Phone actions, spelled out:
1. Open the app. Leave it in the foreground **~30 seconds** (download window).
2. Swipe up to home (background it — this is what applies the update). Wait **~10 seconds**.
3. Reopen the app.
4. **Success = Settings footer reads `Ritual v1.0.46 (OTA)`.**
5. If unchanged: repeat the background/reopen cycle once more; then force-quit and relaunch. Allow up to **5 minutes** total before calling it a failure.

Corroboration:
- Console.app (filter `Capgo`): `Update available` → `Download complete` → `App reloaded with new bundle`, and on the next cold launch `active bundle on startup: 1.0.46`.
- Capgo dashboard: **https://web.capgo.app** → app **Ritual** (`com.ritualhabits.app`) → `production` channel → stats/devices shows the device on **1.0.46**.

**Only now is OTA actually restored. Config alone proved nothing; this does.**

### G. Rollback — **CC** (only if F fails or the bundle misbehaves)

Two distinct failure shapes:

**1. The bundle crashes the app on launch** → Capgo handles it automatically: `notifyAppReady()` never fires ([src/index.js:10](src/index.js)), so the plugin restores the previous bundle on the next launch. Then remove the bad bundle so nothing else pulls it:
```sh
npx @capgo/cli bundle delete 1.0.46 com.ritualhabits.app --apikey "$(cat ~/.capgo)"
```
(Deleted version numbers can't be reused — the next attempt is 1.0.47.)

**2. The bundle runs but misbehaves** → do **not** try to push an older bundle: downgrading below/at native is blocked by our own guardrails, *by design*. Roll **forward**:
```sh
cd /Users/christellebekker/Developer/ritual-v2
git revert <bad-commit-sha>                     # or fix properly
npm version 1.0.47 --no-git-tag-version
git add package.json package-lock.json
printf 'fix(ota): roll forward past bad 1.0.46 bundle\n' > /tmp/ritual-msg.txt
git commit -F /tmp/ritual-msg.txt && git push origin main
npm run build
npx @capgo/cli bundle upload com.ritualhabits.app --channel production --apikey "$(cat ~/.capgo)"
npx @capgo/cli bundle delete 1.0.46 com.ritualhabits.app --apikey "$(cat ~/.capgo)"
```
Devices pick up 1.0.47 on the next open/background cycle, exactly as in F.
