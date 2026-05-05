import { useCallback, useEffect, useRef, useState } from 'react';
import { CapacitorNfc } from '@capgo/capacitor-nfc';

// NFC Forum URI Record Type Definition (RTD-URI 1.0) prefix table.
// First byte of a URI record's payload is an index into this table; the
// remainder of the payload is the rest of the URI as UTF-8 bytes.
// Codes 0x24–0xFF are reserved by the spec — treated as no-prefix.
const NDEF_URI_PREFIXES = [
  '',                              // 0x00
  'http://www.',                   // 0x01
  'https://www.',                  // 0x02
  'http://',                       // 0x03
  'https://',                      // 0x04
  'tel:',                          // 0x05
  'mailto:',                       // 0x06
  'ftp://anonymous:anonymous@',    // 0x07
  'ftp://ftp.',                    // 0x08
  'ftps://',                       // 0x09
  'sftp://',                       // 0x0A
  'smb://',                        // 0x0B
  'nfs://',                        // 0x0C
  'ftp://',                        // 0x0D
  'dav://',                        // 0x0E
  'news:',                         // 0x0F
  'telnet://',                     // 0x10
  'imap:',                         // 0x11
  'rtsp://',                       // 0x12
  'urn:',                          // 0x13
  'pop:',                          // 0x14
  'sip:',                          // 0x15
  'sips:',                         // 0x16
  'tftp:',                         // 0x17
  'btspp://',                      // 0x18
  'btl2cap://',                    // 0x19
  'btgoep://',                     // 0x1A
  'tcpobex://',                    // 0x1B
  'irdaobex://',                   // 0x1C
  'file://',                       // 0x1D
  'urn:epc:id:',                   // 0x1E
  'urn:epc:tag:',                  // 0x1F
  'urn:epc:pat:',                  // 0x20
  'urn:epc:raw:',                  // 0x21
  'urn:epc:',                      // 0x22
  'urn:nfc:',                      // 0x23
];

// Decode a single NDEF record into a URI string, or null if the record
// is not a NFC Forum well-known URI record (TNF=1, type='U' / 0x55).
function decodeUriRecord(record) {
  if (!record || record.tnf !== 1) return null;
  if (!Array.isArray(record.type) || record.type.length !== 1 || record.type[0] !== 0x55) return null;
  if (!Array.isArray(record.payload) || record.payload.length < 1) return null;
  const prefix = NDEF_URI_PREFIXES[record.payload[0]] ?? '';
  try {
    const rest = new TextDecoder('utf-8').decode(new Uint8Array(record.payload.slice(1)));
    return prefix + rest;
  } catch {
    return null;
  }
}

// Walk a tag's NDEF message and return the first URI record's URL, or null
// if no URI record is present. Production tiles have a single URI record;
// this iteration is defensive against mixed-record tiles or non-Ritual tags.
function extractUrlFromTag(tag) {
  const records = tag?.ndefMessage;
  if (!Array.isArray(records)) return null;
  for (const record of records) {
    const url = decodeUriRecord(record);
    if (url) return url;
  }
  return null;
}

// Hook wrapping @capgo/capacitor-nfc's NDEF reader session.
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
// LIMITATION (intentional): on the iOS NDEF session path, the plugin emits
// a single 'nfcStateChange' event for cancel, timeout, and most errors with
// the same payload — the underlying NFCReaderError code is not propagated
// to JS. We therefore cannot distinguish these outcomes here and collapse
// them all to null. The user still sees iOS's own per-case sheet UI
// (Cancel button, red error sheet, etc.) so feedback is not lost. If the
// product ever needs cancel-vs-timeout-vs-error in JS, switch to
// iosSessionType: 'tag' and add the TAG entitlement (see spike §2 / build
// plan §A.4 — currently NDEF-only).
export function useNfcScanner() {
  const [supported, setSupported] = useState(false);
  const scanningRef = useRef(false);
  // Holds the in-flight scan's cleanup fn so unmount mid-scan can release listeners.
  const cleanupRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { supported: s } = await CapacitorNfc.isSupported();
        if (!cancelled) setSupported(s);
      } catch (e) {
        console.warn('[useNfcScanner] isSupported() check failed:', e);
      }
    })();
    return () => {
      cancelled = true;
      // If the component unmounts mid-scan, release listeners.
      // (cleanup is async — fire-and-forget; listeners drop on next tick.)
      cleanupRef.current?.();
    };
  }, []);

  const scan = useCallback(async () => {
    if (scanningRef.current) {
      console.warn('[useNfcScanner] scan() called while another scan is in progress — ignoring concurrent call');
      return null;
    }
    scanningRef.current = true;

    let resolveScan;
    const scanPromise = new Promise((resolve) => { resolveScan = resolve; });

    let eventListener = null;
    let stateListener = null;
    const cleanup = async () => {
      try { await eventListener?.remove(); } catch {}
      try { await stateListener?.remove(); } catch {}
      scanningRef.current = false;
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;

    try {
      eventListener = await CapacitorNfc.addListener('nfcEvent', async (event) => {
        const url = extractUrlFromTag(event?.tag);
        if (url) {
          // invalidateAfterFirstRead: true has been observed not to dismiss
          // the iOS reader sheet reliably; explicit stop forces invalidation.
          try { await CapacitorNfc.stopScanning(); } catch {}
        }
        resolveScan(url);
      });
      stateListener = await CapacitorNfc.addListener('nfcStateChange', () => {
        // Session invalidated — see LIMITATION note above. Cancel, timeout,
        // and most errors all arrive here as the same opaque event.
        resolveScan(null);
      });

      await CapacitorNfc.startScanning({
        iosSessionType: 'ndef',
        invalidateAfterFirstRead: true,
        alertMessage: 'Hold your iPhone near a Ritual tile',
      });

      return await scanPromise;
    } finally {
      await cleanup();
    }
  }, []);

  const isAvailable = useCallback(() => supported, [supported]);

  return { scan, isAvailable };
}
