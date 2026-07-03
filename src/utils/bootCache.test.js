import {
  BOOT_CACHE_KEY,
  BOOT_CACHE_VERSION,
  completionKey,
  isCacheUsable,
  buildBootCache,
  mergeCompletionsPreservingProgress,
  mergeMemberPreservingProgress,
  mergeMembersPreservingProgress,
  mergeHabitsPreservingProgress,
  loadBootCache,
  saveBootCache,
  clearBootCache,
} from './bootCache';

const TODAY = '2026-07-03';
const YESTERDAY = '2026-07-02';

const comp = (over = {}) => ({
  id: 'row1', habitId: 'h1', memberId: 'm1', familyId: 'f1',
  date: TODAY, taps: 1, completedAt: null, ...over,
});

const member = (over = {}) => ({
  id: 'm1', familyId: 'f1', name: 'Isla', avatar: 'I', color: '#E8854A',
  isKid: true, points: 120, streak: 4, progressVisual: null,
  onboardingComplete: true, createdAt: '2026-01-01T00:00:00Z', ...over,
});

const habit = (over = {}) => ({
  id: 'h1', familyId: 'f1', name: 'Brush teeth', icon: '🪥', target: 1,
  streak: 6, isKid: true, daysActive: null, completionType: 'individual',
  points: 10, assignedMemberIds: ['m1'], tileUid: null, ...over,
});

const validCache = (over = {}) => ({
  version: BOOT_CACHE_VERSION,
  dateKey: TODAY,
  family: { id: 'f1', name: 'bekker', pin: '1234', members: [member()], rewards: [] },
  habits: [habit()],
  weekCompletions: [comp({ date: YESTERDAY })],
  todayCompletions: [comp()],
  ...over,
});

// ─── isCacheUsable ────────────────────────────────────────────────
describe('isCacheUsable', () => {
  test('accepts a complete same-day snapshot', () => {
    expect(isCacheUsable(validCache(), TODAY)).toBe(true);
  });

  test('rejects null / undefined / non-object', () => {
    expect(isCacheUsable(null, TODAY)).toBe(false);
    expect(isCacheUsable(undefined, TODAY)).toBe(false);
    expect(isCacheUsable('junk', TODAY)).toBe(false);
  });

  test("rejects yesterday's snapshot — stale checkmarks must never paint as today", () => {
    expect(isCacheUsable(validCache({ dateKey: YESTERDAY }), TODAY)).toBe(false);
  });

  test('rejects a version mismatch', () => {
    expect(isCacheUsable(validCache({ version: BOOT_CACHE_VERSION + 1 }), TODAY)).toBe(false);
  });

  test('rejects structurally incomplete snapshots', () => {
    expect(isCacheUsable(validCache({ family: null }), TODAY)).toBe(false);
    expect(isCacheUsable(validCache({ family: { id: null, members: [member()] } }), TODAY)).toBe(false);
    expect(isCacheUsable(validCache({ family: { id: 'f1', members: [] } }), TODAY)).toBe(false);
    expect(isCacheUsable(validCache({ habits: null }), TODAY)).toBe(false);
    expect(isCacheUsable(validCache({ weekCompletions: undefined }), TODAY)).toBe(false);
    expect(isCacheUsable(validCache({ todayCompletions: 'nope' }), TODAY)).toBe(false);
  });

  test('empty completion arrays are still usable (a true "nothing done yet" state)', () => {
    expect(isCacheUsable(validCache({ weekCompletions: [], todayCompletions: [] }), TODAY)).toBe(true);
  });
});

// ─── buildBootCache ───────────────────────────────────────────────
describe('buildBootCache', () => {
  test('snapshots state, stamps version + dateKey, strips family.habits', () => {
    const family = { id: 'f1', name: 'bekker', members: [member()], rewards: [], habits: [habit()] };
    const snap = buildBootCache({
      family, habits: [habit()], weekCompletions: [comp({ date: YESTERDAY })],
      todayCompletions: [comp()], dateKey: TODAY,
    });
    expect(snap.version).toBe(BOOT_CACHE_VERSION);
    expect(snap.dateKey).toBe(TODAY);
    expect(snap.family.habits).toBeUndefined();
    expect(snap.family.members).toHaveLength(1);
    expect(isCacheUsable(snap, TODAY)).toBe(true);
    // Round-trips through JSON (what the storage wrapper does)
    expect(isCacheUsable(JSON.parse(JSON.stringify(snap)), TODAY)).toBe(true);
  });
});

// ─── mergeCompletionsPreservingProgress ───────────────────────────
describe('mergeCompletionsPreservingProgress', () => {
  test('server-only rows are adopted (progress silently added — the nice surprise)', () => {
    const server = [comp(), comp({ id: 'row2', habitId: 'h2' })];
    const merged = mergeCompletionsPreservingProgress([comp()], server);
    expect(merged).toHaveLength(2);
    expect(merged.find(c => c.habitId === 'h2')).toBeTruthy();
  });

  test('displayed row missing from server is KEPT — a card never un-checks', () => {
    const displayed = [comp({ taps: 2 })];
    const merged = mergeCompletionsPreservingProgress(displayed, []);
    expect(merged).toEqual(displayed);
  });

  test('server lowering taps is ignored — on-screen taps never decrease', () => {
    const displayed = [comp({ taps: 3 })];
    const server = [comp({ taps: 1, id: 'server-row' })];
    const merged = mergeCompletionsPreservingProgress(displayed, server);
    expect(merged).toHaveLength(1);
    expect(merged[0].taps).toBe(3);
    // but server metadata (real row id) is adopted
    expect(merged[0].id).toBe('server-row');
  });

  test('server raising taps is adopted', () => {
    const merged = mergeCompletionsPreservingProgress([comp({ taps: 1 })], [comp({ taps: 4 })]);
    expect(merged[0].taps).toBe(4);
  });

  test('equal taps: server row wins (real id / completedAt replace optimistic ones)', () => {
    const displayed = [comp({ id: 'opt_123', taps: 2 })];
    const server = [comp({ id: 'uuid-real', taps: 2, completedAt: '2026-07-03T08:00:00Z' })];
    const merged = mergeCompletionsPreservingProgress(displayed, server);
    expect(merged[0].id).toBe('uuid-real');
    expect(merged[0].completedAt).toBe('2026-07-03T08:00:00Z');
  });

  test('a locally-touched row beats the server even at lower taps (undo made after fetch started must stick)', () => {
    const undone = comp({ taps: 0 });
    const server = [comp({ taps: 2 })];
    const touched = new Set([completionKey(undone)]);
    const merged = mergeCompletionsPreservingProgress([undone], server, touched);
    expect(merged).toHaveLength(1);
    expect(merged[0].taps).toBe(0);
  });

  test('a locally-touched displayed-only taps=0 row is kept (undo of an optimistic completion)', () => {
    const undone = comp({ id: 'opt_9', taps: 0 });
    const touched = new Set([completionKey(undone)]);
    const merged = mergeCompletionsPreservingProgress([undone], [], touched);
    expect(merged).toHaveLength(1);
    expect(merged[0].taps).toBe(0);
  });

  test('an untouched displayed-only taps=0 row is dropped (stale undo residue, no visible state)', () => {
    const merged = mergeCompletionsPreservingProgress([comp({ taps: 0 })], []);
    expect(merged).toHaveLength(0);
  });

  test('rows merge by (habit, member, date) — same habit for two members stays two rows', () => {
    const displayed = [comp({ memberId: 'm1', taps: 2 }), comp({ memberId: 'm2', taps: 1, id: 'row2' })];
    const server = [comp({ memberId: 'm1', taps: 1 })];
    const merged = mergeCompletionsPreservingProgress(displayed, server);
    expect(merged).toHaveLength(2);
    expect(merged.find(c => c.memberId === 'm1').taps).toBe(2);
    expect(merged.find(c => c.memberId === 'm2').taps).toBe(1);
  });

  test('same habit+member on different dates are independent rows (week merge)', () => {
    const displayed = [comp({ date: YESTERDAY, taps: 1 })];
    const server = [comp({ date: TODAY, taps: 1, id: 'row-today' })];
    const merged = mergeCompletionsPreservingProgress(displayed, server);
    expect(merged).toHaveLength(2);
  });

  test('handles null/undefined inputs', () => {
    expect(mergeCompletionsPreservingProgress(null, null)).toEqual([]);
    expect(mergeCompletionsPreservingProgress(undefined, [comp()])).toHaveLength(1);
    expect(mergeCompletionsPreservingProgress([comp()], undefined)).toHaveLength(1);
  });
});

// ─── member merges ────────────────────────────────────────────────
describe('mergeMemberPreservingProgress', () => {
  test('points and streak never go down; structure comes from server', () => {
    const displayed = member({ points: 150, streak: 5, name: 'Isla' });
    const server = member({ points: 130, streak: 3, name: 'Isla Rose', avatar: 'IR' });
    const merged = mergeMemberPreservingProgress(displayed, server);
    expect(merged.points).toBe(150);
    expect(merged.streak).toBe(5);
    expect(merged.name).toBe('Isla Rose'); // structural edit from another device applies
    expect(merged.avatar).toBe('IR');
  });

  test('server raising points/streak is adopted', () => {
    const merged = mergeMemberPreservingProgress(member({ points: 100, streak: 2 }), member({ points: 140, streak: 6 }));
    expect(merged.points).toBe(140);
    expect(merged.streak).toBe(6);
  });

  test('touched member keeps displayed numbers even when lower (local undo deducted points after fetch started)', () => {
    const merged = mergeMemberPreservingProgress(member({ points: 90, streak: 0 }), member({ points: 100, streak: 4 }), true);
    expect(merged.points).toBe(90);
    expect(merged.streak).toBe(0);
  });

  test('missing sides fall through to whichever exists', () => {
    const s = member();
    expect(mergeMemberPreservingProgress(null, s)).toBe(s);
    const d = member();
    expect(mergeMemberPreservingProgress(d, null)).toBe(d);
  });
});

describe('mergeMembersPreservingProgress', () => {
  test('server owns membership: remote adds appear, remote removals apply', () => {
    const displayed = [member(), member({ id: 'm2', name: 'Theo', points: 40 })];
    const server = [member(), member({ id: 'm3', name: 'New kid', points: 0 })];
    const merged = mergeMembersPreservingProgress(displayed, server);
    expect(merged.map(m => m.id)).toEqual(['m1', 'm3']);
  });

  test('per-member numbers are progress-preserved, touched ids win', () => {
    const displayed = [member({ points: 200 }), member({ id: 'm2', points: 50, streak: 1 })];
    const server = [member({ points: 180 }), member({ id: 'm2', points: 60, streak: 2 })];
    const merged = mergeMembersPreservingProgress(displayed, server, new Set(['m2']));
    expect(merged.find(m => m.id === 'm1').points).toBe(200); // max
    expect(merged.find(m => m.id === 'm2').points).toBe(50);  // touched → displayed wins
  });
});

// ─── habit merges ─────────────────────────────────────────────────
describe('mergeHabitsPreservingProgress', () => {
  test('server owns the habit list and fields; displayed streak never shrinks', () => {
    const displayed = [habit({ streak: 8, name: 'Old name' })];
    const server = [habit({ streak: 5, name: 'New name' }), habit({ id: 'h2', name: 'Read', streak: 0 })];
    const merged = mergeHabitsPreservingProgress(displayed, server);
    expect(merged).toHaveLength(2);
    expect(merged[0].streak).toBe(8);
    expect(merged[0].name).toBe('New name');
  });

  test('server raising a streak is adopted; remote habit deletion applies', () => {
    const displayed = [habit({ streak: 2 }), habit({ id: 'h2', streak: 9 })];
    const server = [habit({ streak: 7 })];
    const merged = mergeHabitsPreservingProgress(displayed, server);
    expect(merged).toHaveLength(1);
    expect(merged[0].streak).toBe(7);
  });
});

// ─── storage wrappers ─────────────────────────────────────────────
describe('storage wrappers', () => {
  const makeStorage = () => {
    const map = new Map();
    return {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: k => map.delete(k),
    };
  };

  test('save → load round-trips a usable snapshot', () => {
    const storage = makeStorage();
    saveBootCache(storage, validCache());
    const loaded = loadBootCache(storage);
    expect(isCacheUsable(loaded, TODAY)).toBe(true);
    expect(loaded.family.id).toBe('f1');
  });

  test('load returns null on missing or corrupt JSON', () => {
    const storage = makeStorage();
    expect(loadBootCache(storage)).toBeNull();
    storage.setItem(BOOT_CACHE_KEY, '{not json');
    expect(loadBootCache(storage)).toBeNull();
  });

  test('clear removes the snapshot; storage exceptions never throw', () => {
    const storage = makeStorage();
    saveBootCache(storage, validCache());
    clearBootCache(storage);
    expect(loadBootCache(storage)).toBeNull();

    const broken = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => { throw new Error('SecurityError'); },
    };
    expect(loadBootCache(broken)).toBeNull();
    expect(() => saveBootCache(broken, validCache())).not.toThrow();
    expect(() => clearBootCache(broken)).not.toThrow();
  });
});
