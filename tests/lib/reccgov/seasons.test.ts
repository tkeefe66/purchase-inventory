import { describe, test, expect } from 'vitest';
import {
  DEFAULT_SEASON,
  FACILITY_SEASON_OVERRIDES,
  seasonForFacility,
  addDays,
  todayMtDateString,
  nextSeasonOpenDate,
  nextReminderDate,
} from '../../../lib/reccgov/seasons.js';

describe('seasonForFacility', () => {
  test('returns DEFAULT_SEASON for an un-overridden facility', () => {
    expect(seasonForFacility('999999')).toEqual(DEFAULT_SEASON);
    expect(DEFAULT_SEASON.seasonStart).toBe('05-15');
    expect(DEFAULT_SEASON.seasonEnd).toBe('10-15');
  });

  test('returns the override when one is present', () => {
    const orig = FACILITY_SEASON_OVERRIDES['TEST_OVERRIDE'];
    FACILITY_SEASON_OVERRIDES['TEST_OVERRIDE'] = { seasonStart: '06-01', seasonEnd: '09-30' };
    try {
      expect(seasonForFacility('TEST_OVERRIDE')).toEqual({ seasonStart: '06-01', seasonEnd: '09-30' });
    } finally {
      if (orig === undefined) delete FACILITY_SEASON_OVERRIDES['TEST_OVERRIDE'];
      else FACILITY_SEASON_OVERRIDES['TEST_OVERRIDE'] = orig;
    }
  });
});

describe('addDays', () => {
  test('crosses month boundary', () => {
    expect(addDays('2026-05-30', 5)).toBe('2026-06-04');
  });
  test('handles negative offsets', () => {
    expect(addDays('2026-08-22', -180)).toBe('2026-02-23');
  });
});

describe('todayMtDateString', () => {
  test('returns Mountain Time yyyy-MM-dd from a UTC Date', () => {
    // 2026-05-15 06:00 UTC = 2026-05-15 00:00 MDT
    expect(todayMtDateString(new Date('2026-05-15T06:00:00Z'))).toBe('2026-05-15');
    // 2026-05-15 05:00 UTC = 2026-05-14 23:00 MDT (still 5/14 in MT)
    expect(todayMtDateString(new Date('2026-05-15T05:00:00Z'))).toBe('2026-05-14');
  });
});

describe('nextSeasonOpenDate', () => {
  test('rolling release: 2027 calendar opens 180 days before 05-15 = 2026-11-16', () => {
    const f = { specialReleaseDate: null, seasonStart: '05-15', leadTimeDays: 180 };
    expect(nextSeasonOpenDate(f, '2026-08-18')).toBe('2026-11-16');
  });
  test('rolling release: today is just past this year\'s open → returns next year\'s (leap-year aware)', () => {
    const f = { specialReleaseDate: null, seasonStart: '05-15', leadTimeDays: 180 };
    // This year's open was 2026-11-16 (past). Next year's = 2028-05-15 − 180.
    // 2028 is a leap year, so Feb has 29 days — shifts the result one day later
    // vs the non-leap calc. Result: 2027-11-17.
    expect(nextSeasonOpenDate(f, '2026-12-15')).toBe('2027-11-17');
  });
  test('special release in the future: returns it directly', () => {
    const f = { specialReleaseDate: '2027-03-15', seasonStart: null, leadTimeDays: 0 };
    expect(nextSeasonOpenDate(f, '2026-08-18')).toBe('2027-03-15');
  });
  test('special release in the past: returns null', () => {
    const f = { specialReleaseDate: '2025-03-15', seasonStart: null, leadTimeDays: 0 };
    expect(nextSeasonOpenDate(f, '2026-08-18')).toBeNull();
  });
  test('no seasonStart and no specialReleaseDate: returns null', () => {
    const f = { specialReleaseDate: null, seasonStart: null, leadTimeDays: 180 };
    expect(nextSeasonOpenDate(f, '2026-08-18')).toBeNull();
  });
});

describe('nextReminderDate', () => {
  test('= nextSeasonOpenDate − 90 days when an open date exists', () => {
    const f = { specialReleaseDate: null, seasonStart: '05-15', leadTimeDays: 180 };
    expect(nextReminderDate(f, '2026-08-18')).toBe('2026-08-18');
  });
  test('returns null when no open date is known', () => {
    const f = { specialReleaseDate: null, seasonStart: null, leadTimeDays: 0 };
    expect(nextReminderDate(f, '2026-08-18')).toBeNull();
  });
});
