// DEV-ONLY fixtures for the design gallery (?fixture=<mode> on localhost).
// Ids are deliberately NOT valid UUIDs so any accidental write that reaches
// Supabase is rejected by Postgres before touching real rows.
import { todayKey, getWeekDates, getTodayIndex, isoAddDays } from './utils/stats';

const FAMILY_ID = 'fx-family';

const MEMBERS = [
  { id: 'fx-willem', family_id: FAMILY_ID, name: 'Willem', avatar: 'W', color: '#C17B4E', is_kid: false, points: 5180, streak: 4, progress_visual: 'streak', onboarding_complete: true },
  { id: 'fx-christelle', family_id: FAMILY_ID, name: 'Christelle', avatar: 'C', color: '#5C7A5E', is_kid: false, points: 3240, streak: 11, progress_visual: 'streak', onboarding_complete: true },
  { id: 'fx-sofia', family_id: FAMILY_ID, name: 'Sofia', avatar: 'S', color: '#9B7EC8', is_kid: true, points: 1435, streak: 2, progress_visual: 'tree', onboarding_complete: true },
  { id: 'fx-olly', family_id: FAMILY_ID, name: 'Olly', avatar: 'O', color: '#5B8DB8', is_kid: true, points: 860, streak: 0, progress_visual: 'tree', onboarding_complete: true },
];

const HABITS = [
  { id: 'fx-h-bed', family_id: FAMILY_ID, name: 'Make your bed', icon: '🛏', category: 'Family & Chores', category_id: 'family', color: '#8B7355', location: 'Bedroom', target: 1, streak: 4, is_kid: false, tile_uid: '04A32B6F', points: 10 },
  { id: 'fx-h-meditate', family_id: FAMILY_ID, name: 'Morning meditation', icon: '🧘', category: 'Mindfulness', category_id: 'mindfulness', color: '#5A6B72', location: 'Study', target: 1, streak: 0, is_kid: false, tile_uid: '04B44C7A', points: 15 },
  { id: 'fx-h-workout', family_id: FAMILY_ID, name: 'Workout', icon: '💪', category: 'Fitness', category_id: 'fitness', color: '#5C7A5E', location: 'Office Door', target: 1, streak: 9, is_kid: false, tile_uid: '04C55D8B', points: 25 },
  { id: 'fx-h-water', family_id: FAMILY_ID, name: 'Drink a glass of water', icon: '💧', category: 'Health & Body', category_id: 'health', color: '#5C7A5E', location: 'Kitchen', target: 8, streak: 2, is_kid: false, tile_uid: null, points: 5 },
  { id: 'fx-h-pet', family_id: FAMILY_ID, name: 'Feed the pet', icon: '🐾', category: 'Family & Chores', category_id: 'family', color: '#8B7355', location: 'Kitchen', target: 1, streak: 6, is_kid: false, tile_uid: null, completion_type: 'shared', points: 10 },
  { id: 'fx-h-homework', family_id: FAMILY_ID, name: 'Homework done', icon: '📚', category: 'Kids Special', category_id: 'kids', color: '#E8854A', location: 'Desk', target: 1, streak: 2, is_kid: true, assigned_member_ids: ['fx-sofia', 'fx-olly'], points: 10 },
  // Weekday-only habit with a tile: visiting ?fixture=adult&tile=04D66E9C on a
  // weekend shows the InactiveDayModal; an unknown tile shows AssignTileModal.
  { id: 'fx-h-review', family_id: FAMILY_ID, name: 'Review daily priorities', icon: '📋', category: 'Morning Routine', category_id: 'morning', color: '#C17B4E', location: 'Desk', target: 1, streak: 0, is_kid: false, tile_uid: '04D66E9C', days_active: [0, 1, 2, 3, 4], points: 10 },
];

const REWARDS = [
  { id: 'fx-r-dinner', family_id: FAMILY_ID, name: 'Choose dinner', points: 50, icon: '🍕', who: 'Everyone', color: '#C17B4E' },
  { id: 'fx-r-movie', family_id: FAMILY_ID, name: 'Movie night pick', points: 75, icon: '🎬', who: 'Everyone', color: '#C17B4E' },
  { id: 'fx-r-screen', family_id: FAMILY_ID, name: 'Extra screen time', points: 100, icon: '📱', who: 'Kids', color: '#E8854A' },
];

// One completion row, shaped like a normalized DB row.
const comp = (habitId, memberId, date, taps) => ({
  id: `fx-c-${habitId}-${memberId}-${date}`, habitId, memberId,
  familyId: FAMILY_ID, date, taps, completedAt: null,
});

export function buildFixtures(mode = 'adult') {
  const today = todayKey();
  const week = getWeekDates();
  const todayIdx = getTodayIndex();

  // Today: bed done (Sofia), water at 3/8 (Willem), pet fed (Christelle, shared
  // → mirrored to everyone), homework done by Sofia only.
  const todayCompletions = [
    comp('fx-h-bed', 'fx-sofia', today, 1),
    comp('fx-h-water', 'fx-willem', today, 3),
    ...MEMBERS.map(m => comp('fx-h-pet', m.id, today, 1)),
    comp('fx-h-homework', 'fx-sofia', today, 1),
  ];

  // Earlier days this week: bed + workout most days, water some days.
  const weekCompletions = [...todayCompletions];
  for (let i = 0; i < todayIdx; i++) {
    const d = week[i];
    weekCompletions.push(comp('fx-h-bed', 'fx-sofia', d, 1));
    weekCompletions.push(comp('fx-h-workout', 'fx-willem', d, 1));
    weekCompletions.push(comp('fx-h-homework', 'fx-sofia', d, 1));
    if (i % 2 === 0) weekCompletions.push(comp('fx-h-water', 'fx-willem', d, 8));
    if (i !== 2) weekCompletions.push(...MEMBERS.map(m => comp('fx-h-pet', m.id, d, 1)));
  }

  // ~45 days of history so Insights streak / consistency / habit-strength render.
  const analyticsData = [];
  for (let back = 45; back >= 1; back--) {
    const d = isoAddDays(today, -back);
    if (back % 7 !== 3) {
      analyticsData.push(comp('fx-h-workout', 'fx-willem', d, 1));
      analyticsData.push(comp('fx-h-bed', 'fx-sofia', d, 1));
    }
    if (back % 3 !== 0) analyticsData.push(comp('fx-h-meditate', 'fx-christelle', d, 1));
    if (back <= 11) analyticsData.push(comp('fx-h-water', 'fx-willem', d, 8));
  }
  analyticsData.push(...weekCompletions);

  const redemptions = [
    { id: 'fx-red-1', reward_id: 'fx-r-screen', member_id: 'fx-sofia', family_id: FAMILY_ID, points_spent: 100, status: 'pending', redeemed_at: new Date().toISOString() },
  ];

  const family = {
    id: FAMILY_ID, name: 'bekker', pin: '1234',
    members: MEMBERS.map(m => ({
      id: m.id, familyId: m.family_id, name: m.name, avatar: m.avatar, color: m.color,
      isKid: m.is_kid, points: m.points, streak: m.streak,
      progressVisual: m.progress_visual, onboardingComplete: m.onboarding_complete, createdAt: null,
    })),
    habits: HABITS.map(h => ({
      id: h.id, familyId: h.family_id, name: h.name, icon: h.icon,
      category: h.category, categoryId: h.category_id, color: h.color, location: h.location,
      target: h.target || 1, streak: h.streak || 0, isKid: h.is_kid || false, isCustom: false,
      tileUid: h.tile_uid || null, isShared: true,
      assignedMemberIds: h.assigned_member_ids || null, daysActive: h.days_active || null,
      completionType: h.completion_type || 'individual', points: h.points || 10, reminderTime: null,
    })),
    rewards: REWARDS.map(r => ({
      id: r.id, familyId: r.family_id, name: r.name, points: r.points, icon: r.icon,
      who: r.who, color: r.color, assignedTo: null, status: 'active',
    })),
  };

  const memberByMode = {
    adult: 'fx-willem',
    kid: 'fx-sofia',
    'kid-almost': 'fx-sofia',
    solo: 'fx-willem',
    empty: 'fx-willem',
    loading: 'fx-willem',
  };
  const currentMember = family.members.find(m => m.id === (memberByMode[mode] || memberByMode.adult));

  if (mode === 'empty') {
    // Empty states: no habits, no rewards, no history.
    family.habits = [];
    family.rewards = [];
    return { family, currentMember, todayCompletions: [], weekCompletions: [], analyticsData: [], redemptions: [], soloMode: false };
  }

  if (mode === 'kid-almost') {
    // Sofia sees exactly two habits: bed (done) and homework (one tap away),
    // so a single hold-to-complete triggers the all-done celebration.
    family.habits = family.habits.map(h => {
      if (h.id === 'fx-h-bed' || h.id === 'fx-h-homework') return { ...h, assignedMemberIds: ['fx-sofia'] };
      return { ...h, assignedMemberIds: ['fx-willem'] };
    });
    return {
      family, currentMember,
      todayCompletions: [comp('fx-h-bed', 'fx-sofia', today, 1)],
      weekCompletions: [comp('fx-h-bed', 'fx-sofia', today, 1)],
      analyticsData, redemptions: [], soloMode: false,
    };
  }

  return {
    family, currentMember, todayCompletions, weekCompletions,
    analyticsData: mode === 'loading' ? null : analyticsData,
    redemptions,
    soloMode: mode === 'solo',
  };
}
