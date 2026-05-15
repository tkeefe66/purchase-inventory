import { describe, test, expect } from 'vitest';
import { fuzzyMatchExisting } from '../../lib/dedup.js';

describe('fuzzyMatchExisting', () => {
  test('returns no matches when the input list is empty', () => {
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', []);
    expect(result).toEqual([]);
  });

  test('returns score 1.0 for an exact match', () => {
    const rows = [{ brand: 'Patagonia', itemName: 'Houdini Jacket' }];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeCloseTo(1.0, 5);
    expect(result[0]!.rowIndex).toBe(0);
  });

  test('case-insensitive and whitespace-tolerant', () => {
    const rows = [{ brand: 'PATAGONIA', itemName: '  Houdini  Jacket  ' }];
    const result = fuzzyMatchExisting('patagonia', 'houdini jacket', rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeCloseTo(1.0, 5);
  });

  test('partial overlap above 0.5 threshold is included', () => {
    const rows = [{ brand: 'Patagonia', itemName: 'Houdini Air Jacket' }];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeGreaterThan(0.5);
    expect(result[0]!.score).toBeLessThan(1.0);
  });

  test('overlap below 0.5 is excluded', () => {
    const rows = [{ brand: 'Patagonia', itemName: 'Capilene Thermal Weight Crew' }];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toEqual([]);
  });

  test('caps results at 3 even when more match', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      brand: 'Patagonia',
      itemName: `Houdini Jacket v${i}`,
    }));
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toHaveLength(3);
  });

  test('ranks higher scores first', () => {
    const rows = [
      { brand: 'Patagonia', itemName: 'Houdini Air Jacket Mens' },     // partial
      { brand: 'Patagonia', itemName: 'Houdini Jacket' },              // exact
      { brand: 'Patagonia', itemName: 'Houdini Jacket Mens Medium' },  // partial, closer
    ];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result[0]!.score).toBeGreaterThanOrEqual(result[1]!.score);
    expect(result[1]!.score).toBeGreaterThanOrEqual(result[2]!.score);
  });
});
