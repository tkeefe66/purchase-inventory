import { describe, test, expect } from 'vitest';
import {
  filterToActivePhotography,
  getById,
  findByFuzzyName,
} from '../../../domains/photography/inventory.js';
import { itemId } from '../../../lib/itemId.js';
import {
  FIXTURE_PHOTO_ALL,
  FIXTURE_SONY_A6700,
  FIXTURE_SIGMA_18_50,
  FIXTURE_ET8550,
  FIXTURE_LIGHTROOM,
  FIXTURE_BATTERIES,
  FIXTURE_PHOTO_RETIRED,
  FIXTURE_OUTDOOR_ACTIVE,
  FIXTURE_KITCHEN_ACTIVE,
} from '../../fixtures/photography-items.js';

describe('filterToActivePhotography', () => {
  test('keeps only active photography rows', () => {
    const out = filterToActivePhotography(FIXTURE_PHOTO_ALL);
    expect(out).toHaveLength(5);
    expect(out).toEqual(
      expect.arrayContaining([
        FIXTURE_SONY_A6700,
        FIXTURE_SIGMA_18_50,
        FIXTURE_ET8550,
        FIXTURE_LIGHTROOM,
        FIXTURE_BATTERIES,
      ]),
    );
  });

  test('excludes retired Photography rows', () => {
    const out = filterToActivePhotography(FIXTURE_PHOTO_ALL);
    expect(out).not.toContain(FIXTURE_PHOTO_RETIRED);
  });

  test('excludes active Outdoor rows', () => {
    const out = filterToActivePhotography(FIXTURE_PHOTO_ALL);
    expect(out).not.toContain(FIXTURE_OUTDOOR_ACTIVE);
  });

  test('excludes active Kitchen rows', () => {
    const out = filterToActivePhotography(FIXTURE_PHOTO_ALL);
    expect(out).not.toContain(FIXTURE_KITCHEN_ACTIVE);
  });

  test('returns empty array when no photography rows', () => {
    const out = filterToActivePhotography([FIXTURE_OUTDOOR_ACTIVE, FIXTURE_KITCHEN_ACTIVE]);
    expect(out).toHaveLength(0);
  });
});

describe('getById', () => {
  test('returns the row matching the id', () => {
    const id = itemId(FIXTURE_SONY_A6700);
    expect(getById(FIXTURE_PHOTO_ALL, id)).toBe(FIXTURE_SONY_A6700);
  });

  test('returns null when id has no match', () => {
    expect(getById(FIXTURE_PHOTO_ALL, '000000')).toBeNull();
  });

  test('does not match retired row by its id', () => {
    const id = itemId(FIXTURE_PHOTO_RETIRED);
    expect(getById(FIXTURE_PHOTO_ALL, id)).toBeNull();
  });

  test('does not match active Outdoor row by its id', () => {
    const id = itemId(FIXTURE_OUTDOOR_ACTIVE);
    expect(getById(FIXTURE_PHOTO_ALL, id)).toBeNull();
  });
});

describe('findByFuzzyName', () => {
  test('case-insensitive substring match on itemName', () => {
    const matches = findByFuzzyName(FIXTURE_PHOTO_ALL, 'lightroom');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(FIXTURE_LIGHTROOM);
  });

  test('matches against brand as well as itemName', () => {
    const matches = findByFuzzyName(FIXTURE_PHOTO_ALL, 'sony');
    // Sony a6700 + Sony NP-FZ100 Battery
    expect(matches).toHaveLength(2);
    expect(matches).toContain(FIXTURE_SONY_A6700);
    expect(matches).toContain(FIXTURE_BATTERIES);
  });

  test('case-insensitive match on brand', () => {
    const matches = findByFuzzyName(FIXTURE_PHOTO_ALL, 'SIGMA');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(FIXTURE_SIGMA_18_50);
  });

  test('returns empty array for empty query', () => {
    expect(findByFuzzyName(FIXTURE_PHOTO_ALL, '')).toEqual([]);
  });

  test('returns empty array for whitespace-only query', () => {
    expect(findByFuzzyName(FIXTURE_PHOTO_ALL, '   ')).toEqual([]);
  });

  test('returns empty array when no match', () => {
    expect(findByFuzzyName(FIXTURE_PHOTO_ALL, 'nikon xyzzy')).toEqual([]);
  });

  test('does not match retired Photography rows', () => {
    const matches = findByFuzzyName(FIXTURE_PHOTO_ALL, '55-210mm');
    expect(matches).toEqual([]);
  });

  test('does not match active rows from other domains', () => {
    const matches = findByFuzzyName(FIXTURE_PHOTO_ALL, 'therm-a-rest');
    expect(matches).toEqual([]);
  });

  test('returns multiple matches when ambiguous', () => {
    const dup = { ...FIXTURE_SONY_A6700, color: 'Silver', orderId: 'DUP-001' };
    const matches = findByFuzzyName([FIXTURE_SONY_A6700, dup, FIXTURE_SIGMA_18_50], 'a6700');
    expect(matches).toHaveLength(2);
  });
});
