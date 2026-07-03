import { createScanLifecycle, SETTLE_MS } from './nfcScanLifecycle';

// Deterministic clock + scheduler so settle timing is provable without
// wall-clock sleeps. advance() fires due timers in order and yields to the
// microtask queue between each so promise chains settle like they would
// between real timer ticks.
function makeClock() {
  // Start well past epoch so the first scan isn't inside the settle window
  // (production Date.now() is always ≫ the initial lastSessionEndedAt of 0).
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
    warn,
    ...overrides,
  });
  return { clock, nfc, warn, lifecycle };
}

describe('nfcScanLifecycle — session outcomes', () => {
  test('successful read: resolves the tag URL and stops the session to dismiss the sheet', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const opts = { iosSessionType: 'ndef' };
    const scanP = lifecycle.scan(opts);
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledWith(opts);

    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(scanP).resolves.toBe(TILE_URL);
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);
  });

  test('non-URI tag read: resolves null but still dismisses the session', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({});
    await clock.flush();

    lifecycle.onNfcEvent({ tag: { id: [1, 2, 3] } });
    await expect(scanP).resolves.toBeNull();
    expect(nfc.stopScanning).toHaveBeenCalledTimes(1);
  });

  test('cancel/timeout/error (opaque nfcStateChange): resolves null without stopScanning', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({});
    await clock.flush();

    lifecycle.onStateChange();
    await expect(scanP).resolves.toBeNull();
    expect(nfc.stopScanning).not.toHaveBeenCalled();
  });

  test('startScanning rejection propagates to the caller (hard failure before session begins)', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    nfc.startScanning.mockRejectedValue(new Error('NFC is not available on this device.'));
    const scanP = lifecycle.scan({});
    scanP.catch(() => {}); // observed below; avoid unhandled-rejection noise
    await clock.flush();
    await expect(scanP).rejects.toThrow('NFC is not available');
  });
});

describe('nfcScanLifecycle — double-resolve protection', () => {
  test('nfcEvent then nfcStateChange resolves once, with the URL', async () => {
    const { clock, lifecycle } = makeLifecycle();
    const scanP = lifecycle.scan({});
    await clock.flush();

    lifecycle.onNfcEvent(TILE_EVENT);
    lifecycle.onStateChange(); // e.g. invalidation event from our own stopScanning
    await expect(scanP).resolves.toBe(TILE_URL);
  });

  test('retained/stray events with no scan in flight are ignored and do not poison the next scan', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    // Stray events (Capgo retains events with retainUntilConsumed:true)
    lifecycle.onStateChange();
    lifecycle.onNfcEvent(TILE_EVENT);
    await clock.flush();
    expect(nfc.stopScanning).not.toHaveBeenCalled();

    // A following scan still works normally
    await clock.advance(SETTLE_MS);
    const scanP = lifecycle.scan({});
    await clock.flush();
    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(scanP).resolves.toBe(TILE_URL);
  });
});

describe('nfcScanLifecycle — single-flight guard', () => {
  test('concurrent scan() is ignored: resolves null, no second session start', async () => {
    const { clock, nfc, warn, lifecycle } = makeLifecycle();
    const first = lifecycle.scan({});
    await clock.flush();
    const second = lifecycle.scan({});
    await expect(second).resolves.toBeNull();
    expect(nfc.startScanning).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    // First scan is unaffected
    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(first).resolves.toBe(TILE_URL);
  });
});

describe('nfcScanLifecycle — settle delay (invalidation-then-cooldown before re-arm)', () => {
  test('second scan waits out the settle window after a successful read', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const first = lifecycle.scan({});
    await clock.flush();
    lifecycle.onNfcEvent(TILE_EVENT);
    await first;

    // Re-arm immediately: startScanning must NOT fire until SETTLE_MS passed
    const second = lifecycle.scan({});
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledTimes(1);

    await clock.advance(SETTLE_MS - 1);
    expect(nfc.startScanning).toHaveBeenCalledTimes(1);

    await clock.advance(1);
    expect(nfc.startScanning).toHaveBeenCalledTimes(2);

    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(second).resolves.toBe(TILE_URL);
  });

  test('second scan waits out the settle window after cancel/timeout/error', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const first = lifecycle.scan({});
    await clock.flush();
    lifecycle.onStateChange();
    await first;

    const second = lifecycle.scan({});
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledTimes(1);
    await clock.advance(SETTLE_MS);
    expect(nfc.startScanning).toHaveBeenCalledTimes(2);
    lifecycle.onStateChange();
    await expect(second).resolves.toBeNull();
  });

  test('no settle wait when enough time has already passed', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const first = lifecycle.scan({});
    await clock.flush();
    lifecycle.onNfcEvent(TILE_EVENT);
    await first;

    await clock.advance(SETTLE_MS + 500);
    const second = lifecycle.scan({});
    await clock.flush();
    expect(nfc.startScanning).toHaveBeenCalledTimes(2);
    lifecycle.onNfcEvent(TILE_EVENT);
    await second;
  });

  test('events arriving during the settle wait (retained replays) are ignored — the slot is not armed yet', async () => {
    const { clock, nfc, lifecycle } = makeLifecycle();
    const first = lifecycle.scan({});
    await clock.flush();
    lifecycle.onStateChange();
    await first;

    const second = lifecycle.scan({});
    await clock.flush();
    // Retained replay lands mid-settle: must not resolve the pending scan
    lifecycle.onStateChange();
    await clock.advance(SETTLE_MS);
    expect(nfc.startScanning).toHaveBeenCalledTimes(2); // still armed and started
    lifecycle.onNfcEvent(TILE_EVENT);
    await expect(second).resolves.toBe(TILE_URL);
  });
});
