import { describe, test, expect } from 'vitest';
import { dedupItems, makeDedupKey } from '../lib/dedup.js';

describe('makeDedupKey', () => {
  test('joins fields with double-pipe separator', () => {
    expect(
      makeDedupKey({ orderId: '113-1234567-1234567', itemName: 'Tent', color: 'Red', size: 'M' }),
    ).toBe('113-1234567-1234567||Tent||Red||M');
  });

  test('trims whitespace from each field', () => {
    expect(
      makeDedupKey({ orderId: '  A1  ', itemName: ' Tent ', color: ' Red ', size: ' M ' }),
    ).toBe('A1||Tent||Red||M');
  });

  test('handles blank fields (historical REI rows have blank Order ID)', () => {
    expect(
      makeDedupKey({ orderId: '', itemName: 'Hiking Boots', color: 'Black', size: '9' }),
    ).toBe('||Hiking Boots||Black||9');
  });
});

describe('dedupItems', () => {
  test('returns all items when none exist in the existing set', () => {
    const items = [
      { orderId: 'A', itemName: 'X', color: '', size: '' },
      { orderId: 'B', itemName: 'Y', color: '', size: '' },
    ];
    expect(dedupItems(items, new Set())).toEqual(items);
  });

  test('filters out items whose key is in the existing set', () => {
    const items = [
      { orderId: 'A', itemName: 'X', color: '', size: '' },
      { orderId: 'B', itemName: 'Y', color: '', size: '' },
    ];
    const existing = new Set([makeDedupKey({ orderId: 'A', itemName: 'X', color: '', size: '' })]);
    const result = dedupItems(items, existing);
    expect(result).toHaveLength(1);
    expect(result[0]?.orderId).toBe('B');
  });

  test('filters duplicates within the same batch (same key appears twice in newItems)', () => {
    const items = [
      { orderId: 'A', itemName: 'X', color: '', size: '' },
      { orderId: 'A', itemName: 'X', color: '', size: '' }, // duplicate
    ];
    expect(dedupItems(items, new Set())).toHaveLength(1);
  });

  test('keeps items that share an order ID but differ in name/color/size', () => {
    // Same Amazon order with multiple items in different colors → all are unique
    const items = [
      { orderId: 'A', itemName: 'Shirt', color: 'Red', size: 'M' },
      { orderId: 'A', itemName: 'Shirt', color: 'Blue', size: 'M' }, // different color, distinct
      { orderId: 'A', itemName: 'Pants', color: 'Black', size: 'M' }, // different name, distinct
    ];
    expect(dedupItems(items, new Set())).toHaveLength(3);
  });

  test('treats whitespace-only differences as the same key', () => {
    const items = [
      { orderId: 'A', itemName: 'X', color: '', size: '' },
      { orderId: ' A ', itemName: ' X ', color: '', size: '' }, // same after trim
    ];
    expect(dedupItems(items, new Set())).toHaveLength(1);
  });
});
