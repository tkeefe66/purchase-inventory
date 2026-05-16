import { describe, test, expect } from 'vitest';
import { regionForParentUnit, CURATED_REGIONS } from '../../../lib/reccgov/regions.js';

describe('regionForParentUnit', () => {
  test('maps a known parent unit to its curated region', () => {
    expect(regionForParentUnit('Rocky Mountain National Park')).toBe('Front Range');
    expect(regionForParentUnit('San Juan National Forest')).toBe('San Juans');
  });
  test('returns null for an unmapped parent', () => {
    expect(regionForParentUnit('Tongass National Forest')).toBeNull();
  });
  test('every CURATED_REGIONS entry has at least one parent', () => {
    for (const [region, parents] of Object.entries(CURATED_REGIONS)) {
      expect(parents.length, `${region} has no parents`).toBeGreaterThan(0);
    }
  });
});
