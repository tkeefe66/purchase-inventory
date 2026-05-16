import { describe, test, expect } from 'vitest';
import {
  DEFAULT_SEASON,
  FACILITY_SEASON_OVERRIDES,
  seasonForFacility,
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
