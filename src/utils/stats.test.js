import {
  todayKey, getYesterdayKey, getTodayIndex, getWeekDates, isoAddDays, mondayKeyOf,
  calcStreakFromDates, lastScheduledDayBefore, uniqueCompletionDays, dedupeByHabitDay,
} from './stats';

// 2026-07-03 is a Friday; 2026-06-29 is the Monday of that week.

describe('isoAddDays', () => {
  it('adds and subtracts days within a month', () => {
    expect(isoAddDays('2026-07-03', 1)).toBe('2026-07-04');
    expect(isoAddDays('2026-07-03', -1)).toBe('2026-07-02');
  });
  it('crosses month boundaries', () => {
    expect(isoAddDays('2026-07-01', -1)).toBe('2026-06-30');
    expect(isoAddDays('2026-06-30', 1)).toBe('2026-07-01');
  });
  it('crosses year boundaries', () => {
    expect(isoAddDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(isoAddDays('2025-12-31', 1)).toBe('2026-01-01');
  });
  it('handles leap years', () => {
    expect(isoAddDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(isoAddDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(isoAddDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('handles offsets larger than a month', () => {
    expect(isoAddDays('2026-07-03', -120)).toBe('2026-03-05');
  });
});

describe('todayKey', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getYesterdayKey', () => {
  it('is exactly one calendar day before the given today', () => {
    expect(getYesterdayKey('2026-07-03')).toBe('2026-07-02');
    expect(getYesterdayKey('2026-07-01')).toBe('2026-06-30');
    expect(getYesterdayKey('2026-01-01')).toBe('2025-12-31');
  });
  it('defaults to Melbourne today and agrees with isoAddDays', () => {
    expect(getYesterdayKey()).toBe(isoAddDays(todayKey(), -1));
  });
});

describe('getTodayIndex', () => {
  it('maps Monday to 0 and Sunday to 6', () => {
    expect(getTodayIndex('2026-06-29')).toBe(0); // Monday
    expect(getTodayIndex('2026-07-03')).toBe(4); // Friday
    expect(getTodayIndex('2026-07-05')).toBe(6); // Sunday
  });
});

describe('getWeekDates', () => {
  it('returns Monday..Sunday of the current week', () => {
    expect(getWeekDates('2026-07-03')).toEqual([
      '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02',
      '2026-07-03', '2026-07-04', '2026-07-05',
    ]);
  });
  it('treats Sunday as the last day of the week (not the first)', () => {
    expect(getWeekDates('2026-07-05')[0]).toBe('2026-06-29');
    expect(getWeekDates('2026-07-05')[6]).toBe('2026-07-05');
  });
  it('handles a week spanning a month boundary', () => {
    expect(getWeekDates('2026-08-01')).toEqual([
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
      '2026-07-31', '2026-08-01', '2026-08-02',
    ]);
  });
});

describe('mondayKeyOf', () => {
  it('returns the Monday of the containing week', () => {
    expect(mondayKeyOf('2026-07-03')).toBe('2026-06-29'); // Friday
    expect(mondayKeyOf('2026-07-05')).toBe('2026-06-29'); // Sunday belongs to prior Monday
    expect(mondayKeyOf('2026-06-29')).toBe('2026-06-29'); // Monday maps to itself
  });
  it('crosses month boundaries', () => {
    expect(mondayKeyOf('2026-07-01')).toBe('2026-06-29');
  });
  it('agrees with getWeekDates for the current week', () => {
    expect(mondayKeyOf('2026-07-03')).toBe(getWeekDates('2026-07-03')[0]);
  });
});

describe('calcStreakFromDates', () => {
  const TODAY = '2026-07-03';

  it('returns 0 for no completions', () => {
    expect(calcStreakFromDates([], TODAY)).toBe(0);
  });
  it('returns 1 for a completion today only', () => {
    expect(calcStreakFromDates(['2026-07-03'], TODAY)).toBe(1);
  });
  it('treats today as in-progress: yesterday-only still counts', () => {
    expect(calcStreakFromDates(['2026-07-02'], TODAY)).toBe(1);
  });
  it('returns 0 when the last completion was 2+ days ago', () => {
    expect(calcStreakFromDates(['2026-07-01'], TODAY)).toBe(0);
    expect(calcStreakFromDates(['2026-06-20'], TODAY)).toBe(0);
  });
  it('counts consecutive days', () => {
    expect(calcStreakFromDates(['2026-07-01', '2026-07-02', '2026-07-03'], TODAY)).toBe(3);
  });
  it('stops at the first gap', () => {
    expect(calcStreakFromDates(['2026-06-28', '2026-06-30', '2026-07-01', '2026-07-02'], TODAY)).toBe(3);
  });
  it('deduplicates dates (multiple completions per day)', () => {
    expect(calcStreakFromDates(['2026-07-03', '2026-07-03', '2026-07-02'], TODAY)).toBe(2);
  });
  it('counts across month boundaries', () => {
    expect(calcStreakFromDates(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03'], TODAY)).toBe(5);
  });

  describe('with a daysActive schedule', () => {
    const MWF = [0, 2, 4]; // Mon/Wed/Fri
    // 2026-06-29 Mon, 06-30 Tue, 07-01 Wed, 07-02 Thu, 07-03 Fri

    it('does not break over unscheduled days', () => {
      // Completed Mon + Wed; today is Thu (unscheduled) — streak alive at 2
      expect(calcStreakFromDates(['2026-06-29', '2026-07-01'], '2026-07-02', MWF)).toBe(2);
    });
    it('treats today-as-in-progress on a scheduled day', () => {
      // Completed Mon + Wed; today is Fri, not yet completed — still 2
      expect(calcStreakFromDates(['2026-06-29', '2026-07-01'], '2026-07-03', MWF)).toBe(2);
    });
    it('breaks when a scheduled day was missed', () => {
      // Completed Mon, missed Wed; today is Fri
      expect(calcStreakFromDates(['2026-06-29'], '2026-07-03', MWF)).toBe(0);
    });
    it('counts off-day completions as bonus days', () => {
      // Completed Mon, Tue (off-day) and Wed
      expect(calcStreakFromDates(['2026-06-29', '2026-06-30', '2026-07-01'], '2026-07-02', MWF)).toBe(3);
    });
    it('spans a weekend for a weekday-only habit', () => {
      const weekdays = [0, 1, 2, 3, 4];
      // Completed Thu 06-25, Fri 06-26, Mon 06-29; today Tue 06-30
      expect(calcStreakFromDates(['2026-06-25', '2026-06-26', '2026-06-29'], '2026-06-30', weekdays)).toBe(3);
    });
    it('treats null and [] as every-day (unchanged semantics)', () => {
      const dates = ['2026-07-01', '2026-07-02', '2026-07-03'];
      expect(calcStreakFromDates(dates, TODAY, null)).toBe(3);
      expect(calcStreakFromDates(dates, TODAY, [])).toBe(3);
    });
    it('terminates even with an invalid schedule (no day is ever required)', () => {
      // With no valid weekday in the schedule, no day can break the streak, so
      // the old completion is still reachable — the point is it terminates.
      expect(calcStreakFromDates(['2026-06-01'], TODAY, [9])).toBe(1);
    });
  });
});

describe('dedupeByHabitDay', () => {
  it('collapses mirrored shared-habit rows to one per habit-day', () => {
    const rows = [
      { habitId: 'h1', memberId: 'a', date: '2026-07-01', taps: 1 },
      { habitId: 'h1', memberId: 'b', date: '2026-07-01', taps: 1 },
      { habitId: 'h1', memberId: 'c', date: '2026-07-01', taps: 1 },
      { habitId: 'h1', memberId: 'a', date: '2026-07-02', taps: 1 },
    ];
    const deduped = dedupeByHabitDay(rows);
    expect(deduped).toHaveLength(2);
    expect(deduped.map(c => c.date).sort()).toEqual(['2026-07-01', '2026-07-02']);
  });
  it('keeps the max-taps row for a day', () => {
    const rows = [
      { habitId: 'h1', memberId: 'a', date: '2026-07-01', taps: 2 },
      { habitId: 'h1', memberId: 'b', date: '2026-07-01', taps: 5 },
    ];
    expect(dedupeByHabitDay(rows)[0].taps).toBe(5);
  });
  it('keeps different habits on the same day separate', () => {
    const rows = [
      { habitId: 'h1', memberId: 'a', date: '2026-07-01', taps: 1 },
      { habitId: 'h2', memberId: 'a', date: '2026-07-01', taps: 1 },
    ];
    expect(dedupeByHabitDay(rows)).toHaveLength(2);
  });
});

describe('uniqueCompletionDays', () => {
  const rows = [
    { habitId: 'h1', memberId: 'a', date: '2026-06-29', taps: 1 },
    { habitId: 'h1', memberId: 'b', date: '2026-06-29', taps: 1 }, // same day, 2nd member
    { habitId: 'h1', memberId: 'a', date: '2026-06-30', taps: 2 },
    { habitId: 'h1', memberId: 'a', date: '2026-07-01', taps: 0 }, // undone
    { habitId: 'h2', memberId: 'a', date: '2026-06-30', taps: 1 }, // other habit
    { habitId: 'h1', memberId: 'a', date: '2026-06-28', taps: 1 }, // before range
  ];
  it('counts distinct days, not rows (multi-member family mode)', () => {
    expect(uniqueCompletionDays(rows, 'h1', '2026-06-29', '2026-07-05')).toBe(2);
  });
  it('ignores taps=0 (undone) rows and other habits', () => {
    expect(uniqueCompletionDays(rows, 'h2', '2026-06-29', '2026-07-05')).toBe(1);
  });
  it('range bounds are inclusive', () => {
    expect(uniqueCompletionDays(rows, 'h1', '2026-06-28', '2026-06-29')).toBe(2);
  });
});

describe('lastScheduledDayBefore', () => {
  it('returns yesterday for every-day habits', () => {
    expect(lastScheduledDayBefore('2026-07-03')).toBe('2026-07-02');
    expect(lastScheduledDayBefore('2026-07-03', [])).toBe('2026-07-02');
  });
  it('skips back to the previous scheduled day', () => {
    // Mon/Wed/Fri habit, today Fri → previous scheduled day is Wed
    expect(lastScheduledDayBefore('2026-07-03', [0, 2, 4])).toBe('2026-07-01');
    // today Mon → previous scheduled day is last Fri
    expect(lastScheduledDayBefore('2026-06-29', [0, 2, 4])).toBe('2026-06-26');
  });
  it('handles a once-a-week schedule (full week back)', () => {
    expect(lastScheduledDayBefore('2026-07-03', [4])).toBe('2026-06-26'); // Fri → last Fri
  });
  it('falls back to yesterday on an invalid schedule', () => {
    expect(lastScheduledDayBefore('2026-07-03', [9])).toBe('2026-07-02');
  });
});
