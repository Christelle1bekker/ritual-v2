# Ritual Android — Release Runbook (Internal Testing, v1)

**Written:** 2026-08-29, the session that scaffolded `android/`.
**State when written:** signed AAB built, emulator-verified (API 36 AVD), delivered to `~/Desktop/Ritual Android Release/ritual-1.0.46-35.aab` (md5 `502cfda07d8abd62b6506124d33ee6c4`).
**Updated 2026-08-29 (later session):** Play app record live (app ID **4975841049767227291**, package `com.ritualhabits.app`), **AAB 35 (1.0.46) on the internal-testing track**, Play App Signing enrolled, and **assetlinks.json deployed and verified** — steps 1–5 of §2 are DONE; see the log at the end of §2.
**Companion doc:** [ASSESSMENT.md](ASSESSMENT.md) — the inventory and the four rulings this build implements.

Rulings in force: push **OFF** on Android (a); active-scan FAB **shipped** with the Android in-app scan modal (b); tiles encode `https://app.ritualhabits.com.au?tile={UID}` (c); versions `versionName 1.0.46` / `versionCode 35` (d).

---

## 0. Signing key — where it is and what to do about it

| | |
|---|---|
| Upload keystore | `~/.ritual-android-signing/ritual-upload-key.jks` (outside the repo, mode 600) |
| Alias | `ritual-upload` |
| Password | `~/.ritual-android-signing/.password` (same for store and key) |
| Per-machine config | `android/keystore.properties` (gitignored; template: `android/keystore.properties.example`) |

**⚠️ BACKUP STEP FOR CHRISTELLE (do this before the Play upload, same as Beka):** copy the whole `~/.ritual-android-signing/` folder to Google Drive (the same place as `~/.beka-android-signing`'s backup). This is the **upload** key: if it leaks, anyone can push builds to your Play account until you rotate it; if it's lost *after* Play App Signing is enrolled, Google can reset it — annoying, not fatal. Before enrolment, lost = locked out. Back it up **now**, not later.

```bash
cp -R ~/.ritual-android-signing ~/Google\ Drive/  # or via the Drive UI — folder + both files
```

---

## 1. Building the AAB (repeatable)

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd ~/Developer/ritual-v2
npm run build
npx cap sync android
cd android && ./gradlew bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`. The build **fails loudly** if signing credentials are missing (deliberate — see `android/app/build.gradle`). Verify what you actually built — read the versions **out of the AAB**, never off the build log:

```bash
bundletool dump manifest --bundle android/app/build/outputs/bundle/release/app-release.aab | grep -o 'versionCode="[0-9]*"\|versionName="[^"]*"'
jarsigner -verify android/app/build/outputs/bundle/release/app-release.aab
```

**Version rule for every future build:** `versionCode` must strictly increase per Play upload. Keep it in lockstep with the iOS `CURRENT_PROJECT_VERSION` train (both are 35 today); `versionName` stays in lockstep with `package.json` + the Capgo channel (1.0.46 today) per the Capgo guardrails in [CAPGO_OTA_RESTORE.md](../../CAPGO_OTA_RESTORE.md). Note the pre-existing drift: iOS `MARKETING_VERSION` is still 1.0.45 — ruling (d) chose 1.0.46 for Android; realign iOS on its next native build.

---

## 2. Play Console — THE EXACT ORDER. Do not reorder steps.

The ordering exists because of one trap: **`assetlinks.json` needs the *App Signing key* SHA-256, which does not exist until Play generates it at first upload.** Deploying the fingerprint of the *upload* key (`36:36:77:56:DD:A4:B5:AC:...` — the one `keytool` prints locally) verifies nothing: Play re-signs every delivered APK with its own key. This is the single most tempting wrong shortcut in the whole flow.

1. **Create the Play app record.** Play Console → Create app → package `com.ritualhabits.app`, App name "Ritual", **Free**, App category: Lifestyle (or Parenting — decide once, hard to change).
2. **Upload the AAB to Internal testing.** Release → Testing → Internal testing → Create release → upload `app-release.aab`. Add testers (your Google account email list).
3. **Enrol Play App Signing** — offered during that first release flow; accept the default (Google generates the app signing key). This is also the moment the upload key becomes recoverable-if-lost.
4. **Take the APP SIGNING KEY SHA-256** — Play Console → Setup → App integrity → App signing key certificate → SHA-256. **NOT the upload key certificate shown on the same page.** Colon-separated uppercase hex.
5. **Fill and deploy assetlinks.json.** Copy [assetlinks.template.json](assetlinks.template.json) → `public/.well-known/assetlinks.json`, replace the placeholder with the step-4 fingerprint, then also add a `vercel.json` header for it (mirror the existing AASA block):
   ```json
   { "source": "/.well-known/assetlinks.json", "headers": [{ "key": "Content-Type", "value": "application/json" }] }
   ```
   Commit and push — push to `main` deploys it. Verify from outside:
   ```bash
   curl -sI https://app.ritualhabits.com.au/.well-known/assetlinks.json | grep -i content-type   # application/json
   curl -s  https://app.ritualhabits.com.au/.well-known/assetlinks.json | python3 -m json.tool   # parses, real fingerprint
   ```
   **Why this order is load-bearing:** the template is deliberately NOT in `public/` today. `/.well-known/assetlinks.json` currently returns **HTTP 200 with index.html** (the SPA rewrite catches it), which already *looks* live to any casual check. A deployed placeholder or upload-key fingerprint would upgrade that to valid-JSON-wrong-key — even more convincingly broken. Nothing goes to `public/.well-known/` until the real App Signing fingerprint is in hand.
6. **Re-verify on a device** after assetlinks is live: `adb shell pm verify-app-links --re-verify com.ritualhabits.app`, then `adb shell pm get-app-links com.ritualhabits.app` → `verified`. Until step 5, this reports `legacy_failure`/unverified — expected, not a bug; taps fall back to the open-with chooser.
7. **Merge nothing before that** — no other Android work lands on `main` between the AAB upload (2) and assetlinks deploy (5), so the tree that testers install matches the tree that verification points at.

### ✅ Completion log (2026-08-29)

Steps 1–5 executed. Fresh verification output:

- `curl -sI https://app.ritualhabits.com.au/.well-known/assetlinks.json` → `HTTP/2 200`, `content-type: application/json; charset=utf-8` (no vercel.json header was needed — the `.json` extension types correctly; the index.html-200 trap is dead). Body is byte-identical to the committed `public/.well-known/assetlinks.json` (md5-matched).
- Google's checker (`digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.ritualhabits.com.au&relation=delegate_permission/common.handle_all_urls`) returns the statement: package `com.ritualhabits.app`, fingerprint `4C:DD:27:4C:AF:9D:F0:CF:BE:12:DA:F2:20:C0:6F:72:50:19:A7:9E:C6:01:83:2A:2A:36:CC:E7:F5:74:EC:7E`.
- Emulator (API 36 AVD, **locally-signed** release install): `pm verify-app-links --re-verify` then `pm get-app-links` → `app.ritualhabits.com.au: 1024` (unverified). **Expected and correct**: the local build is signed with the upload key (`36:36:77:56:…`), assetlinks serves the Play App Signing cert — these can never match. The real verification test is the Play internal-testing install on a physical phone, which IS signed with the App Signing key.
- Step 6 (`pm get-app-links` → `verified` on a Play-delivered install) remains **open — run it on a physical phone from the internal-testing track**.

### ⚠️ Next build note

Play warned on AAB 35: **upload native debug symbols with the next AAB** (`android.buildTypes.release.ndk.debugSymbolLevel = 'SYMBOL_TABLE'` in `app/build.gradle`, or attach the symbols zip in Play Console when uploading).

---

## 3. App content declarations (Play Console → Policy → App content)

All ten, with the Ritual-specific answer:

| # | Declaration | Ritual answer |
|---|---|---|
| 1 | **Privacy policy** | `https://ritualhabits.com.au/privacy` (already linked in-app from Settings) |
| 2 | **Ads** | **No ads.** |
| 3 | **App access** | Restricted access — provide a working test login (create a dedicated tester family in Supabase; do NOT hand over a real family's credentials). |
| 4 | **Content ratings questionnaire** | Utility/productivity. No violence, no UGC exchange between strangers, no gambling. Expect Everyone/3+. |
| 5 | **Target audience & content** | ⚠️ The honest answer is "adults + children" — kids tap tiles and see their own dashboards. Declaring children as part of the target audience pulls in the Families policy (no ads is already true; data-safety answers must match #7, and "no account deletion for kids" questions may follow). The alternative — declaring 18+ only — misdescribes the product on the record. Recommend declaring the mixed audience honestly and answering the Families follow-ups; budget an extra review round for it. |
| 6 | **News app** | No. |
| 7 | **Data safety** | Collected: email (account), name/profile data (family members incl. children's first names), habit completion history, approximate usage analytics = none (no analytics SDK), push token = **not on Android v1** (push gated off). All encrypted in transit (Supabase TLS); account deletable (state the mechanism honestly — if deletion is manual-by-request today, say so and link a contact). No data sold/shared with third parties. NFC tile UIDs are device-side only until tied to a habit in the family's own Supabase rows. |
| 8 | **Government apps** | No. |
| 9 | **Financial features** | None. |
| 10 | **Health** | Habit tracking is not a regulated health feature; declare "no health features" unless the questionnaire's wording at review time forces "wellness" — read it fresh, it changes. |

Plus the **NFC hardware note**: `uses-feature android.hardware.nfc required=false` means Play does NOT filter out non-NFC devices. That is deliberate (the app works without tiles), but reviewers sometimes ask why an NFC permission exists — the reviewer note field should say "NFC is used solely to read the family's own habit tiles (NDEF URL tags); no payments, no card emulation."

---

## 4. After the first internal release is live

- **Capgo:** VERIFIED live for Android this session, no API key needed — the emulator app phoned `https://plugin.capgo.app/updates` with `platform: android` and the `production` channel answered "No new version available" (channel 1.0.46 = device 1.0.46, the exact no-op ruling d predicted). notifyAppReady() confirmed, builtin bundle active. (No `~/.capgo` key exists on this Mac for channel-admin commands — run those from a machine with the key.) From then on the iOS Capgo guardrails apply to Android unchanged: publish the identical JS to the channel the same day as any native Android build.
- **Supabase redirect URLs:** password login needs none and was verified on the emulator. But signup email confirmation / password reset redirect to `https://app.ritualhabits.com.au/auth/callback` — once App Links verify (step 2.6), that link opens the app directly on Android and flows through the same `appUrlOpen` auth-first handler as iOS. Check the Supabase dashboard's Redirect URLs allowlist contains `https://app.ritualhabits.com.au/auth/callback` (it must already, since iOS uses it) — nothing Android-specific to add; `capacitor://localhost` is iOS-only and `https://localhost` (the Android WebView origin) is not part of any redirect flow in this app.
- **Known Android-v1 limitations (deliberate, ruled):** no push (a); reminders don't reach Android devices even with push on — the cron is APNs-only and paused. Tile taps and the in-app scanner are fully functional.

---

## 5. What was verified vs inferred for this runbook

Verified on the emulator this session: recorded in the session log and the final report (cold launch, splash, login, `am start` tile URL → tap handler, `pm get-app-links` unverified-as-expected). Inferred, not verified: Play Console flow details (UI wording drifts — the *order* is the invariant, per Beka's run in July 2026); Capgo Android channel state (no API key on this Mac); Families-policy review behaviour in #5.
