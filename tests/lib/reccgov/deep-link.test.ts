import { describe, test, expect } from 'vitest';
import { buildBookingUrl } from '../../../lib/reccgov/deep-link.js';

describe('buildBookingUrl', () => {
  test('builds a Rec.gov URL with date pre-selected', () => {
    expect(buildBookingUrl('231959', '2026-07-04')).toBe(
      'https://www.recreation.gov/camping/campgrounds/231959?startDate=2026-07-04',
    );
  });
  test('returns null when facilityId is empty', () => {
    expect(buildBookingUrl('', '2026-07-04')).toBeNull();
  });
  test('returns null when date is malformed', () => {
    expect(buildBookingUrl('231959', 'not-a-date')).toBeNull();
  });
});
