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
//   either way lastSessionEndedAt is stamped so the next scan settles.
//
// Constructor injection (now/schedule/warn) exists purely for tests.
import { extractUrlFromTag } from './nfcNdef';

export const SETTLE_MS = 750;

export function createScanLifecycle(nfc, opts = {}) {
  const {
    now = () => Date.now(),
    schedule = (fn, ms) => setTimeout(fn, ms),
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
  // nfcStateChange handlers can't double-resolve one scan.
  function claim() {
    const entry = currentScan;
    if (!entry) return null;
    currentScan = null;
    return entry;
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

  // Resolves with the raw URL string on a successful read, or null on any
  // non-success outcome (user cancel, 60s session timeout, system error).
  // Rejects only when nfc.startScanning() itself rejects — i.e. no NFC
  // hardware (NO_NFC) or some other hard failure before the session begins.
  async function scan(startOptions) {
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
        entry = { resolve };
      });
      currentScan = entry;

      await nfc.startScanning(startOptions);

      return await scanPromise;
    } finally {
      // Handlers null this on resolution; the belt-and-braces clear here
      // covers the case where startScanning() rejected before any event
      // fired, so the next scan() doesn't see a stale resolve slot.
      currentScan = null;
      scanning = false;
    }
  }

  return { scan, onNfcEvent, onStateChange };
}
