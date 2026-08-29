// NFC reader-session state machine, extracted from src/hooks/useNfcScanner.js
// so the lifecycle rules (single-flight guard, settle delay, event gating,
// double-resolve protection) are unit-testable without React or Capacitor.
//
// The hook owns listener registration and React plumbing; this module owns
// every decision about WHEN a session may start and HOW its end is observed.
//
// Session lifecycle this module enforces (iOS, one reader session at a time):
//
//   scan() called
//     └─ single-flight: a scan already in flight → warn + resolve null
//     └─ settle wait: ≥ SETTLE_MS since the last session ended
//        (NFCNDEFReaderSession teardown is asynchronous; starting a new
//         session before the previous one finished tearing down silently
//         fails AND any retained nfcStateChange from the previous
//         invalidation gets consumed by the next scan. Empirically chosen
//         750ms gap covers both — see commit 50ff729.)
//     └─ nfc.startScanning() → native begins exactly one session
//   session ends, exactly one of:
//     └─ onNfcEvent  (tag read)      → stopScanning() to dismiss the iOS
//        sheet (the Capgo plugin implements readerSession(_:didDetect:),
//        which makes iOS IGNORE invalidateAfterFirstRead — without the
//        explicit stop the session stays armed and the sheet stays up,
//        cc0ca11) → resolve(url)
//     └─ onStateChange (cancel / 60s iOS timeout / system error — the
//        plugin collapses all of these into one opaque event) → resolve(null)
//     └─ watchdog (default WATCHDOG_MS, past iOS's 60s session ceiling) →
//        the terminal event was swallowed; stopScanning() + resolve(null)
//        so the single-flight guard can never wedge permanently
//     └─ cancel() (ANDROID ONLY today) → the user dismissed our in-app scan
//        overlay; stopScanning() + resolve(null)
//   either way lastSessionEndedAt is stamped so the next scan settles —
//   including when startScanning() itself rejects (no back-to-back retry
//   against a radio that just reported a start failure).
//
// ANDROID (added 2026-08-29): the same machine drives Android, but the
// native semantics differ and the differences are handled by the CALLER,
// not here:
//   - startScanning() = NfcAdapter.enableReaderMode: it resolves immediately,
//     shows NO system sheet, offers NO cancel, and never times out. Nothing
//     ends an Android session except a tag read, our cancel(), or the
//     watchdog — hence cancel() and the per-scan watchdogMs below.
//   - nfcStateChange on Android is an ADAPTER on/off broadcast, not a
//     "session ended" signal. Treating it as a terminal event is still the
//     right call (NFC switched off mid-scan = the session is dead) so the
//     existing onStateChange path is deliberately left as-is.
//
// Constructor injection (now/schedule/cancel/warn) exists purely for tests.
import { extractUrlFromTag } from './nfcNdef';

export const SETTLE_MS = 750;
// iOS hard-caps reader sessions at 60s, so every session MUST produce a
// terminal event by then. The watchdog sits just past that ceiling as
// belt-and-braces: if a terminal event is ever swallowed (e.g. the Capgo
// plugin's TAG path suppresses user-cancel entirely), the scan resolves
// null instead of wedging the single-flight guard until app restart —
// which would read exactly like "scanning worked, then stopped working".
//
// This is the DEFAULT only. Callers may pass a per-scan watchdogMs (see
// scan()) because Android has no 60s ceiling to sit behind — there the
// watchdog IS the visible session length, not a backstop. iOS passes
// nothing and therefore keeps exactly this value.
export const WATCHDOG_MS = 65000;

export function createScanLifecycle(nfc, opts = {}) {
  const {
    now = () => Date.now(),
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id),
    warn = (...args) => console.warn(...args),
  } = opts;

  // Holds { resolve } for the in-flight scan. Event handlers gate on this:
  // null means no scan is in flight and the event is ignored. This is
  // defence-in-depth against the retained nfcStateChange events the Capgo
  // plugin buffers across scans (notifyListeners is called with
  // retainUntilConsumed:true). Primary protection is the settle delay in
  // scan() — the gate catches anything that slips through.
  let currentScan = null;
  let scanning = false;
  let lastSessionEndedAt = 0;

  // Claim the resolution slot synchronously so concurrent nfcEvent /
  // nfcStateChange handlers can't double-resolve one scan. Cancels the
  // claimed scan's watchdog — a normally-resolved scan must never see it.
  function claim() {
    const entry = currentScan;
    if (!entry) return null;
    currentScan = null;
    if (entry.watchdogId != null) cancel(entry.watchdogId);
    return entry;
  }

  async function onWatchdog(entry) {
    if (currentScan !== entry) return; // resolved normally — nothing to do
    currentScan = null;
    warn('[nfcScanLifecycle] no terminal event within', entry.watchdogMs, 'ms of session start — force-resolving scan');
    // If the session were somehow still armed, stop it before releasing the
    // slot so the next scan doesn't begin() over a live session.
    try { await nfc.stopScanning(); } catch {}
    lastSessionEndedAt = now();
    entry.resolve(null);
  }

  async function onNfcEvent(event) {
    const entry = claim();
    if (!entry) return; // no scan in flight — retained-event safety
    const url = extractUrlFromTag(event?.tag);
    // Explicit stopScanning() is required: without it the iOS scan sheet
    // doesn't dismiss reliably (cc0ca11) because the plugin's tag-handler
    // delegate method disables invalidateAfterFirstRead.
    try { await nfc.stopScanning(); } catch {}
    lastSessionEndedAt = now();
    entry.resolve(url);
  }

  function onStateChange() {
    const entry = claim();
    if (!entry) return; // no scan in flight — retained-event safety
    // Session invalidated — cancel, timeout, and most errors all arrive
    // here as the same opaque event (the underlying NFCReaderError code is
    // not propagated to JS). Record completion time so scan() can enforce
    // the settle delay before the next session starts.
    lastSessionEndedAt = now();
    entry.resolve(null);
  }

  // Ends the in-flight session on demand and resolves its promise with null.
  //
  // ANDROID: this is the ONLY user-driven way out of a scan. enableReaderMode
  // arms the radio silently — there is no system sheet and no Cancel button —
  // so the app renders its own overlay and wires its Cancel button here.
  // (On iOS the OS sheet's own Cancel produces an nfcStateChange instead, so
  // nothing calls this; leaving it unused there keeps iOS byte-identical.)
  //
  // Deliberately mirrors the onNfcEvent/onStateChange shape: claim() first so
  // a tag read landing in the same tick can't also resolve the scan (and so
  // the watchdog is cancelled), stop the session, stamp the settle clock, then
  // resolve. When nothing is in flight claim() returns null and this is a
  // no-op — a double-tap on Cancel, or a Cancel racing the read that already
  // resolved the scan, must not stop a session the NEXT scan just started.
  async function cancelScan() {
    const entry = claim();
    if (!entry) return;
    // Best-effort: if disableReaderMode fails the promise must still settle,
    // otherwise the overlay stays up over a scan nobody can end.
    try { await nfc.stopScanning(); } catch {}
    lastSessionEndedAt = now();
    entry.resolve(null);
  }

  // Resolves with the raw URL string on a successful read, or null on any
  // non-success outcome (user cancel, 60s session timeout, system error).
  // Rejects only when nfc.startScanning() itself rejects — i.e. no NFC
  // hardware (NO_NFC), NFC switched off (NFC_DISABLED, Android), or some
  // other hard failure before the session begins.
  //
  // startOptions is passed straight to the plugin. sessionOptions is ours:
  //   watchdogMs — override the force-resolve deadline for THIS scan only.
  //     Android passes a shorter value because the watchdog doubles as the
  //     visible scan window there. Omitted (iOS) ⇒ WATCHDOG_MS, unchanged.
  async function scan(startOptions, sessionOptions = {}) {
    const { watchdogMs = WATCHDOG_MS } = sessionOptions;
    if (scanning) {
      warn('[nfcScanLifecycle] scan() called while another scan is in progress — ignoring concurrent call');
      return null;
    }
    scanning = true;

    const elapsed = now() - lastSessionEndedAt;
    if (elapsed < SETTLE_MS) {
      await new Promise((r) => schedule(r, SETTLE_MS - elapsed));
    }

    try {
      let entry;
      const scanPromise = new Promise((resolve) => {
        entry = { resolve, watchdogId: null, watchdogMs };
      });
      currentScan = entry;
      entry.watchdogId = schedule(() => { onWatchdog(entry); }, watchdogMs);

      try {
        await nfc.startScanning(startOptions);
      } catch (e) {
        // No session began, but stamp the clock anyway so the next attempt
        // still gets a settle gap — a start failure (e.g. system resource
        // unavailable) must not be retried back-to-back.
        lastSessionEndedAt = now();
        throw e;
      }

      return await scanPromise;
    } finally {
      // Handlers null this on resolution; the belt-and-braces clear here
      // covers the case where startScanning() rejected before any event
      // fired, so the next scan() doesn't see a stale resolve slot (and
      // its watchdog doesn't fire against a dead scan).
      if (currentScan) {
        if (currentScan.watchdogId != null) cancel(currentScan.watchdogId);
        currentScan = null;
      }
      scanning = false;
    }
  }

  // cancelScan is exposed as `cancel` — the local name differs only because
  // `cancel` is already the injected timer-cancel dependency in this closure.
  return { scan, cancel: cancelScan, onNfcEvent, onStateChange };
}
