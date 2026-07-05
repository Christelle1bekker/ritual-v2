# C.4 Xcode handoff — TestFlight build 19

**Date:** 2026-05-04
**Repo state:** local `main` at `6985230`, not pushed
**Build target:** `com.ritualhabits.app` v1.0 (19), Internal Testing only
**Companion docs:** [active-nfc-scanning-build-plan.md](active-nfc-scanning-build-plan.md), [active-nfc-scanning-spike.md](active-nfc-scanning-spike.md)

This is the first TestFlight build that includes:
- The `@capgo/capacitor-nfc` plugin
- The `Near Field Communication Tag Reading` entitlement (NDEF only)
- The `Privacy - NFC Scan Usage Description` Info.plist key
- The `useNfcScanner` hook + `parseTileUrl` helper + `[DEBUG] Scan tile` button on every tab

The button is intentionally a debug stub (red top-right corner). Step D will replace it with a styled FAB. Build 19 is for **Christelle-only Internal Testing**; do not add to External Testing or any other group.

---

## Xcode UI steps

1. **Open Xcode.** If the project isn't already open, open `ios/App/App.xcodeproj` (NOT `App.xcworkspace` — Capacitor 8 with SPM uses the `.xcodeproj` directly).

2. **Change the device target** in the top toolbar (left of the Run button) from any simulator (e.g. "iPhone 17 Pro") to **"Any iOS Device (arm64)"**. Archive requires a real-device target — it will refuse to archive against a simulator.

3. **Wait for Xcode to re-index** if it just switched targets. Indicator: the activity spinner in the title bar stops, and the Run button becomes solid (not greyed out). Usually 10–30 s. Don't rush past this — archiving while indexing can produce stale builds.

4. **Menu: Product → Archive.** This compiles in Release configuration with build 19 and produces an `.xcarchive`. Typically 2–5 minutes.

5. **The Organizer window opens automatically** once the archive is built. Find the new archive at the top of the list — it should show:
   - **Version:** 1.0
   - **Build:** 19
   - **Date:** today
   If the build number isn't 19, **stop** and check the pbxproj — something went sideways.

6. **Click "Distribute App"** (right side of the Organizer).

7. **Choose "TestFlight Internal Only"** in the distribution method dialog.
   - **NOT** "App Store Connect" (that pushes to External Testers + App Review queue)
   - **NOT** "Ad Hoc" (sideload distribution)
   - **NOT** "Development" (just a local build, doesn't reach TestFlight)

8. **Walk through the wizard.** Sign with the existing team (`UDB2JG9XK6`) — should be the only team option since automatic signing is on.

9. **Upload completes.** Xcode shows a "Distributed successfully" confirmation. App Store Connect then **processes** the build (typically 5–15 minutes — you'll get an email from Apple when processing finishes, or you can check by refreshing the TestFlight tab in App Store Connect).

10. **Once processed, build 19 appears in the TestFlight tab.** Add it to the **Friends & Family Internal Testing** group ONLY. Do NOT add to External Testing — the smoke test happens before any external testers see this build.

11. **Open the TestFlight app on your iPhone**, install build 19, and run the smoke tests below.

---

## Smoke test plan — both must pass before authorising Step D

### Test 1: Active scan happy path (the new code path)

1. Force-quit Ritual on your iPhone (so it's a cold launch).
2. Open Ritual via TestFlight. Push through any login/onboarding to reach the Today screen.
3. Look top-right: a **red `[DEBUG] Scan tile`** button should be visible above all other UI. (It's intentionally ugly — that's the point.)
4. Tap the button.
5. **First time only:** iOS shows a permission prompt: "Ritual would like to scan NFC tags." with the description string we set ("Ritual uses this to scan your habit tiles."). Tap **Allow**.
6. iOS shows its native scan sheet at the bottom of the screen. The header reads "Ready to Scan"; the body reads **"Hold your iPhone near a Ritual tile"** (our custom alertMessage). A Cancel button is at the bottom.
7. Hold the phone near a real Ritual tile (a known assigned tile is best — you can confirm the habit logs).
8. The scan sheet briefly shows a success indicator, then dismisses.
9. The Ritual app's **CompletionFlash celebration overlay** fires for the assigned habit.
10. The habit shows as completed in the Today list. Verify a row in Supabase too if you want belt-and-suspenders.

**Expected console log lines** (visible in macOS Console.app filtered to the Ritual bundle ID, if you connect the iPhone to your Mac):
```
[TILE TAP] activeScan: received URL = https://app.ritualhabits.com.au?tile=...
[TILE TAP] activeScan: extracted tile_uid = <UID>
```

### Test 2: Step B regression — passive tap still works identically

This is to confirm the `parseTileUrl` extraction in Step B (commit `680c78b`) didn't change the existing passive flow.

1. Force-quit Ritual.
2. Hold the phone near a Ritual tile (DON'T open the app first — this triggers iOS's background NFC reading + Universal Link path).
3. iOS shows the standard NFC notification banner with the URL preview.
4. Tap the banner.
5. Ritual cold-launches; the habit logs through the existing pipeline; CompletionFlash fires.
6. Confirm console log lines (same as before Step B):
   ```
   [TILE TAP] appUrlOpen: received URL = https://app.ritualhabits.com.au?tile=...
   [TILE TAP] appUrlOpen: extracted tile_uid = <UID>
   ```
   (NOT `activeScan:` — the passive path uses the `appUrlOpen:` source marker.)

If passive tap behaves identically to before this build cycle, Step B regression check passes.

### Test 3: Edge cases (worth checking, not strict gates)

- **Cancel:** tap `[DEBUG] Scan tile` → tap Cancel on the iOS sheet → app should return silently. No celebration overlay, no crash, no toast (we explicitly chose silent — Step F handles user-facing error UX).
- **Timeout:** tap `[DEBUG] Scan tile` → wait 60 seconds without tapping anything → iOS auto-dismisses the sheet → app returns silently. Console shows no `[TILE TAP] activeScan:` lines (the null-resolve path doesn't log).
- **Non-Ritual NFC tag:** if you have a transit card / Airtag / random NFC sticker, tap `[DEBUG] Scan tile` → tap the non-Ritual tag → console should show:
  ```
  [TILE TAP] activeScan: received URL = <whatever the tag encodes>
  [TILE TAP] activeScan: no tile UID in URL
  ```
  No celebration, no crash. (Step F will add a user-facing toast for this — Step C just logs.)

---

## Authorisation gate

After Tests 1 and 2 pass on Christelle's iPhone, **Christelle authorises Step D** in the chat. Step D replaces the debug button with the proper FAB (gated on `isAvailable()`, only on Today tab, styled).

If Test 1 fails (button missing, scan sheet doesn't appear, plugin crashes, habit doesn't log) → **stop and report** to chat-side Claude. The next step is the build plan's §C.4 pivot decision (Capgo plugin vs custom Swift plugin). Apply the 3-of-3 retry rule: if the same case fails 3 times in a row from a clean app launch, that's blocking; if it fails 1-of-3 with no clear pattern, it's flake — note and proceed.

If Test 2 fails (passive tap broken) → **stop and report immediately**. This means the Step B refactor regressed the existing flow — high-priority backout candidate. Don't ship anything to Jean until passive is restored.

---

## Hard constraints during this handoff

- ❌ **Do not add build 19 to External Testing.** Internal Testing → Christelle's iPhone only.
- ❌ **Do not submit for App Store review.** "TestFlight Internal Only" distribution route, never "App Store Connect" submission.
- ❌ **Do not add Jean or other external testers to this build.** Jean comes in at Step G after Steps D + E + F polish lands.
- ❌ **Do not run `git push`** during this work. Repo stays local until explicit green-light.
- ❌ **Do not bump MARKETING_VERSION** to 1.1 or anything else. It stays at 1.0 through MVP.

## Local commit chain (for reference)

```
6985230 chore(ios): cap sync and bump build to 19 for TestFlight upload    ← C.4
3b0afd8 feat(app): wire active scan path with @capgo/capacitor-nfc          ← C.1+C.2+C.3
680c78b refactor(app): extract parseTileUrl helper for tile URL parsing     ← B
d4ef318 feat(ios): add active NFC scanning capability and NFC plugin        ← A
8863068 fix: edge hairline on overlays                                      ← pre-NFC baseline
```

If TestFlight processing fails or the build is rejected by Apple, the rollback is `git revert 6985230 3b0afd8 680c78b d4ef318` — back to `8863068`. None of the four NFC commits have been pushed; reverting them locally is enough to clear state.
