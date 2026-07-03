# NFC reliability audit — "works then degrades"

**Date:** 2026-07-03
**Branch:** `ritual-nfc-reliability` (off `ritual-dustoff`)
**Scope:** diagnostic stress-test of our NFC detection code across both layers — the JS
`useNfcScanner` hook / scan lifecycle, and the native `@capgo/capacitor-nfc` 8.0.25
session handling it drives. Question under audit: **does our own code degrade the radio
state for later reads?**

**Symptom, precisely:** phone unlocked, app NOT in the foreground. First tile tap detects
quickly and reliably; subsequent detections struggle. Works-then-degrades, not
cold-then-warm.

---

## TL;DR verdict

**The passive works-then-degrades pattern is not caused by our code.** In the passive
flow our app starts **zero** NFC reader sessions — nothing auto-arms at boot, on
foreground, on deep link, or after a tap; the only session starter in the entire codebase
is the Today-screen FAB (`handleScanTile`, [src/App.js:4668](../src/App.js), wired at
[src/App.js:6116](../src/App.js)). iOS force-invalidates any in-app reader session the
moment the app leaves the foreground, so we *cannot* be holding the radio while
backgrounded. The degradation across repeated background reads is Apple's daemon
behaviour (already known and accepted for iPhone 13-and-earlier).

**But the audit found real active-path defects** — one of which produces a
works-then-degrades pattern of its own (for FAB scans, not passive taps) — plus latent
session-hygiene gaps. The code-fixable ones are fixed and unit-tested on this branch;
the native ones are flagged for Willem below, not changed.

---

## 1. Full session lifecycle — BEFORE this branch

### Passive path (the symptom's scenario)

1. Phone unlocked, screen on, app backgrounded/closed. iOS's **system background NFC
   reader** (not our code) reads the tile's NDEF URI.
2. iOS matches `applinks:app.ritualhabits.com.au` → notification banner (or direct
   delivery if our app is foreground) → Capacitor fires `appUrlOpen`
   ([src/App.js:4753](../src/App.js)) → `parseTileUrl` → `setDeepLinkTileUID` → the tile
   trigger effect completes the habit.
3. **At no point does our code start, hold, or re-arm a reader session.** The
   `useNfcScanner` mount effect only calls `isSupported()` (a static capability check,
   no session) and registers listeners.

### Active path (FAB on the Today tab)

JS ([src/hooks/useNfcScanner.js](../src/hooks/useNfcScanner.js), logic now in
[src/utils/nfcScanLifecycle.js](../src/utils/nfcScanLifecycle.js)):

1. `scan()`: single-flight guard (concurrent call → warn + `null`), then **settle
   delay** — waits until ≥750ms since the last session ended (commit `50ff729`).
2. `startScanning({ iosSessionType: 'ndef', invalidateAfterFirstRead: true })`.

Native (`NfcPlugin.swift`, plugin 8.0.25):

3. `startScanning` invalidates any existing sessions, creates an
   `NFCNDEFReaderSession`, calls `begin()`, resolves the JS call immediately
   (NfcPlugin.swift:92–143).
4. Session ends by exactly one of:
   - **Tag read** — the plugin implements `readerSession(_:didDetect:)`
     (NfcPlugin.swift:478), which makes iOS **ignore `invalidateAfterFirstRead`**: the
     session does NOT auto-invalidate after the read. It emits `nfcEvent`; our JS handler
     calls `stopScanning()` to invalidate and dismiss the sheet (this is why `cc0ca11`
     restored the explicit stop). JS resolves the URL.
   - **Cancel / 60s iOS timeout / system error (incl. NFCReaderError 204)** — iOS
     invalidates; `didInvalidateWithError` emits one opaque `nfcStateChange`
     (NfcPlugin.swift:464–476; every code except first-tag-read, which can't occur on
     this delegate path). JS resolves `null`.
   - **App backgrounded mid-scan** — iOS force-invalidates; same `nfcStateChange` path.
5. Either way the JS stamps `lastScanCompletedAt`, so the next FAB scan waits out the
   750ms settle. **There is no retry loop, no auto re-arm, no "scan on foreground"
   anywhere.** Errors resolve to `null`; `handleScanTile` returns silently; trying again
   requires a human FAB tap.

---

## 2. Hypothesis-by-hypothesis verdicts

| Hypothesis | Verdict | Fixable? |
|---|---|---|
| Reader session auto-started / left running / re-armed too aggressively | **Refuted.** Sessions start only from the FAB; nothing re-arms. After a read, the session is stopped as soon as the `nfcEvent` round-trips to JS. | n/a |
| `invalidate()` not completing before the next `begin()` | **Partially confirmed, natively — but unreachable in practice.** `startScanning` invalidates old sessions and `begin()`s the new one in the *same* main-queue tick (NfcPlugin.swift:92–143) without awaiting `didInvalidateWithError`. Our JS never exercises this window: the single-flight guard + 750ms settle mean we never call `startScanning` while/soon-after a session is tearing down. | Native (flagged §5.2) |
| No cooldown/backoff between sessions | **Refuted, with one gap.** The 750ms settle has existed since `50ff729`. Gap: a `startScanning()` **rejection** didn't stamp the settle clock, so a failed start could be retried back-to-back by FAB-mashing. | **Fixed** (§4.2) |
| NFCReaderError 204 hot-looped | **Refuted.** There is no retry logic anywhere in either layer — a 204 surfaces as one `nfcStateChange`, resolves `null`, and waits for a human. With §4.2, even manual retries are now rate-limited. | n/a |
| App holds/monopolises the radio, blocking the OS background reader | **Refuted for the passive symptom; one bounded window on the active path.** iOS kills in-app sessions on backgrounding, so nothing of ours survives to block the background reader. The bounded window: after a successful *active* read, the NDEF session stays armed during the native→WebView round-trip until JS calls `stopScanning()` (because `invalidateAfterFirstRead` is ignored, see §1). Typically <200ms; worst-case bounded by iOS's 60s cap. Foreground-only, user-initiated, and ends at sheet-dismiss. | Native (flagged §5.1) |

**Additional findings not in the hypothesis list:**

| Finding | Verdict | Fixable? |
|---|---|---|
| A swallowed terminal event permanently wedges active scanning. The plugin's TAG path **suppresses user-cancel entirely** (NfcPlugin.swift:622 — no event for `readerSessionInvalidationErrorUserCanceled`). On our current NDEF path all outcomes do emit, so the wedge was theoretical today — but it becomes a **guaranteed works-then-degrades** the day we switch to `'tag'`: first scan works; first cancel wedges the single-flight guard until app restart. | Code-fixable | **Fixed** (§4.1 watchdog) |
| We request `iosSessionType: 'ndef'` ([src/hooks/useNfcScanner.js:93](../src/hooks/useNfcScanner.js)) — the API Apple deprecated in iOS 26.4 — against a TAG-only entitlements file (`f9929e3`). It still works (verified through TestFlight validation at the time), but it's living on borrowed time, and the naïve fix is a trap (§5.3). | Needs coordinated native work | Flagged (§5.3) |
| Passive works-then-degrades on iPhone 13-and-earlier | **OS-level. Not fixable in our code.** Being plain about it: nothing on this branch will change the passive symptom. iOS's background reader applies its own same-tag suppression and daemon throttling; our app isn't even running when it happens. | Not ours |

---

## 3. Session lifecycle — AFTER this branch

Identical to §1 with three additions (all JS, all unit-tested in
[src/utils/nfcScanLifecycle.test.js](../src/utils/nfcScanLifecycle.test.js) — 18 tests
with an injected clock):

1. **Watchdog at 65s** (just past iOS's 60s session ceiling,
   [nfcScanLifecycle.js:44](../src/utils/nfcScanLifecycle.js)): if no terminal event
   arrives, the scan force-resolves `null`, calls `stopScanning()` as hygiene, stamps the
   settle clock, and releases the single-flight guard. Cancelled on every normal
   resolution; provably cannot fire against a live or later scan.
2. **Settle stamp on start failure**: `startScanning()` rejection now also stamps
   `lastSessionEndedAt`, so no back-to-back `begin()` after a start failure.
3. The state machine (single-flight, settle, synchronous claim/double-resolve guard,
   retained-event gating) is extracted from the hook into
   [src/utils/nfcScanLifecycle.js](../src/utils/nfcScanLifecycle.js), and NDEF URI
   decoding into [src/utils/nfcNdef.js](../src/utils/nfcNdef.js) —
   behaviour-identical, now provable. `parseTileUrl` likewise extracted to
   [src/utils/parseTileUrl.js](../src/utils/parseTileUrl.js) (14 tests).

No native code, entitlements, or plugin config changed. No OTA-blocking changes — this
is all JS and can ship via Capgo.

---

## 4. What was fixed (commits on this branch)

1. `7c7d7dc` — extract `parseTileUrl` + tests (build plan §B, finally executed).
2. `9d4ce37` — extract NDEF decode + session state machine into unit-tested modules
   (behaviour-identical).
3. `0e9ad4a` — §4.1 watchdog + §4.2 start-failure settle stamp.

---

## 5. Flagged for Willem — native items (NOT changed here; need a native rebuild)

1. **Plugin should invalidate the NDEF session natively after a successful read** when
   `invalidateAfterFirstRead: true`, exactly like its TAG path already does
   (NfcPlugin.swift:696–698 vs the NDEF `didDetect` at 478–511 which never invalidates).
   Removes the JS-round-trip radio-hold window and the dependence on our explicit
   `stopScanning()`. Upstream PR to Cap-go/capacitor-nfc (MPL — don't patch in place;
   see build-plan risk #9).
2. **`startScanning` should await the old session's `didInvalidateWithError` before
   `begin()`ing a new one** instead of invalidate-then-begin in one tick. Defence in
   depth; our JS settle currently papers over it.
3. **The eventual `'ndef'` → `'tag'` migration** (when Apple removes the deprecated NDEF
   session API). Do NOT flip the JS option as a drive-by; two concrete traps, both
   verified in plugin source:
   - TAG path swallows user-cancel (NfcPlugin.swift:622) → every cancelled scan hangs
     the JS promise. The new watchdog turns that from "wedged until restart" into "FAB
     dead for ~65s" — survivable, still bad UX. Needs the plugin to emit on cancel.
   - TAG path polls `[.iso14443, .iso15693, .iso18092]` (NfcPlugin.swift:113). FeliCa
     polling without the FeliCa entitlement fails and triggers the plugin's
     fallback-retry (NfcPlugin.swift:563–597) — i.e. **two session starts per scan**,
     one of them erroring. That's precisely the session-start churn iOS rate-limits.
     Needs either the plugin exposing polling options or the fallback verified
     harmless on-device.
   - Also note: on the TAG path our tiles still carry NDEF, and the plugin reads
     NDEF-over-tag fine (`processTag`, NfcPlugin.swift:671) — no tile re-encoding
     needed. Entitlements are already TAG-only, so no entitlement change either.

---

## 6. Manual on-device test script

Goal: confirm (a) the passive works-then-degrades pattern is understood as OS-level and
unchanged, and (b) active scanning is robust and never wedges. Use a real iPhone +
2 different Ritual tiles. Keep the phone unlocked, screen on, throughout.

### A. Passive baseline (expect: unchanged by this branch — honesty check)

1. Force-quit Ritual. Tap tile 1 → notification → tap it → habit logs. ✅ expected fast.
2. Background the app (swipe home). Wait 5s. Tap tile 2 → notification → tap → logs.
3. Repeat step 2 alternating tiles 1/2 five times, ~10s apart. Note which taps need
   re-presenting the phone. **Expected: same struggle pattern as before this branch** —
   if it's identical, that confirms the OS-level verdict; we did not claim to fix this.
4. Same-tile repeat: background the app, tap tile 1 twice in a row ~5s apart. The second
   tap often needs tag-removal + re-present — that's iOS same-tag suppression, not us.

### B. Active scan is a good radio citizen (expect: improved / provably bounded)

5. Foreground app, Today tab → FAB → scan tile 1 → sheet dismisses promptly on read,
   habit logs. Repeat immediately: the second FAB tap must start a session no sooner
   than ~750ms after the first ended, and must work.
6. FAB → **Cancel** the sheet → FAB again → works (no wedge, no dead button).
7. FAB → let the sheet sit the full 60s to iOS timeout → FAB again → works.
8. FAB → scan a non-Ritual NFC tag → "That doesn't look like a Ritual tile" toast →
   FAB again → works.
9. Mash the FAB 5× rapidly → exactly one sheet, one session; console shows the
   concurrent-call warn, not five session starts.
10. FAB → while the sheet is up, background the app → foreground → FAB → works.

### C. The interaction the hypothesis worried about (active → passive handback)

11. FAB-scan tile 1 successfully. Immediately background the app. Within ~5s, tap tile 2
    **passively** → does the notification appear about as readily as in step A?
    **Expected: yes** — our session ended at sheet-dismiss, and iOS kills anything left
    on backgrounding. If passive detection here is *consistently worse* than step A's
    baseline, that's new evidence against the OS-reclaim assumption — report it, because
    it would elevate the §5.1/§5.2 native flags from hygiene to suspects.
12. Repeat 11 but *cancel* the scan instead of completing it, then passive-tap. Same
    expectation.

Log capture for any anomaly: Xcode console filtered on `[TILE TAP]`,
`[nfcScanLifecycle]`, `[useNfcScanner]`.
