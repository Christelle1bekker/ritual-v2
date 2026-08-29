# Ritual Android — Pre-Scaffold Assessment

**Date:** 2026-08-29
**Repo:** `~/Developer/ritual-v2` @ `8ef723f` (main, 0 ahead / 0 behind `origin/main`)
**Status:** READ-ONLY inventory. No code changed. Scaffolding blocked pending the rulings in §10.

---

## 0. Hygiene

| Check | Result |
|---|---|
| `git pull --ff-only` | Already up to date |
| Ahead / behind `origin/main` | `0 / 0` |
| `git stash list` | empty |
| `git status --porcelain -uall` | empty (no untracked non-ignored files) |
| Working tree | clean |

### iOS version numbers — read from the pbxproj, not from memory

From [ios/App/App.xcodeproj/project.pbxproj](../../ios/App/App.xcodeproj/project.pbxproj), both Debug (line 302/310) and Release (line 326/334) configurations:

| Key | Value | Line |
|---|---|---|
| `CURRENT_PROJECT_VERSION` | **35** | `project.pbxproj:302`, `:326` |
| `MARKETING_VERSION` | **1.0.45** | `project.pbxproj:310`, `:334` |
| `PRODUCT_BUNDLE_IDENTIFIER` | `com.ritualhabits.app` | `project.pbxproj:312`, `:335` |

**Lockstep drift found.** [package.json:3](../../package.json:3) is `"version": "1.0.46"`, one ahead of `MARKETING_VERSION` 1.0.45. This is the documented Capgo Guardrail 1 pairing (`MARKETING_VERSION` = `package.json` version, [CAPGO_OTA_RESTORE.md](../../CAPGO_OTA_RESTORE.md) §4) and it is currently broken. History explains it: `9a93947` bumped the iOS build to 35 for the OTA-restore TestFlight build, then `b08498a` confirmed the **1.0.46** OTA bundle reached the device — the JS shipped over the air without a matching native bump.

This is a ruling, not an assumption (§10 d): Android `versionName` mirrors *which* number?

---

## 1. Existing Android footprint — none

| Probe | Result |
|---|---|
| `android/` directory | **Does not exist** |
| Tracked in git | n/a |
| `android-*` branch on origin | **None.** Origin heads: `main`, `agents-deploy`, `claude/serene-curie-1f6788`, `maurice-debbie-local-backup`, `ops/restore-capgo-ota` |
| `docs/android/` | Did not exist before this file |
| `~/.ritual-android-signing` | **Does not exist** |
| Ritual `.aab` / `.jks` / `.keystore` anywhere on disk | **None** |
| `@capacitor/android` in node_modules | **Not installed** |

Expectation met: greenfield. Nothing to preserve, nothing to stop for.

**Adjacent (not Ritual, informational only):** Beka has a working Android setup that is the proven template — `~/Developer/saam/android`, keystore at `~/.beka-android-signing/beka-upload-key.jks`, AABs at `~/Desktop/Beka/Android builds/`. `~/Developer/arcade-homework/android` also exists. Neither is touched by this work.

---

## 2. Capacitor and plugin inventory

**Capacitor 8.** CLI `@capacitor/cli` 8.3.0 (`npx cap --version` → 8.3.0), `@capacitor/core` ^8.3.0, `@capacitor/ios` ^8.3.0. `@capacitor/android` is **not** a dependency and must be added.

Every plugin in the tree ships an Android module. Verified by reading each package's own `package.json` `capacitor` field and confirming the `android/` source directory exists on disk — not from documentation:

| Plugin | Version | Android module | Notes |
|---|---|---|---|
| `@capacitor/app` | 8.1.0 | ✅ `{"android":{"src":"android"}}` | Supplies `appUrlOpen` — the whole passive tile path |
| `@capacitor/browser` | 8.0.3 | ✅ | Privacy/Terms links, auth browser close |
| `@capacitor/core` | 8.3.0 | n/a | Core, no platform module |
| `@capacitor/haptics` | 8.0.1 | ✅ | Android maps to `Vibrator`; no Taptic equivalence |
| `@capacitor/preferences` | 8.0.1 | ✅ | Backs the Supabase auth session store |
| `@capacitor/push-notifications` | 8.0.3 | ✅ | **Android module requires FCM** — see §6 |
| `@capacitor/splash-screen` | 8.0.1 | ✅ | |
| `@capacitor/status-bar` | 8.0.2 | ✅ | |
| `@capgo/capacitor-nfc` | 8.0.25 | ✅ | Android impl is **semantically different** — see §4 |
| `@capgo/capacitor-updater` | 8.50.2 | ✅ | Capgo `production` channel already has Android enabled |

### Postinstall patches / iOS-only Swift patches

**There are none.** No `postinstall` script in [package.json](../../package.json), no `patch-package` dependency, no `patches/` directory. `scripts/` contains only `generate-icons.js` and `generate-splash.js`. The NFC plugin is **not** patched on iOS — the workarounds live entirely in JS ([src/utils/nfcScanLifecycle.js](../../src/utils/nfcScanLifecycle.js)).

**No iOS Swift patch needs an Android twin.** But the *JS* workarounds encode iOS session semantics that do not exist on Android (§4) — that is the real twin problem.

---

## 3. Platform gates in `src/` — clean, no `'ios'` literals

The Beka reminders failure mode (a literal `'ios'` comparison silently making a feature inert on Android) **does not exist here**. There is not a single `getPlatform()` call or `'ios'` string comparison in `src/`. Every gate is `Capacitor.isNativePlatform()`, which is `true` on Android:

| file:line | Gate | Guards | Android effect |
|---|---|---|---|
| [src/supabase.js:25](../../src/supabase.js:25) | `Capacitor.isNativePlatform() ? preferencesStorage : webStorage` | Auth session storage | ✅ Correct — uses Preferences on Android |
| [src/utils/capacitorAuth.js:7](../../src/utils/capacitorAuth.js:7) | `if (!Capacitor.isNativePlatform()) return;` | Legacy auth deep-link listener | ✅ Correct |
| [src/App.js:261](../../src/App.js:261) | `if (Capacitor.isNativePlatform())` in `triggerHaptic` | Native haptics vs `navigator.vibrate` | ✅ Correct |
| [src/App.js:283](../../src/App.js:283) | `if (Capacitor.isNativePlatform())` in `triggerCelebrationHaptic` | Kids celebration haptic | ✅ Correct |
| [src/App.js:4740](../../src/App.js:4740) | `if (!Capacitor.isNativePlatform()) return;` | Whole native-integrations effect (Capgo, `appUrlOpen`, push) | ✅ Correct — but see §6, push fires unconditionally inside it |

**Nothing in §3 requires a change.** The `isNative()` rewrite the brief anticipated is not needed; there is nothing to rewrite.

The real Android blocker is not a platform gate — it is §5.

---

## 4. NFC path — how a tile tap works today, and what is iOS-specific

### Passive path (tile tapped, app closed/background) — the primary flow

1. OS background NFC reader (not our code) reads the tile's NDEF URI record.
2. OS opens the URL. On iOS this is a Universal Link against `applinks:app.ritualhabits.com.au` ([ios/App/App/App.entitlements](../../ios/App/App/App.entitlements)).
3. Capacitor delivers it to `CapApp.addListener('appUrlOpen', …)` at [src/App.js:4774](../../src/App.js:4774).
4. Handler checks **auth callbacks first** ([src/App.js:4779-4806](../../src/App.js:4779)) — `/auth/callback`, `?code=`, `#access_token=` — and returns early if matched.
5. Otherwise `parseTileUrl(urlStr)` ([src/utils/parseTileUrl.js](../../src/utils/parseTileUrl.js)) → `setDeepLinkTileUID(tileUID)` at [src/App.js:4814](../../src/App.js:4814).
6. Tap routing: shared/kid/unassigned/ambiguous → "Who did this?" overlay; single assignee → auto-complete.

**Shared vs iOS-specific:** steps 3–6 are 100 % shared JS and work identically on Android. Step 2 is the platform-specific half and is what §5 is about. `pendingTileUID` does not exist by that name — the state is `deepLinkTileUID`.

### Active-scan path (FAB) — deeply iOS-shaped

[src/hooks/useNfcScanner.js](../../src/hooks/useNfcScanner.js) + [src/utils/nfcScanLifecycle.js](../../src/utils/nfcScanLifecycle.js), consumed at [src/App.js:4684](../../src/App.js:4684) (`const { scan, isAvailable, showSettings } = useNfcScanner()`), scan invoked at [src/App.js:4692](../../src/App.js:4692).

Every lifecycle rule in this module is a workaround for `NFCNDEFReaderSession` behaviour. Read from the plugin's Android source ([node_modules/@capgo/capacitor-nfc/android/src/main/java/app/capgo/nfc/CapacitorNfcPlugin.java](../../node_modules/@capgo/capacitor-nfc/android/src/main/java/app/capgo/nfc/CapacitorNfcPlugin.java)), here is what each assumption becomes on Android:

| Assumption in `nfcScanLifecycle.js` | iOS reality | **Android reality** |
|---|---|---|
| `startScanning()` opens a **system scan sheet** with a Cancel button and `alertMessage` | ✅ `NFCNDEFReaderSession` | ❌ **No UI at all.** `startScanning` → `adapter.enableReaderMode(...)` (`CapacitorNfcPlugin.java:93-103`, `:324-341`) and `call.resolve()` immediately. `alertMessage` and `iosSessionType` are ignored. The radio arms silently. |
| Session self-terminates after **60 s** | ✅ iOS hard cap | ❌ **Reader mode never times out.** It stays armed until `disableReaderMode` or `handleOnPause`. |
| **User cancel** produces a terminal `nfcStateChange` | ✅ | ❌ **No cancel event exists** — there is nothing for the user to cancel. |
| `nfcStateChange` means *session ended* | ✅ (cancel / timeout / error, collapsed) | ❌ **Different meaning entirely.** On Android it is emitted only from `emitStateChange()` (`:688-708`) for **NFC adapter on/off** (`ACTION_ADAPTER_STATE_CHANGED` broadcast, `:661-674`) — plus **once at plugin `load()`** (`:65`) with `retainUntilConsumed: true`. |
| `SETTLE_MS = 750` guards async session teardown | ✅ empirically needed | ⚠️ Harmless but pointless — 750 ms of dead time per scan. |
| `WATCHDOG_MS = 65000` is belt-and-braces past the 60 s ceiling | ✅ never fires normally | ❌ **Becomes the only terminal event.** With no sheet, no cancel and no timeout, a scan that does not meet a tile resolves `null` after **65 seconds of invisible, un-abortable dead UI**. |
| `isAvailable()` means "can scan now" | ✅ `readingAvailable` | ❌ `isSupported()` returns `adapter != null` (`:284-288`) — **true even when NFC is switched off** in Settings. The FAB would show and silently never fire. |

Two saving graces, both verified in source:

- The retained-`nfcStateChange`-at-`load()` problem is already neutralised. `useNfcScanner` registers listeners at mount and `nfcScanLifecycle.claim()` returns `null` when no scan is in flight, so the retained boot event is discarded rather than resolving a future scan. The existing defence-in-depth holds on Android by accident, but it holds.
- `showSettings()` is correctly implemented on Android — `Settings.ACTION_NFC_SETTINGS` with a wireless-settings fallback (`:254-278`).

**Conclusion:** the active-scan FAB is not portable as written. Shipping it on Android needs an in-app scanning modal with its own Cancel affordance, an abort path through `scan()` (which has no cancellation API today), and an enabled-not-just-present capability check. That is a feature build, not a scaffold. See ruling §10 b.

**Emulator limitation (affects Phase 4):** a standard AVD has no NFC hardware, so `NfcAdapter.getDefaultAdapter()` returns `null`, `isSupported()` is `false`, and `startScanning()` rejects. **Active scanning and real NDEF_DISCOVERED dispatch cannot be verified on the emulator at all.** Only the `am start … VIEW` intent path is emulator-testable.

---

## 5. 🚨 App Links — and the shared-code bug that breaks Android tile taps

### Domains, verified live (not from docs)

`curl -I` against each host, 2026-08-29:

| Host | `/` | `/t/TESTUID` | `/TESTUID` | `/.well-known/apple-app-site-association` | `/.well-known/assetlinks.json` |
|---|---|---|---|---|---|
| `app.ritualhabits.com.au` | 200 | 200 | 200 | **200, real JSON** | 200 **but `text/html` — index.html** |
| `t.ritualhabits.com.au` | 200 | 200 | **308 → `https://ritual-v2-mu.vercel.app/t/TESTUID`** | **200, real JSON** | 200 **but `text/html` — index.html** |
| `ritual-v2-mu.vercel.app` | 200 | 200 | 200 | 200, real JSON | 200 `text/html` |
| `ritualhabits.com.au` (apex) | 200 | 404 | 404 | 404 | 404 |

iOS associated domains today: **`applinks:app.ritualhabits.com.au` only** ([App.entitlements](../../ios/App/App/App.entitlements)). The AASA served there is `paths: ["*"]`, appID `UDB2JG9XK6.com.ritualhabits.app`.

### 🚨 Trap #1 — `assetlinks.json` already returns HTTP 200 with HTML

The SPA rewrite in [vercel.json:21](../../vercel.json:21) (`{"source": "/((?!api/).*)", "destination": "/index.html"}`) catches `/.well-known/assetlinks.json` today and serves **index.html with a 200 and `content-type: text/html`**.

This is worse than a 404. Google's App Links verifier will fetch it, get a success status, fail to parse JSON, and mark the domain unverified — while every casual check ("is the file live?") returns 200 and looks fine. A real `public/.well-known/assetlinks.json` will take precedence once it exists (Vercel serves static files before applying rewrites — proven by the AASA at the same path behaving correctly), but the *placeholder* version must never deploy, because a syntactically valid file with a wrong fingerprint fails verification just as hard and looks even more convincingly correct.

### 🚨 Trap #2 — `parseTileUrl` returns `null` for the short-domain tile URL

This is the finding that changes the plan.

`t.ritualhabits.com.au/<uid>` **308-redirects** to `ritual-v2-mu.vercel.app/t/<uid>`. On iOS that redirect is followed by Safari and the *destination* becomes the Universal Link, so `parseTileUrl` sees `/t/<uid>` and works.

**Android App Links and `NDEF_DISCOVERED` do not follow redirects.** The intent carries the URL exactly as written on the tag. So the app would receive:

```
https://t.ritualhabits.com.au/04A32B
```

`parseTileUrl` ([src/utils/parseTileUrl.js:16-21](../../src/utils/parseTileUrl.js:16)) matches `/^\/t\/(.+)$/` on the pathname, then falls back to `?tile=`. The pathname here is `/04A32B` — **neither matches. It returns `null`.** [src/App.js:4816](../../src/App.js:4816) logs `no tile UID in URL` and the tap does nothing.

Symptom on Android: tile taps open the app and silently do nothing. Identical in feel to the Beka reminders bug, arrived at through a different mechanism.

### 🚨 Trap #3 — which URL is actually on the physical tiles is *contradicted* in the repo

The two authoritative docs disagree, and I cannot resolve this from the codebase — **there is no tile-URL-generation code in the repo at all** (grep across `src/`, `api/`, `scripts/`, `lib/`, `public/` finds only the parser and its tests). Tiles are encoded out-of-band.

- [HANDOFF.md:17](../../HANDOFF.md:17): *"Tile short domain | `t.ritualhabits.com.au/:uid` → 301 to `/t/:uid`"*
- [MACHINES.md:30](../../MACHINES.md:30): *"Physical NFC tags in the wild encode `…/t/{uid}` URLs on that host"* — i.e. `ritual-v2-mu.vercel.app/t/{uid}`
- [CONTEXT.md:110](../../CONTEXT.md:110): both formats, *"Associated domain: `applinks:app.ritualhabits.com.au`"*

The iOS entitlement is circumstantial evidence for a **third** answer: it only lists `app.ritualhabits.com.au`, so for the passive path to work on iOS at all, tiles most plausibly encode `https://app.ritualhabits.com.au/t/<uid>` — or they encode the `t.` short URL and rely on the 308 landing somewhere iOS accepts. Both are consistent with the observed 200s and neither is provable from here.

**This must be resolved before the intent filters are written** — see ruling §10 c. Guessing produces an app that installs, launches, verifies its App Links, and still does nothing when a child taps a tile.

---

## 6. Push — APNs today, requires FCM on Android

Current wiring, all inside the `isNativePlatform()` effect at [src/App.js:4823-4865](../../src/App.js:4823):

- `PushNotifications.requestPermissions()` → `.register()` on grant ([:4825-4829](../../src/App.js:4825))
- `registration` listener caches the token and writes it to `members.push_token` **for adult profiles only** ([:4831-4848](../../src/App.js:4831))
- `pushNotificationReceived` / `pushNotificationActionPerformed` — log only ([:4850-4862](../../src/App.js:4850))
- Whole block wrapped in `try/catch`: *"Init failed — continuing without push"* ([:4863-4864](../../src/App.js:4863))

**Nothing requires push at first launch.** Failure is non-fatal by construction; login, tile taps and habit completion are all independent of it.

**But on Android the module is not inert.** `@capacitor/push-notifications` 8.0.3's Android implementation is Firebase Messaging. Without a `google-services.json` and the Google Services Gradle plugin, `.register()` fails at runtime — caught by the existing `try/catch`, so it degrades rather than crashes, but it will log an error on every cold start and no token will ever be written.

Also relevant: Android 13+ (API 33+) requires the runtime `POST_NOTIFICATIONS` permission. At `targetSdk 36` the permission prompt appears on first `requestPermissions()` — a first-launch dialog iOS users see too, so no behavioural surprise, but it is a Play data-safety declaration item either way.

Server side: `api/cron/reminders.js` sends via **APNs HTTP/2** only. Even with FCM wired client-side, no Android device would receive a reminder without a server-side FCM sender. And per the brief, that cron is paused.

See ruling §10 a.

---

## 7. Capgo

| Setting | Value | Source |
|---|---|---|
| `autoUpdate` | `true` | [capacitor.config.ts:18-20](../../capacitor.config.ts:18) |
| `channel`, `updateUrl`, `statsUrl`, `directUpdate` | unset → cloud defaults | [CAPGO_OTA_RESTORE.md:57](../../CAPGO_OTA_RESTORE.md) |
| App on Capgo | `com.ritualhabits.app` | [CAPGO_OTA_RESTORE.md:10](../../CAPGO_OTA_RESTORE.md) |
| Channel | `production`, active, strategy `major`, `--no-downgrade` | [CAPGO_OTA_RESTORE.md:76,139-142](../../CAPGO_OTA_RESTORE.md) |
| Current channel bundle | **1.0.46** (confirmed reached a device, `b08498a`) | [CAPGO_OTA_RESTORE.md:264,280](../../CAPGO_OTA_RESTORE.md) |
| Android | *"the `production` channel already has Android enabled"* | [CAPGO_OTA_RESTORE.md:155](../../CAPGO_OTA_RESTORE.md) |

`notifyAppReady()` is called twice, deliberately: [src/index.js:10](../../src/index.js:10) pre-render (primary) and [src/App.js:4744](../../src/App.js:4744) (belt-and-suspenders). Five diagnostic listeners at [src/App.js:4752-4766](../../src/App.js:4752). All platform-agnostic.

⚠️ **Interaction with the version drift (§0).** The channel serves **1.0.46**. If the first Android build ships `versionName 1.0.45` (iOS `MARKETING_VERSION` parity), then with `autoUpdate: true` the very first Android launch will pull the 1.0.46 bundle over the wire — the app ships and immediately replaces its own JS. Not a fault, but it means the internal-testing AAB is not what testers actually run, and any Android-specific JS in the native bundle is overwritten by JS that predates Android existing. This is a direct consequence of ruling §10 d.

---

## 8. Toolchain on this Mac

The tools are installed but **invisible to a non-login shell** — `java`, `adb`, `gradle` and `emulator` are all "not found" on the default `PATH`, and `ANDROID_HOME` / `ANDROID_SDK_ROOT` are **unset**.

| Item | Status |
|---|---|
| `java -version` (bare) | ❌ *"Unable to locate a Java Runtime"* |
| `/usr/libexec/java_home -V` | ❌ no JVMs registered |
| Actual JDK | ✅ **OpenJDK 21.0.11** (Homebrew, keg-only) at `/opt/homebrew/opt/openjdk@21` |
| `ANDROID_HOME` / `ANDROID_SDK_ROOT` | ❌ both empty |
| `~/Library/Android/sdk` | ❌ does not exist |
| Android Studio | ❌ not installed (`/Applications`) |
| Actual SDK root | ✅ `/opt/homebrew/share/android-commandlinetools` |
| `sdkmanager` / `avdmanager` | ✅ on PATH at `/opt/homebrew/bin` |
| `adb` / `emulator` / `gradle` / `bundletool` | ❌ not on PATH (`adb`/`emulator` exist under the SDK root; **`bundletool` is not installed at all**) |
| Node / npm | v24.18.0 / 11.16.0 |

`sdkmanager --list_installed` (with `JAVA_HOME` + `ANDROID_HOME` exported):

```
build-tools;35.0.0                             | 35.0.0  | Android SDK Build-Tools 35
build-tools;36.0.0                             | 36.0.0  | Android SDK Build-Tools 36
emulator                                       | 36.6.11 | Android Emulator
platform-tools                                 | 37.0.0  | Android SDK Platform-Tools
platforms;android-36                           | 2       | Android SDK Platform 36
system-images;android-36;google_apis;arm64-v8a | 7       | Google APIs ARM 64 v8a System Image
```

**AVDs:** one — **`beka`**, Pixel 7, Google APIs, **Android 16.0 (API 36)**, `arm64-v8a`, 512 MB sdcard, at `~/.android/avd/beka.avd`. Reusable as-is for Phase 4; API 36 matches the target.

**Gaps to close in Phase 3/4 (all mechanical, no ruling needed):**
1. Export `JAVA_HOME=/opt/homebrew/opt/openjdk@21` and `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` for every Gradle/emulator invocation (Gradle wrapper comes with the scaffold, so no `gradle` install needed).
2. Write `android/local.properties` with `sdk.dir=/opt/homebrew/share/android-commandlinetools` (gitignored).
3. **Install `bundletool`** — required to read `versionCode`/`versionName` out of the AAB manifest rather than trusting the build log.

---

## 9. What the scaffold looks like once unblocked

Not executed — recorded so Phase 3 is mechanical.

- `npm i @capacitor/android@^8.3.0` then `npx cap add android` (Capacitor 8.3.0).
- `variables.gradle`: `minSdkVersion 24`, `compileSdkVersion 36`, `targetSdkVersion 36` — matches the working `~/Developer/saam/android/variables.gradle`.
- `applicationId` + `namespace` = `com.ritualhabits.app` (identical to iOS `PRODUCT_BUNDLE_IDENTIFIER`).
- **`.gitignore`:** the brief anticipated an unanchored `android/` pattern needing an anchor fix. **That pattern does not exist here.** Root [.gitignore](../../.gitignore) has unanchored `build/`, which correctly catches `android/build/` and `android/app/build/` and does *not* hide `android/` itself. Capacitor's generated `android/.gitignore` covers `*.aab`, `local.properties`, `.gradle/`. Only change needed: **uncomment the `*.jks` / `*.keystore` / `keystore.properties` block**, exactly as `saam` did deliberately on 2026-07-26.
- Signing: keystore at `~/.ritual-android-signing/` (outside the repo), `keystore.properties` gitignored, `keystore.properties.example` committed. `saam`'s env-var-with-file-fallback `signingConfigs` block plus its fail-loudly guard (an absent `keystore.properties` must **error**, not silently emit an unsigned AAB) is the template to copy.
- Assets: `@capacitor/assets`. ⚠️ It rewrites `ios/App/App.xcodeproj/project.pbxproj` as a side effect — restore it afterwards; the churn is formatting-only and must never be committed.
- Manifest: `android.permission.NFC` + `<uses-feature android:name="android.hardware.nfc" android:required="false"/>` (required=`false` keeps the app installable on non-NFC Android devices — unlike iPhone, a large share of the Android base has no NFC), `NDEF_DISCOVERED` filter, and an `autoVerify` App Links filter. **Host and path pattern blocked on ruling §10 c.**
- `public/.well-known/assetlinks.json` as a template with a literal placeholder fingerprint — **must not deploy** (§5 Trap #1). Pushing to `main` deploys the web app immediately ([MACHINES.md:30](../../MACHINES.md:30)), so the placeholder file and its deploy are the same action. This needs handling in Phase 5 ordering, not just a warning.

---

## 10. Rulings needed before Phase 3

### a. Android push in v1 — **recommend: gate off**

Wiring FCM means a Firebase project, `google-services.json` (a new untracked secret-ish file with its own filing question), a Gradle plugin, and a server-side FCM sender in `api/cron/reminders.js` — which is APNs-only and paused anyway. Gating off costs one platform check and delivers nothing worse than "no reminders", which is the current state for everyone. *Gate off / wire FCM now?*

### b. Active-scan FAB on Android — **recommend: hide for v1**

§4 is the argument: no system UI, no cancel, no timeout, 65 s of invisible dead time, and `isAvailable()` returns true with NFC switched off. Shipping it needs an in-app modal, a cancel path `scan()` does not currently expose, and a real capability check — a feature build. Passive tap-to-open is the primary flow and is unaffected. **Also note it is unverifiable on the emulator regardless of the ruling** (no NFC hardware on an AVD), so "ship it" means shipping something no one on this machine can test. *Hide for v1 / build the Android scan UI now?*

### c. 🚨 What exact URL is written on the physical tiles? — **blocking, no recommendation**

§5 Trap #3: `HANDOFF.md`, `MACHINES.md` and the iOS entitlement point at three different answers and there is no tile-encoding code in the repo to settle it. Everything downstream depends on it — the `NDEF_DISCOVERED` and App Links `<data>` host/path, which domain needs `assetlinks.json`, and whether Trap #2 needs fixing at all.

If tiles are `t.ritualhabits.com.au/<uid>`, then **`parseTileUrl` needs a shared-code change** to accept a bare `/<uid>` path on that host — a change that touches the iOS path too and needs its own test coverage. If tiles are `…/t/<uid>` on `app.` or the Vercel host, the parser is fine as-is and only the intent filter host changes.

The cheapest resolution: tap a tile with any Android phone (or an iPhone with the app deleted) and read the URL the OS offers to open. *What does a real tile say?*

### d. Which version number does Android mirror? — **recommend: `versionName 1.0.46`, `versionCode 35`**

§0: iOS is at build **35** / `MARKETING_VERSION` **1.0.45**, but `package.json` and the live Capgo `production` channel are both at **1.0.46**. The brief says mirror iOS; the Capgo lockstep guardrail says mirror `package.json`. They currently disagree.

Recommending `versionName 1.0.46` because it matches the JS the app will actually be running within seconds of first launch (§7), and `versionCode 35` for train parity with the iOS build number. The alternative — fix the drift by bumping `MARKETING_VERSION` to 1.0.46 on iOS — is out of scope for this session and touches `ios/`, which the brief fences off. *Confirm 1.0.46 / 35, or mirror iOS exactly at 1.0.45 / 35?*

---

## Verified vs inferred

**Verified by direct observation this session:** git state; iOS build/marketing/bundle-id read from `project.pbxproj`; absence of `android/`, keystores, AABs, `docs/android/`, `android-*` branches; every plugin's Android module presence and version; absence of postinstall/patch-package/`patches/`; every platform gate in `src/` by exhaustive grep; the NFC plugin's Android source semantics read line-by-line; live HTTP behaviour of all four domains including the `assetlinks.json` HTML-200; the `parseTileUrl` null result traced through the actual regex; iOS entitlements; Capgo config; the full local toolchain and `sdkmanager --list_installed`; the `beka` AVD; `saam/android` as a working template.

**Inferred, not verified:** that Google's verifier fails on the HTML-200 (standard behaviour, not tested against the real verifier); that FCM absence degrades rather than crashes (reasoned from the existing `try/catch`, not run); that Vercel static files beat rewrites for `assetlinks.json` (strongly implied by AASA at the same path behaving correctly, but not tested with the file in place); the tile URL itself (**explicitly unresolved — ruling c**).

**Not attempted:** no `android/` scaffold, no builds, no emulator boot, no Play upload, no `ios/` changes, no deploys.
