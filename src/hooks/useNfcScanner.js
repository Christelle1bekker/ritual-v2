import { useCallback, useEffect, useRef, useState } from 'react';
import { CapacitorNfc } from '@capgo/capacitor-nfc';
import { createScanLifecycle } from '../utils/nfcScanLifecycle';

// Hook wrapping @capgo/capacitor-nfc's reader session.
//
// API:
//   const { scan, isAvailable } = useNfcScanner();
//   scan():        Promise<string | null>
//   isAvailable(): boolean
//
// scan() resolves with the raw URL string on a successful read, or null on
// any non-success outcome (user cancel, 60s session timeout, system error).
// It rejects only when @capgo/capacitor-nfc's startScanning() itself rejects
// — i.e. the device has no NFC hardware (NO_NFC) or some other hard failure
// before the session can begin.
//
// All session-lifecycle rules (single-flight, settle delay, event gating,
// double-resolve protection) live in src/utils/nfcScanLifecycle.js where
// they are unit-tested. This hook only owns React plumbing: listener
// registration and the isSupported() capability check.
//
// LIMITATION (intentional): on the iOS NDEF session path, the plugin emits
// a single 'nfcStateChange' event for cancel, timeout, and most errors with
// the same payload — the underlying NFCReaderError code is not propagated
// to JS. We therefore cannot distinguish these outcomes here and collapse
// them all to null. The user still sees iOS's own per-case sheet UI
// (Cancel button, red error sheet, etc.) so feedback is not lost.
//
// SESSION TYPE (status as of July 2026): we request iosSessionType 'ndef'.
// Apple deprecated NDEF reader sessions in iOS 26.4 and the NDEF
// entitlement was removed in f9929e3 (TAG-only formats array) — but the
// deprecated NFCNDEFReaderSession API still functions and is what shipped
// through TestFlight validation. Do NOT switch this to 'tag' as a drive-by:
// the plugin's tag path (a) swallows user-cancel (no event reaches JS) and
// (b) polls FeliCa without our having the FeliCa entitlement, causing a
// fail-and-retry double session start per scan. See
// spike/nfc-reliability-audit.md for the coordinated migration plan.
export function useNfcScanner() {
  const [supported, setSupported] = useState(false);
  // One lifecycle per hook instance, created lazily so the plugin proxy is
  // only touched on native. Stable across re-renders.
  const lifecycleRef = useRef(null);
  if (!lifecycleRef.current) {
    lifecycleRef.current = createScanLifecycle(CapacitorNfc);
  }

  useEffect(() => {
    let cancelled = false;
    let eventListener = null;
    let stateListener = null;

    (async () => {
      try {
        const { supported: s } = await CapacitorNfc.isSupported();
        if (!cancelled) setSupported(s);
      } catch (e) {
        console.warn('[useNfcScanner] isSupported() check failed:', e);
      }

      // Listeners are registered ONCE for the hook's lifetime. The Capgo
      // plugin emits nfcStateChange with retainUntilConsumed: true, so a
      // freshly-attached per-scan listener would consume any retained
      // event from the previous scan's invalidation immediately on attach
      // and resolve the new scan's promise with null. Mount-time
      // registration sidesteps the per-scan attach window entirely; the
      // settle delay and in-flight gate in nfcScanLifecycle handle the
      // remaining timing windows.
      try {
        eventListener = await CapacitorNfc.addListener('nfcEvent', (event) => {
          lifecycleRef.current.onNfcEvent(event);
        });
        stateListener = await CapacitorNfc.addListener('nfcStateChange', () => {
          lifecycleRef.current.onStateChange();
        });
      } catch (e) {
        console.warn('[useNfcScanner] listener registration failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      // Drop listeners on unmount. If a scan is in flight at unmount, its
      // promise goes unobserved alongside the rest of the React tree.
      (async () => {
        try { await eventListener?.remove(); } catch {}
        try { await stateListener?.remove(); } catch {}
      })();
    };
  }, []);

  const scan = useCallback(() => lifecycleRef.current.scan({
    iosSessionType: 'ndef',
    invalidateAfterFirstRead: true,
    alertMessage: 'Hold your iPhone near a Ritual tile',
  }), []);

  const isAvailable = useCallback(() => supported, [supported]);

  // Opens the iOS per-app Settings page (UIApplication.openSettingsURLString)
  // so the user can toggle the NFC permission after a denial.
  const showSettings = useCallback(async () => {
    try {
      await CapacitorNfc.showSettings();
    } catch (e) {
      console.warn('[useNfcScanner] showSettings() failed:', e);
    }
  }, []);

  return { scan, isAvailable, showSettings };
}
