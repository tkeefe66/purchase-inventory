import { describe, test, expect } from 'vitest';
import { itemId } from '../../../domains/outdoor/types.js';
import type { MasterRow } from '../../../lib/types.js';
import { FIXTURE_THERMAREST, FIXTURE_SALOMON } from '../../fixtures/outdoor-items.js';

describe('itemId', () => {
  test('returns 6-character base36 string', () => {
    const id = itemId(FIXTURE_THERMAREST);
    expect(id).toMatch(/^[0-9a-z]{6}$/);
  });

  test('is stable across calls with same input', () => {
    const id1 = itemId(FIXTURE_THERMAREST);
    const id2 = itemId(FIXTURE_THERMAREST);
    expect(id1).toBe(id2);
  });

  test('differs across distinct rows', () => {
    expect(itemId(FIXTURE_THERMAREST)).not.toBe(itemId(FIXTURE_SALOMON));
  });

  test('is identical when only ignored fields differ', () => {
    const variant: MasterRow = {
      ...FIXTURE_THERMAREST,
      reasoning: 'something different',
      notes: 'a new note',
      productUrl: 'https://different-url.example.com',
    };
    expect(itemId(variant)).toBe(itemId(FIXTURE_THERMAREST));
  });

  test('changes when natural-key fields change', () => {
    const variant: MasterRow = { ...FIXTURE_THERMAREST, color: 'Blue' };
    expect(itemId(variant)).not.toBe(itemId(FIXTURE_THERMAREST));
  });
});
