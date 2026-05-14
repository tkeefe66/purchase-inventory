import { describe, test, expect } from 'vitest';
import {
  filterToActiveOutdoor,
  getById,
  findByFuzzyName,
} from '../../../domains/outdoor/inventory.js';
import { itemId } from '../../../domains/outdoor/types.js';
import {
  FIXTURE_ALL,
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
  FIXTURE_RETIRED,
  FIXTURE_PHOTO,
} from '../../fixtures/outdoor-items.js';

describe('filterToActiveOutdoor', () => {
  test('keeps only active outdoor rows', () => {
    const out = filterToActiveOutdoor(FIXTURE_ALL);
    expect(out).toHaveLength(3);
    expect(out).toEqual(expect.arrayContaining([FIXTURE_THERMAREST, FIXTURE_SALOMON, FIXTURE_NO_BRAND]));
    expect(out).not.toContain(FIXTURE_RETIRED);
    expect(out).not.toContain(FIXTURE_PHOTO);
  });
});

describe('getById', () => {
  test('returns the row matching the id', () => {
    const id = itemId(FIXTURE_THERMAREST);
    expect(getById(FIXTURE_ALL, id)).toBe(FIXTURE_THERMAREST);
  });

  test('returns null when id has no match', () => {
    expect(getById(FIXTURE_ALL, '000000')).toBeNull();
  });
});

describe('findByFuzzyName', () => {
  test('case-insensitive substring match on itemName', () => {
    const matches = findByFuzzyName(FIXTURE_ALL, 'salomon');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(FIXTURE_SALOMON);
  });

  test('matches against brand as well as itemName', () => {
    const matches = findByFuzzyName(FIXTURE_ALL, 'therm');
    expect(matches).toEqual([FIXTURE_THERMAREST]);
  });

  test('returns empty array when no match', () => {
    expect(findByFuzzyName(FIXTURE_ALL, 'nonexistent xyzzy')).toEqual([]);
  });

  test('only searches active outdoor rows', () => {
    const matches = findByFuzzyName(FIXTURE_ALL, 'old backpack');
    expect(matches).toEqual([]);
  });

  test('returns multiple matches when ambiguous', () => {
    const dup = { ...FIXTURE_THERMAREST, color: 'Blue', orderId: 'DUP-001' };
    const matches = findByFuzzyName([FIXTURE_THERMAREST, dup], 'sleeping');
    expect(matches).toHaveLength(2);
  });
});
