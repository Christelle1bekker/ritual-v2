// Tests for the Android additions to the scan lifecycle: cancel() and the
// per-scan watchdog override. Kept in a sibling file so nfcScanLifecycle.test.js
// — the iOS behaviour contract — stays byte-for-byte untouched, which is the
// cheapest proof that none of this changed iOS.
//
// Why these two exist at all: Android's startScanning() is
// NfcAdapter.enableReaderMode. It resolves immediately, draws no system sheet,
// offers no Cancel, and never times out — so unlike iOS there is no OS-owned
// way for a user to end a session, and no 60s ceiling for the watchdog to sit
// behind. cancel() is the way out; the shortened watchdog is the session
// length. iOS passes neither and must behave exactly as before.
import { createScanLifecycle, SETTLE_MS, WATCHDOG_MS } from './nfcScanLifecycle';

// Same deterministic clock/scheduler as nfcScanLifecycle.test.js: advance()
// fires due timers in order and yields to the microtask queue between each so
// promise chains settle like they would between real timer ticks.
function makeClock() {
  let t = 1_000_000;
  let nextId = 1;
  let timers = [];
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    now: () => t,
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: t + ms, fn });
      return id;
    },
    cancel: (id) => { timers = timers.filter((x) => x.id !== id); },
    pending: () => timers.length,
    flush,
    async advance(ms) {
      const target = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        t = due.at;
        due.fn();
        await flush();
      }
      t = target;
      await flush();
    },
  };
}

// A URI record for https://x.app/t/AB — what a real tile read delivers.
const TILE_EVENT = {
  tag: {
    ndefMessage: [{
      tnf: 1,
      type: [0x55],
      payload: [0x04, ...Array.from(new TextEncoder().encode('x.app/t/AB'))],
    }],
  },
};
const TILE_URL = 'https://x.app/t/AB';

// The Android scan window the hook passes (useNfcScanner: ANDROID_SCAN_WINDOW_MS).
const ANDROID_WATCHDOG_MS = 30000;

function makeNfc() {
  return {
    startScanning: jest.fn().mockResolvedValue(undefined),
    stopScanning: jest.fn().mockResolvedValue(undefined),
  };
}

function makeLifecycle(overrides = {}) {
  const clock = makeClock();
  const nfc = makeNfc();
  const warn = jest.fn();
  const lifecycle = createScanLifecycle(nfc, {
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    warn,
    ...overrides,
  });
  return { clock, nfc, warn, lifecycle };
}

// Tracks settlement without awaiting, so "still pending" is assertable.
function track(promise) {
  const state = { settled: false, value: undefined };
  promise.then((v) => { state.settled = true; state.value = v; });
  return state;
}

describe('nfcScanLifecycle — cancel() (Android in-app scan overlay)', () => {
  test('cancel() resolves the in-flight scan with null and stops the session', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledTimes(1);

    lifecycle.cancel();
    await expect(scanP).resolves.toBeNull();
    // disableReaderMode must actually happen — otherwise the radio stays armed
    // behind a dismissed overlay and the next tile tap resolves a dead scan.
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);
  });

  test('cancel() with no scan in flight is a no-op — no stopScanning, no throw', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    await expect(lifecycle.cancel()).resolves.toBeUndefined();
    await clock.flush();
    expect(nfc.stopScanning).not.toHaveBeenCalled();
    expect(nfc.startScanning).not.toHaveBeenCalled();

    // And the lifecycle is still usable afterwards
    const scanP = lifecycle.scan({});
    await clock.flush();
    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(scanP).resolves.toBe(TILE_URL);
  });

  test('cancel() stamps the settle clock — the next scan waits out SETTLE_MS', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const first = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    lifecycle.cancel();
    await expect(first).resolves.toBeNull();

    const second = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledTimes(1); // still settling

    await clock.advance(SETTLE_MS - 1);
    expect(nfc.startScanning).toHaveBeenCalledTimes(1);

    await clock.advance(1);
    expect(nfc.startScanning).toHaveBeenCalledTimes(2);

    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(second).resolves.toBe(TILE_URL);
  });

  test('cancel() releases the single-flight guard and cancels the watchdog', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const first = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    lifecycle.cancel();
    await expect(first).resolves.toBeNull();
    expect(clock.pending()).toBe(0); // no watchdog left ticking

    // Long past the cancelled scan's watchdog moment: it must not fire and
    // stop a session that a later scan owns.
    await clock.advance(SETTLE_MS);
    const second = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledTimes(2);
    await clock.advance(ANDROID_WATCHDOG_MS - SETTLE_MS - 1);
    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(second).resolves.toBe(TILE_URL);
    expect(nfc.stopScanning).toHaveBeenCalledTimes(2); // cancel + read, nothing stray
  });
});

describe('nfcScanLifecycle — cancel() double-resolve safety', () => {
  test('double cancel() resolves once and stops the session once', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();

    lifecycle.cancel();
    lifecycle.cancel(); // e.g. a double-tap on the overlay's Cancel button
    await expect(scanP).resolves.toBeNull();
    await clock.flush();
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);
  });

  test('cancel() after a tag read resolved the scan does not stop the NEXT session', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const first = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(first).resolves.toBe(TILE_URL);
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1); // the read's own stop

    // Overlay Cancel racing the read that already won
    lifecycle.cancel();
    await clock.flush();
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);

    // A later scan is unaffected by that stray cancel
    await clock.advance(SETTLE_MS);
    const second = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledTimes(2);
    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(second).resolves.toBe(TILE_URL);
  });

  test('cancel() racing a watchdog force-resolve settles the scan exactly once', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    const state = track(scanP);
    await clock.flush();

    lifecycle.cancel();
    await clock.flush();
    expect(state.settled).toBe(true);
    expect(state.value).toBeNull();

    // The watchdog moment passes with the scan already gone — no second stop
    await clock.advance(ANDROID_WATCHDOG_MS * 2);
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);
    await expect(scanP).resolves.toBeNull();
  });
});

describe('nfcScanLifecycle — per-scan watchdog override', () => {
  test('a custom watchdogMs is honoured: fires at the custom deadline, not WATCHDOG_MS', async () => {
    const { clock, nfc, warn, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    const state = track(scanP);
    await clock.flush();

    await clock.advance(ANDROID_WATCHDOG_MS - 1);
    expect(state.settled).toBe(false);

    await clock.advance(1);
    await expect(scanP).resolves.toBeNull();
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  test('the custom deadline is genuinely shorter — the default would still be pending there', async () => {
    const { clock, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({}); // no session options ⇒ iOS path
    const state = track(scanP);
    await clock.flush();

    await clock.advance(ANDROID_WATCHDOG_MS);
    expect(state.settled).toBe(false); // 30s is inside the 65s default window

    await clock.advance(WATCHDOG_MS - ANDROID_WATCHDOG_MS);
    await expect(scanP).resolves.toBeNull();
  });

  test('omitting session options leaves the default watchdog path unchanged (iOS)', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({});
    const state = track(scanP);
    await clock.flush();

    await clock.advance(WATCHDOG_MS - 1);
    expect(state.settled).toBe(false);
    expect(nfc.stopScanning).not.toHaveBeenCalled();

    await clock.advance(1);
    await expect(scanP).resolves.toBeNull();
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);
  });

  test('an empty session-options object also falls back to the default watchdog', async () => {
    const { clock, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({}, {});
    const state = track(scanP);
    await clock.flush();

    await clock.advance(WATCHDOG_MS - 1);
    expect(state.settled).toBe(false);
    await clock.advance(1);
    await expect(scanP).resolves.toBeNull();
  });

  test('a custom watchdog does not change the settle, event or single-flight paths', async () => {
    const { clock, nfc, warn, lifecycle } = makeLifecycle();
    const opts = { iosSessionType: 'ndef' };
    const first = lifecycle.scan(opts, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledWith(opts); // startOptions untouched

    // Single-flight still rejects a concurrent call
    await expect(lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS })).resolves.toBeNull();
    expect(nfc.startScanning).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    // Tag read still resolves with the URL and stops the session
    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(first).resolves.toBe(TILE_URL);
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);

    // Settle delay still applies afterwards
    const second = lifecycle.scan({}, { watchdogMs: ANDROID_WATCHDOG_MS });
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledTimes(1);
    await clock.advance(SETTLE_MS);
    expect(nfc.startScanning).toHaveBeenCalledTimes(2);
    lifecycle.onStateChange(); // adapter switched off mid-scan, on Android
    await expect(second).resolves.toBeNull();
  });
});
