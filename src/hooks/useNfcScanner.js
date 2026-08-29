import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { CapacitorNfc } from '@capgo/capacitor-nfc';
import { createScanLifecycle } from '../utils/nfcScanLifecycle';

// Android's reader-mode session has no OS-imposed ceiling and no OS cancel
// affordance, so the watchdog is what actually bounds the scan — it is the
// length of the in-app "hold your phone against a tile" overlay. 30s is long
// enough to fish a tile out of a pocket and short enough that a forgotten
// overlay doesn't hold the radio open. iOS keeps WATCHDOG_MS (65s), where the
// watchdog is a backstop behind the OS's own 60s ceiling, not a UI timer.
const ANDROID_SCAN_WINDOW_MS = 30000;

// Hook wrapping @capgo/capacitor-nfc's reader session.
//
// API:
//   const { scan, isAvailable } = useNfcScanner();
//   scan():        Promise<string | null>
//   cancel():      Promise<void>   — ends an in-flight scan (Android UI)
//   isAvailable(): boolean         — hardware present, NOT "NFC is on"
//   getStatus():   Promise<NfcStatus | null>
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

  // startOptions are unchanged on both platforms: Android's enableReaderMode
  // ignores iosSessionType / invalidateAfterFirstRead / alertMessage outright,
  // so there is nothing to branch on there. The ONLY platform difference is
  // the watchdog, passed as a session option so iOS still gets the default.
  const scan = useCallback(() => lifecycleRef.current.scan({
    iosSessionType: 'ndef',
    invalidateAfterFirstRead: true,
    alertMessage: 'Hold your iPhone near a Ritual tile',
  }, Capacitor.getPlatform() === 'android' ? { watchdogMs: ANDROID_SCAN_WINDOW_MS } : undefined), []);

  // Ends an in-flight scan and resolves its promise with null. Wired to the
  // Cancel button of the Android scan overlay; a no-op when nothing is in
  // flight. Unused on iOS, where the system sheet owns cancellation.
  const cancel = useCallback(() => lifecycleRef.current.cancel(), []);

  const isAvailable = useCallback(() => supported, [supported]);

  // Adapter state, which isSupported() deliberately does NOT tell you: on
  // Android isSupported() is only "an NfcAdapter exists", so a phone with NFC
  // switched off reports supported:true and then startScanning() rejects with
  // NFC_DISABLED. Callers check this first to nudge the user to Settings
  // instead of starting a session that can never read anything.
  // Returns the NfcStatus string ('NFC_OK' | 'NFC_DISABLED' | 'NO_NFC' |
  // 'NDEF_PUSH_DISABLED'), or null if the status could not be read — callers
  // must treat null as "unknown, proceed" rather than as a failure.
  const getStatus = useCallback(async () => {
    try {
      const { status } = await CapacitorNfc.getStatus();
      return status ?? null;
    } catch (e) {
      console.warn('[useNfcScanner] getStatus() failed:', e);
      return null;
    }
  }, []);

  // iOS: opens the per-app Settings page (UIApplication.openSettingsURLString)
  // so the user can toggle the NFC permission after a denial.
  // Android: opens Settings.ACTION_NFC_SETTINGS (falling back to wireless
  // settings) so the user can switch the adapter back on after NFC_DISABLED.
  const showSettings = useCallback(async () => {
    try {
      await CapacitorNfc.showSettings();
    } catch (e) {
      console.warn('[useNfcScanner] showSettings() failed:', e);
    }
  }, []);

  return { scan, cancel, isAvailable, showSettings, getStatus };
}
