// ─── BOOT CACHE ───────────────────────────────────────────────────
// Instant-launch cache: the last session's full app state, persisted to
// localStorage so the next launch can paint a COMPLETE, TRUE first frame
// (habits with their real checkmarks, real points, real tree height) while
// the server is revalidated in the background.
//
// The one inviolable product rule this module exists to uphold: the app must
// never show a child's progress as less than it truly is — not even for a
// frame. That drives two hard constraints:
//
//   1. The cache is only usable for the SAME Melbourne calendar day it was
//      written. Yesterday's checkmarks rendered as "today" would overstate
//      progress and then have to be visually yanked away — so a stale-date
//      cache is treated as no cache at all (cold boot behind the loading
//      screen, which is always safe).
//
//   2. When server data arrives, it is merged, never blindly applied.
//      Progress may silently INCREASE (a completion from another device
//      appearing is a nice surprise) but on-screen progress is never
//      lowered: no card un-checks, no points drop, no streak shrinks, no
//      tree gets shorter mid-session.
//
// All functions here are pure except the three thin storage wrappers at the
// bottom; everything pure is unit-tested in bootCache.test.js.

export const BOOT_CACHE_KEY = 'ritual_bootCache_v1';
export const BOOT_CACHE_VERSION = 1;

// Identity of a completion row — completions are unique per
// (habit_id, member_id, date) in the DB, so this is the merge key.
export function completionKey(c) {
  return `${c.habitId}|${c.memberId}|${c.date}`;
}

// A cache snapshot is usable only if it is structurally complete, the right
// version, for the same family shape we expect, AND written today (Melbourne).
export function isCacheUsable(cache, todayStr) {
  return !!(
    cache &&
    cache.version === BOOT_CACHE_VERSION &&
    typeof cache.dateKey === 'string' &&
    cache.dateKey === todayStr &&
    cache.family && cache.family.id &&
    Array.isArray(cache.family.members) && cache.family.members.length > 0 &&
    Array.isArray(cache.habits) &&
    Array.isArray(cache.weekCompletions) &&
    Array.isArray(cache.todayCompletions)
  );
}

// Snapshot the live app state into a serializable cache object.
// family.habits is stripped — the live `habits` state is the source of truth
// and nothing reads family.habits, so caching it would only risk divergence.
export function buildBootCache({ family, habits, weekCompletions, todayCompletions, dateKey }) {
  const { habits: _omit, ...slimFamily } = family || {};
  return {
    version: BOOT_CACHE_VERSION,
    dateKey,
    family: slimFamily,
    habits: habits || [],
    weekCompletions: weekCompletions || [],
    todayCompletions: todayCompletions || [],
  };
}

// ─── Progress-preserving merges ───────────────────────────────────
// `displayed` is what is currently on screen (cached state plus any local
// optimistic updates made since first paint). `server` is the freshly
// fetched truth. `touchedKeys` marks rows the user modified locally AFTER
// the server fetch started — those local values are newer than the server
// snapshot and win outright (this is what lets a local undo stick instead
// of being "helpfully" re-completed by a stale fetch).

export function mergeCompletionsPreservingProgress(displayed, server, touchedKeys = new Set()) {
  const displayedByKey = new Map((displayed || []).map(c => [completionKey(c), c]));
  const serverKeys = new Set();
  const result = (server || []).map(s => {
    const key = completionKey(s);
    serverKeys.add(key);
    const d = displayedByKey.get(key);
    if (!d) return s;
    if (touchedKeys.has(key)) return d;         // local change is newer than the fetch
    if ((d.taps || 0) > (s.taps || 0)) return { ...s, taps: d.taps }; // never lower on-screen taps
    return s;                                    // server adds progress (or matches) — adopt, real id wins
  });
  // Rows on screen that the server doesn't have at all: keep any that show
  // progress (taps > 0) — removing them would un-check a card in front of
  // the child. Dropped taps=0 rows carry no visible state.
  for (const [key, d] of displayedByKey) {
    if (serverKeys.has(key)) continue;
    if (touchedKeys.has(key) || (d.taps || 0) > 0) result.push(d);
  }
  return result;
}

// Merge one member: server owns identity/structure (name, avatar, color,
// isKid, onboarding), but the achievement numbers on screen never go down.
// `touched` = this member's points/streak were changed locally after the
// fetch started (e.g. an undo legitimately lowered them) — displayed wins.
export function mergeMemberPreservingProgress(displayedMember, serverMember, touched = false) {
  if (!displayedMember) return serverMember;
  if (!serverMember) return displayedMember;
  if (touched) {
    return { ...serverMember, points: displayedMember.points, streak: displayedMember.streak };
  }
  return {
    ...serverMember,
    points: Math.max(displayedMember.points || 0, serverMember.points || 0),
    streak: Math.max(displayedMember.streak || 0, serverMember.streak || 0),
  };
}

// Merge the member list: server owns membership and order (members added or
// removed on another device take effect), per-member numbers merge as above.
export function mergeMembersPreservingProgress(displayed, server, touchedMemberIds = new Set()) {
  const displayedById = new Map((displayed || []).map(m => [m.id, m]));
  return (server || []).map(s =>
    mergeMemberPreservingProgress(displayedById.get(s.id), s, touchedMemberIds.has(s.id))
  );
}

// Merge habits: server owns the habit list and every field except the streak
// cache, which never shrinks on screen mid-session. (Habit taps live in
// todayCompletions, not on the habit, so completion merges cover them.)
export function mergeHabitsPreservingProgress(displayed, server) {
  const displayedById = new Map((displayed || []).map(h => [h.id, h]));
  return (server || []).map(s => {
    const d = displayedById.get(s.id);
    if (!d) return s;
    return { ...s, streak: Math.max(d.streak || 0, s.streak || 0) };
  });
}

// ─── Storage wrappers (thin, defensive) ───────────────────────────
// localStorage is synchronous — that's the whole point: the cache must be
// readable before the first render, with zero awaits. Failures (quota,
// privacy mode, corrupt JSON) all degrade to "no cache" = safe cold boot.

export function loadBootCache(storage) {
  try {
    const raw = storage.getItem(BOOT_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveBootCache(storage, snapshot) {
  try {
    storage.setItem(BOOT_CACHE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    // Quota/serialization failure — worst case is a cold boot next launch.
  }
}

export function clearBootCache(storage) {
  try {
    storage.removeItem(BOOT_CACHE_KEY);
  } catch (e) { /* already gone / storage unavailable */ }
}
