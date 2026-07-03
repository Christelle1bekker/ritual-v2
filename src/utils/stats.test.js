import {
  todayKey, getYesterdayKey, getTodayIndex, getWeekDates, isoAddDays, calcStreakFromDates,
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
});
