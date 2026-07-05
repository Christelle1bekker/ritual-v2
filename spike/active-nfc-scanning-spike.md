# Spike: Active NFC scanning for Ritual

**Date:** 2026-05-03
**Status:** Feasibility spike — design only, no production code
**Author:** Investigation report
**Decision needed by:** Christelle (go/no-go and phasing)

---

## TL;DR

**Verdict: feasible, with caveats.** Active NFC scanning via `NFCNDEFReaderSession` is a well-supported API on iOS 13+, ships in every iPhone 7+ regardless of generation, and reads NTAG215 tags in 100–200 ms when the chip is held continuously open. It coexists cleanly with the existing passive/Universal-Link path — they're independent code paths that converge on the same in-app handler.

**Recommended approach:** start with **`@capgo/capacitor-nfc` v8.0.25** (community plugin, same vendor as the OTA plugin already in Ritual's stack). Reasoning in §2 — short version: it's the only Cap-8-aligned, free, near-empty-issue-tracker option, and the alternative `@exxili/capacitor-nfc` has an open blocking bug (#25) on iOS 26 + NTAG215, which is Ritual's exact target hardware. Custom Swift plugin remains the fallback if iOS lifecycle bugs surface during integration.

**MVP scope:** one button on Today screen → opens system scan sheet → reads one tile → habit logs → sheet dismisses → optional "scan another?" affordance. Ships in **roughly 3–4 dev-days end-to-end** including TestFlight + one round of feedback iteration.

**Non-blocking risks:** Apple's scan sheet UI is non-customisable (Apple-controlled); each scan is a separate session (no continuous-mode API); iPad has no NFC chip so the feature must be feature-gated.

---

## 1. iOS NFC reader session APIs and entitlements

### Session type to use

Three `Core NFC` session types are relevant. For Ritual, **`NFCNDEFReaderSession` is the right choice**:

| API | Use case | Verdict for Ritual |
|---|---|---|
| `NFCNDEFReaderSession` | Read NDEF-formatted tags (URLs, text). Tag is delivered as `[NFCNDEFMessage]` — one or more records, each typed (URL, text, MIME, etc.) | ✅ Tiles are NDEF URL records — direct fit |
| `NFCTagReaderSession` | Raw ISO 14443 / 15693 tag access incl. MiFare. Full chip-level control. | ❌ Overkill — we don't need raw chip access |
| `NFCVASReaderSession` | Apple Value Added Service / loyalty cards | ❌ Not relevant |

**API minimum**: `NFCNDEFReaderSession` is iOS 11+. `NFCTagReaderSession` is iOS 13+. Ritual's deployment target is iOS 15.0 ([ios/App/App.xcodeproj/project.pbxproj:233](ios/App/App.xcodeproj/project.pbxproj:233)) so both are available; no deployment-target change needed.

**Hardware**: NFC reader-mode requires iPhone 7 or later. **iPad has no NFC chip.** Ritual's `TARGETED_DEVICE_FAMILY = "1,2"` ([ios/App/App.xcodeproj/project.pbxproj:312](ios/App/App.xcodeproj/project.pbxproj:312)) means it builds for iPad too, so the Quick Log button must be feature-gated on `NFCNDEFReaderSession.readingAvailable` (returns `false` on iPad and iPhone 6s and earlier).

### Entitlements

Add to a new `App/App.entitlements` file (currently no entitlements file exists in the repo — see §5):

```xml
<key>com.apple.developer.nfc.readersession.formats</key>
<array>
    <string>NDEF</string>
</array>
```

No `iso7816.select-identifiers` needed — that's only for `NFCTagReaderSession` against ISO 7816 smart cards.

The app's App ID in Apple Developer Portal must also have **NFC Tag Reading** capability enabled. If `CODE_SIGN_STYLE = Automatic` (which Ritual uses, [project.pbxproj:298](ios/App/App.xcodeproj/project.pbxproj:298)), Xcode will sync this automatically once toggled in the Signing & Capabilities tab — no manual portal trip needed.

Note: This entitlement is additive to whatever `Associated Domains` config exists for the existing UL flow. Both can co-exist on the same `.entitlements` file.

### Info.plist

One required key:

```xml
<key>NFCReaderUsageDescription</key>
<string>Ritual uses NFC to scan habit tiles when you tap Scan.</string>
```

This string is shown in the system prompt the **first time** the app starts a reader session. Without it, `beginSession` throws.

### UI / lifecycle constraints

- The system-rendered scan sheet appears as a **modal sheet from the bottom**, with Apple's "Ready to Scan" / "Hold near tile" copy and a **Cancel** button. App cannot brand or theme it. The default copy can be overridden via `session.alertMessage = "Tap a Ritual tile"` for in-flight updates only — initial sheet text is fixed.
- The sheet **can be presented while the app has other modals open** — iOS displays it on top. However, iOS allows only one reader session active at a time per process; `beginSession` will throw `NFCReaderError.readerSessionInvalidationErrorSystemIsBusy` if a session is already in flight.
- A reader session has an **internal 60-second hardware timeout**. If no tag is read in 60 s, iOS auto-invalidates the session.
- The app foreground requirement: a reader session can only start while the app is in the foreground. iOS auto-invalidates if the app backgrounds.

---

## 2. Capacitor plugin options — recommendation

### Plugin landscape (May 2026)

| Plugin | Version | Cap 8? | Last release | Issues | License | Verdict |
|---|---|---|---|---|---|---|
| **`@capgo/capacitor-nfc`** | 8.0.25 | ✅ peers `>=8.0.0` | 2026-04-27 | 1 open (Android-related) | MPL-2.0 | ✅ **Recommended** |
| `@exxili/capacitor-nfc` | 0.0.13 | ✅ peers `>=6 <9` | 2026-02-15 | **#25 open since 2026-03-05** | MIT | ❌ Blocking bug on iOS 26 + NTAG215 |
| `@capawesome-team/capacitor-nfc` | n/a | ✅ | 2026-05-01 | n/a | Sponsorware (paid) | ⚠️ Highest quality but requires Insiders subscription — overkill for a one-feature spike |
| `@trentrand/capacitor-nfc` | 0.3.0 | ❌ peers `^6.0.0` | 2025-01 | — | — | ❌ Cap 6 only |
| `@capacitor-community/nfc` | — | — | — | — | — | ❌ Does not exist on npm |
| `cordova-plugin-nfc` / `phonegap-nfc` | — | — | 2020 | — | — | ❌ Cordova-only, abandoned |
| `capacitor-nfc` (adrynov) | — | — | 2023-01 | — | — | ❌ Dead |

**Critical disqualification — `@exxili/capacitor-nfc` issue #25**: open since 2026-03-05, 8 weeks unresolved as of this report. iPhone 16 / iOS 26.x / **NTAG215** scans either return empty or fail with "missing-entitlement" fallback. Apple's review process now flags the deprecated NDEF entitlement format, leaving only TAG, which the plugin doesn't fully wire. This is **exactly** Ritual's hardware combination — using this plugin would put us straight onto a known broken path. https://github.com/Exxili/capacitor-nfc/issues/25

### Recommendation: `@capgo/capacitor-nfc` v8.0.25

Three reasons this is the right call:

1. **Same vendor as `@capgo/capacitor-updater` already in Ritual's stack** ([package.json:15](package.json:15)). Trust + support channel + version-cadence are already established. If something breaks, it's the same team Christelle already escalates to (per memory note about the active "Device Self Set regression" support thread).
2. **Cap-8-aligned by version**: peerDependencies pinned to `>=8.0.0`, latest release April 2026. Capgo follows a one-major-per-package policy (same as their updater plugin), which means Cap 8 builds are first-class, not best-effort.
3. **Near-empty issue tracker** — only one open issue at time of investigation, and that's about Android write reliability, not iOS reads. This is the inverse risk profile of Exxili's #25.

API surface matches Ritual's needs exactly:
- `startScanning({ alertMessage, invalidateAfterFirstRead, iosSessionType: 'ndef' })`
- `stopScanning()` for explicit invalidation
- `nfcEvent` listener emitting decoded NDEF records (URL records auto-decoded — strips the well-known type prefix byte for us)
- NTAG215 is "NFC Forum Tag Type 2", explicitly supported per the plugin README

License: MPL-2.0. Fine for app distribution. The only constraint is that if we fork the Swift to fix bugs in-place, the patched files must remain MPL — but we can wrap and extend without contamination.

### Fallback: custom thin plugin (~1.5 days if Capgo blocks us)

If iOS lifecycle weirdness surfaces during spike day 1–2 and Capgo can't be unblocked quickly, custom is genuinely small. Scaffolding via `npx @capacitor/cli plugin:generate`, then:

```
RitualNFC.swift                           ~120-180 lines
├── load()                                — register
├── @objc startScan(_ call: CAPPluginCall) — instantiate NFCNDEFReaderSession
├── NFCNDEFReaderSessionDelegate:
│   ├── didDetectNDEFs(...)              — extract URL from NFCNDEFPayload (strip prefix byte for type 'U'),
│   │                                       notifyListeners('tagRead', { url })
│   ├── didInvalidateWithError(...)      — branch on NFCReaderError code (cancel/timeout/busy)
│   └── readerSessionDidBecomeActive(...)
└── @objc stopScan(_ call: CAPPluginCall)  — invalidate

RitualNFCPlugin.ts                        ~50 lines
└── interface RitualNFCPlugin {
      startScan(opts?: { alert?: string }): Promise<{ cancelled?: boolean; timedOut?: boolean }>
      stopScan(): Promise<void>
      addListener('tagRead', cb): PluginListenerHandle
      isAvailable(): Promise<{ available: boolean }>
    }
```

This isn't deferred to "if community plugins go away" — it's a real plan-B for the spike itself, kept ready for the moment Capgo proves to have a problem we can't sidestep.

---

## 3. URL parsing — extract once, call from both paths

The current parser at [src/App.js:4343-4364](src/App.js:4343) is duplicated logic with the cold-launch path at [src/App.js:5157-5163](src/App.js:5157). It needs a third caller (active-scan), so the right move is to extract.

**Proposed seam (do during the active-scan integration, not before):**

```js
// New helper near top of App.js or in a small util module:
function parseTileUrl(urlStr) {
  if (!urlStr) return null;
  if (!urlStr.includes('://')) urlStr = 'https://' + urlStr;
  let url;
  try { url = new URL(urlStr); } catch { return null; }
  const pathMatch = url.pathname.match(/^\/t\/(.+)$/);
  let raw = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
  if (!raw) raw = url.searchParams.get('tile');
  if (!raw) return null;
  return raw.replace(/[:.]/g, '').toUpperCase();
}
```

Three call sites converge on this:

| Caller | Existing location | After refactor |
|---|---|---|
| Cold launch via `window.location` | [src/App.js:5157-5163](src/App.js:5157) | `const uid = parseTileUrl(window.location.href);` |
| Universal Link via Capacitor `appUrlOpen` | [src/App.js:4350-4357](src/App.js:4350) | `const uid = parseTileUrl(event.url); if (uid) setDeepLinkTileUID(uid);` |
| Active scan via new plugin | (new) | `RitualNFC.addListener('tagRead', ({url}) => { const uid = parseTileUrl(url); if (uid) setDeepLinkTileUID(uid); })` |

**`family && mounted` gating** ([src/App.js:5147](src/App.js:5147)) needs no change for the active-scan path:
- Active scanning is initiated from the foregrounded app
- `family` is already loaded by the time the user taps Scan (if not, the Scan button shouldn't be visible — gate on `family` for visibility)
- `mounted` becomes true on initial render's effect-flush, before the user could plausibly tap a button
- ✅ The existing gate works correctly for active scans

**Subtle benefit of routing active scans through `setDeepLinkTileUID`** instead of calling `handleComplete` directly: the same downstream UX (debounce at [:5174](src/App.js:5174), unassigned-tile modal at [:5183](src/App.js:5183), inactive-day modal at [:5191](src/App.js:5191), who-did-this prompt at [:5205](src/App.js:5205)) all work without duplication. Active scanning becomes "another way to deliver a tile UID to the existing pipeline", not a parallel branch.

---

## 4. UX design for Quick Log mode

### What the user sees, screen by screen

**Screen 1 — Today screen, Quick Log entry point**

Recommended placement: **floating action button (FAB)** anchored bottom-right, above the tab bar. Reasons:
- Tab bar at [src/App.js:5400](src/App.js:5400) currently has 3-4 items (today/family/insights/manage); adding a 5th squeezes labels. A 5th tab also frames Quick Log as a destination, which it isn't — it's an action.
- Hero card at [src/App.js:1593](src/App.js:1593) is information-dense ("Today's Progress", count, streak) — adding a button there clutters it.
- FAB is the iOS-idiomatic-enough pattern for "primary action of this screen". Ritual's brand language already uses circular accent-coloured elements (the member avatars at [:5345-5363](src/App.js:5345)), so a circular FAB fits.
- Render the FAB only if `NFCNDEFReaderSession.readingAvailable` is true (gate via the plugin's `isAvailable()` method, cached on mount).

Visual: 56 px circle, accent terracotta (`C.accent`), centred icon (a tile glyph or lightning bolt), shadow `0 6px 20px rgba(193,123,78,0.35)`. Bottom inset = `calc(64px + env(safe-area-inset-bottom))` to clear the tab bar.

**Screen 2 — User taps FAB → iOS scan sheet appears**

iOS-rendered. Cannot brand. Default copy:

> **Ready to Scan**
> Hold your iPhone near the item to learn more about it.
> [Cancel]

Override via `session.alertMessage = "Tap a Ritual tile"` immediately after `begin()`. The text updates live. Best to set:
- `alertMessage = "Tap a Ritual tile"` at session start
- On successful read: `alertMessage = "Got it ✦"` + `invalidate()` after 200 ms grace so user perceives confirmation before sheet dismisses
- On unrecognised URL: `alertMessage = "That's not a Ritual tile"` + `invalidate(errorMessage:)` (uses iOS's red-error sheet variant)

**Screen 3 — Scan succeeds, sheet dismisses, app returns**

The existing completion pipeline takes over:
- `setDeepLinkTileUID(uid)` fires
- Tile-trigger useEffect at [src/App.js:5146](src/App.js:5146) processes
- `handleComplete` runs → habit logs → existing CompletionFlash overlay at [src/App.js:1590](src/App.js:1590) fires

**Critical sequencing**: The scan sheet must be **fully dismissed** before the celebration flash renders. Otherwise the flash animates behind the system sheet during its dismiss-transition and the user misses it. Two approaches:
- (a) On successful read, set `alertMessage = "Got it ✦"` then `invalidate()` immediately — let iOS handle the dismiss-then-callback timing. The plugin emits `tagRead` only after `readerSessionDidBecomeInactive`. About a 400 ms perceived delay.
- (b) Emit `tagRead` immediately on `didDetectNDEFs`, but in JS, defer `setDeepLinkTileUID` by ~500 ms via `setTimeout` to let the sheet finish dismissing.

(a) is cleaner — keeps the deferral logic in the native plugin where it belongs. Recommended.

### Multi-tap routine — open question, defer to Phase 2

For users who want to log a morning routine (5+ tiles in a row), each scan is a separate session. The plugin can **immediately re-`begin()`** after each successful read to keep the system sheet visible, but this still produces a re-presentation flicker and the sheet will dismiss for a few hundred ms before the next session opens. Not great UX.

Alternatives:
- **MVP**: single-tap mode only. After each scan, the sheet dismisses, user sees the celebration, and there's a small "Scan another" button that re-opens the sheet. Two taps per habit but no flicker.
- **Phase 2 — auto-relaunch**: after celebration flash dismisses (~2 s), auto-re-`begin()` if the user is still on the Today screen. Cancel-able by tapping anywhere outside the sheet.
- **Phase 2 — explicit batch mode**: a "Log routine" entry point that walks the user through pre-selected habits with named prompts ("Tap your meditation tile") and auto-advances.

Apple does not currently expose a "session continues after read" API for `NFCNDEFReaderSession`. `NFCTagReaderSession` has slightly more control but still requires explicit re-begin. Don't pursue continuous mode — it doesn't exist.

### Coexistence with existing kid-celebration overlay

The CompletionFlash component at [src/App.js:1590](src/App.js:1590) renders when `flashData` is truthy, which happens inside `handleComplete`. Since the active-scan path routes through the same `setDeepLinkTileUID → handleComplete` chain, the flash fires automatically. With approach (a) above (sheet dismisses before `tagRead` emits), the flash will render on top of the bare app, not behind the sheet. ✅

### App Intents / Shortcuts / Lock Screen — Phase 2

The biggest UX improvement after MVP would be exposing "Quick Log" as an `App Intent`:

- **Home screen icon shortcut** ("Open Ritual to scan") — closes one tap from the "open app, find FAB, tap" flow.
- **Lock Screen / Action Button** (iPhone 15 Pro+) — single press opens scan directly.
- **Siri** ("Hey Siri, scan a tile") — voice trigger.

Implementation: add an `AppIntents` framework target (Swift, separate from the Capacitor plugin), declare a `ScanTileIntent` with `.openAppIntent`. The intent invocation deep-links into the app via a custom URL scheme (`Ritual://scan` already partly configured — see [capacitor.config.ts:12](capacitor.config.ts:12) `scheme: 'Ritual'`), the app reads that on `appUrlOpen`, immediately invokes the scan plugin.

Effort: ~1 dev-day on top of MVP. Strong leverage — closes most of the "opening the app feels slow" complaint by letting users skip the cold-launch entirely.

**Recommendation: include App Intents in MVP if scope permits, otherwise Phase 2.**

---

## 5. Coexistence with passive NFC

The two flows are independent and convergent:

```
[ Passive — phone-near-tile, no app open ]
NFC chip background poll → iOS NFC notification → user tap →
  Universal Link → AppDelegate.continue(userActivity:) →
  Capacitor App plugin → JS appUrlOpen listener (App.js:4343) →
  parseTileUrl → setDeepLinkTileUID → useEffect → handleComplete

[ Active — app foreground, user taps FAB ]
RitualNFC.startScan() → NFCNDEFReaderSession.begin() → user-tap →
  didDetectNDEFs → notifyListeners('tagRead', { url }) →
  JS tagRead listener → parseTileUrl → setDeepLinkTileUID →
                                       useEffect → handleComplete
```

Both converge on `setDeepLinkTileUID(uid)`. The existing 1-second debounce at [src/App.js:5174](src/App.js:5174) (`tileHandled.current`) prevents double-fire if both paths somehow trigger for the same tile within 1 s.

**Coexistence checks (all clean):**

- ✅ `NFCNDEFReaderSession` does NOT register the app for background/passive NFC. The two are independent iOS subsystems. Adding active scanning does not change passive behavior.
- ✅ The new entitlement (`com.apple.developer.nfc.readersession.formats = [NDEF]`) is independent of `Associated Domains`. Both can be enabled simultaneously on the same App ID and same `.entitlements` file. No conflict.
- ✅ The new Info.plist key (`NFCReaderUsageDescription`) is reader-session-only; doesn't affect UL handling or any other system.
- ✅ Race condition between active scan and concurrent passive UL: extremely unlikely (active scan requires foreground; passive UL launches the app, which would background any in-flight scan and iOS would auto-invalidate). The 1-s debounce covers the theoretical case.

**Outstanding entitlement question (carryover from previous report):** Ritual's repo currently has NO committed `.entitlements` file or `CODE_SIGN_ENTITLEMENTS` build setting (`grep -c "ENTITLEMENTS\|applinks" ios/App/App.xcodeproj/project.pbxproj → 0`). Yet UL works in production. The likely explanation: Xcode's automatic signing pulls capabilities from the App ID portal config and synthesizes entitlements at build time, but the file isn't tracked in git.

**This becomes a build-reproducibility problem when adding NFC**: the new `com.apple.developer.nfc.readersession.formats` key needs a place to live. Two options:
1. Toggle the capability in Xcode → Xcode generates `App.entitlements`, sets `CODE_SIGN_ENTITLEMENTS` in pbxproj. **Commit both**. This also captures the existing `Associated Domains` entitlement, fixing the build-reproducibility issue retroactively.
2. Don't commit, rely on automatic signing. Brittle — Willem's machine and Christelle's machine may produce different builds. Avoid.

**Recommend option 1** — it's the right time to fix the entitlements drift.

---

## 6. Edge cases and failure modes

| Scenario | iOS behavior | Plugin response |
|---|---|---|
| User taps Cancel on scan sheet | `didInvalidateWithError` fires with `NFCReaderError.readerSessionInvalidationErrorUserCanceled` | Plugin resolves `startScan()` with `{cancelled: true}` (or rejects with a specific error code). JS shows nothing, returns to app silently. |
| Tag is not NDEF | Won't happen with current tiles, but defensively: `didDetectNDEFs` won't fire; `didInvalidateWithError` fires with `readerSessionInvalidationErrorFirstNDEFTagRead` | Plugin sets `session.alertMessage = "Couldn't read tile"` + invalidates with error message. User sees red error sheet, retries. |
| NDEF record contains a non-Ritual URL | `didDetectNDEFs` fires with valid records; URL extracted but `parseTileUrl` returns null | Plugin still emits `tagRead`. JS handler sees `null` from parser, shows in-app toast: "That's not a Ritual tile". Sheet stays dismissed. |
| Session 60-second timeout | `didInvalidateWithError` fires with `readerSessionInvalidationErrorSessionTimeout` | Plugin resolves with `{timedOut: true}`. JS could auto-re-launch silently or show "Session ended — tap Scan again". |
| NFC unavailable (iPad, iPhone 6 or older) | `NFCNDEFReaderSession.readingAvailable == false` | FAB hidden. If user somehow triggers scan (e.g. via Siri intent), plugin resolves with `{unavailable: true}` and JS shows toast: "NFC not available on this device". |
| Low Power Mode | Active scanning is unaffected (system explicitly allows it; LPM only dampens passive polling). | No-op. |
| User has not granted reader-session permission | iOS shows the system permission prompt the FIRST time `begin()` is called. If declined, all future `begin()` calls fail silently with `readerSessionInvalidationErrorSystemIsBusy` until the user re-grants in Settings. | Plugin detects this via the error code on first session and surfaces a "Allow NFC in Settings" prompt with a deep-link to `app-settings:`. |
| Multiple sessions tried concurrently | iOS rejects 2nd `begin()` with `readerSessionInvalidationErrorSystemIsBusy` | Plugin guards: if a session is already in-flight, second `startScan()` rejects with `{busy: true}` immediately without touching iOS. |
| Reader session active when iOS auto-backgrounds app (incoming call, etc.) | iOS invalidates session | Same as user-cancel path; resolves cleanly. |

### iOS version-specific behavior

- **iOS 16**: Baseline behavior, no relevant differences.
- **iOS 17**: Added `appIntent` integration with NFC (improves Shortcuts pairing). Phase 2 territory.
- **iOS 18**: Apple introduced "background tag reading control" for tag-writer apps. **Not relevant** to a reader-only app. No regressions reported for `NFCNDEFReaderSession` reader mode.
- **iOS 19** (current as of 2026): No documented breaking changes to Core NFC reader sessions. Deployment target stays at 15.0.

---

## 7. Feasibility verdict

### Verdict: **Feasible with minor caveats**

- ✅ APIs are stable and well-documented.
- ✅ Entitlement and plist additions are routine.
- ✅ Existing app architecture has a clean integration seam (the `setDeepLinkTileUID` pipeline).
- ✅ Both passive and active flows can coexist without conflict.
- ⚠️ Apple's scan sheet UI is non-customisable — set expectation with users that scanning shows iOS branding, not Ritual branding.
- ⚠️ True multi-tap routines require Phase 2 work; MVP is one tile per user-tap.
- ⚠️ iPad has no NFC — feature must be hidden, not just disabled, on those devices.

### Recommended approach — summary

| Decision | Recommendation |
|---|---|
| iOS API | `NFCNDEFReaderSession` |
| Capacitor integration | **`@capgo/capacitor-nfc` v8.0.25** — same vendor as the OTA plugin already in Ritual's stack, MPL-2.0, Cap-8-aligned, near-empty issue tracker. Custom Swift plugin (~150 lines) is the documented fallback if iOS lifecycle bugs surface during the spike |
| FAB placement | Bottom-right of Today screen, above tab bar, gated on the plugin's `isAvailable()` (false on iPad, iPhone 6 and earlier) |
| URL parsing | Extract `parseTileUrl(urlStr)` helper, call from all three sites (passive UL, cold-launch URL, active scan) |
| Multi-tap | Single-scan MVP; "Scan another" button for round 2; auto-relaunch deferred to Phase 2 |
| Entitlements file | Generate via Xcode "+ Capability" → commit both `.entitlements` and the pbxproj `CODE_SIGN_ENTITLEMENTS` change. Same time, capture the existing `Associated Domains` capability that's currently undocumented in git |
| App Intents / Shortcuts | Phase 2, ~1 day extra |

### Estimated effort breakdown

| Task | Effort | Dependencies |
|---|---|---|
| `npm install @capgo/capacitor-nfc`, `pod install`, smoke test in dev | 0.25 day | — |
| Add entitlements + Info.plist key + Apple portal capability toggle | 0.25 day | — |
| Extract `parseTileUrl` helper, refactor 3 call sites | 0.25 day | — |
| TodayScreen FAB component + availability gate via plugin's `isAvailable()` | 0.5 day | parseTileUrl extracted |
| Wire FAB → plugin → existing pipeline (`setDeepLinkTileUID`) | 0.5 day | All above |
| Edge-case handling (cancel, timeout, non-Ritual URL, busy, unavailable, settings deep-link) | 0.5 day | — |
| Initial TestFlight build + smoke test on real device | 0.25 day | All above |
| One round of UX feedback iteration (Christelle + Jean's family) | 1.0 day | First TestFlight |
| **MVP total (community plugin path)** | **~3–3.5 dev-days** | |
| Custom plugin fallback if Capgo proves unworkable | +1.0–1.5 days | — |
| App Intents / Shortcuts integration (Phase 2) | +1.0 day | MVP shipped |
| Multi-tap auto-relaunch (Phase 2) | +0.5 day | MVP shipped |
| Continuous-batch UI ("Log routine" walkthrough, Phase 2) | +1.5 days | Multi-tap auto-relaunch shipped |

### Risks and unknowns

1. **Capgo plugin maturity is one-vendor-deep.** 19 GitHub stars, MPL-2.0, single maintainer team. If Capgo as a company stops maintaining the plugin between Capacitor majors (Cap 9 lands → plugin doesn't update), we're stranded on a frozen version. Mitigation: the custom-plugin fallback documented in §2 is genuinely small and Willem already has the Swift skill. Cost of switching: ~1.5 days work, low-friction if it ever becomes necessary.
2. **MPL-2.0 modification clause.** If we ever fork the Capgo plugin's Swift to fix a bug ourselves, the patched files must remain MPL. Mitigation: prefer extending via wrapping rather than in-place patching. Not a blocker, just a hygiene note.
3. **Apple's scan sheet branding** — users may not realise the sheet IS Ritual scanning. The `alertMessage` is settable ("Tap a Ritual tile") but the sheet header is fixed "Ready to Scan". Real-user UX test on Jean's family will tell us if this is a problem.
4. **The `appReadyTimeout` race with Capgo updater** — if active scanning somehow delays `notifyAppReady()`, Capgo could roll back the bundle. Confirmed harmless: scanning starts AFTER React mount AFTER `notifyAppReady()` already fires in [src/index.js:10](src/index.js:10). No interaction.
5. **Two Capgo plugins active at once** — `@capgo/capacitor-updater` and `@capgo/capacitor-nfc`. Confirmed independent (different plugin classes, no shared state, no dispatch-queue contention surfaced in the updater Swift). Worth re-verifying once integrated, but no theoretical conflict.
6. **Tile UID format drift** — the parser handles `:` and `.` separators ([src/App.js:5169](src/App.js:5169)). If the hardware writer changes format, both paths break together — unifying into `parseTileUrl` makes that a one-line fix instead of two.
7. **iOS permission UX** — first-tap shows the system NFC permission prompt (not the scan sheet). This is unfamiliar to users. Mitigation: show a one-time in-app explainer screen before the FIRST `startScan()` call ("To scan tiles, allow NFC access. iOS will ask once.").

### Recommended phasing

**Phase 1 — MVP (3–3.5 days using `@capgo/capacitor-nfc`):**
- Plugin install + smoke test on dev device
- FAB on Today screen, NFC-availability-gated
- Extracted `parseTileUrl` helper
- All edge cases handled (cancel, timeout, busy, unavailable, non-Ritual URL)
- Entitlements + plist properly committed
- Ships to TestFlight; Jean's family is the first cohort

**Phase 2 — Routine support + Intent integration (2–3 days, post-MVP feedback):**
- App Intents → Siri / Lock Screen / Shortcuts wiring
- Auto-relaunch for sequential taps
- "Log routine" guided walkthrough for batch logging

**Phase 3 — Optional polish:**
- In-app NFC explainer screen for first-time users
- Refined error UX (in-sheet vs in-app messaging split)
- Telemetry: log scan-success-rate, time-to-first-read, cancel-rate

---

## Open questions for Christelle

1. **App Intents / Shortcuts** — include in MVP (+1 day) or defer to Phase 2? Strong leverage but expands the surface area Willem needs to touch.
2. **Tab bar vs FAB for Quick Log entry point** — going with FAB unless you've got a strong preference. If a permanent "Scan" tab is preferred, that's a different design conversation but technically simple.
3. **Multi-user tile flow** — when an active scan reads a tile assigned to a multi-person habit, the "Who did this?" prompt fires (existing logic at [src/App.js:5205](src/App.js:5205)). Same UX as passive. Confirm that's the desired behavior and not, e.g., "scan = current member only".
4. **iPad** — should Quick Log be hidden on iPad (NFC unavailable) or do we want a friendly "NFC not supported on this device, use passive tap" placeholder? Current rec: hide entirely.

---

*Report ends. Plugin landscape research complete (May 2026): `@capgo/capacitor-nfc` v8.0.25 recommended; `@exxili/capacitor-nfc` disqualified by open issue #25 against Ritual's exact iOS 26 + NTAG215 hardware; `@capawesome-team/capacitor-nfc` is paid/sponsorware and overkill; all others are dead or Cap-6-only.*
