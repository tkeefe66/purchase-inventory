import { describe, test, expect } from 'vitest';
import { fuzzyMatchExisting } from '../../lib/dedup.js';

function row(brand: string, itemName: string, opts: { image?: string; orderId?: string; productUrl?: string } = {}) {
  return { brand, itemName, image: opts.image ?? '', orderId: opts.orderId ?? '', productUrl: opts.productUrl ?? '' };
}

describe('fuzzyMatchExisting', () => {
  test('returns no matches when the input list is empty', () => {
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', []);
    expect(result).toEqual([]);
  });

  test('returns score 1.0 for an exact match', () => {
    const rows = [row('Patagonia', 'Houdini Jacket')];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeCloseTo(1.0, 5);
    expect(result[0]!.rowIndex).toBe(0);
  });

  test('case-insensitive and whitespace-tolerant', () => {
    const rows = [row('PATAGONIA', '  Houdini  Jacket  ')];
    const result = fuzzyMatchExisting('patagonia', 'houdini jacket', rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeCloseTo(1.0, 5);
  });

  test('partial overlap above 0.5 threshold is included', () => {
    const rows = [row('Patagonia', 'Houdini Air Jacket')];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeGreaterThan(0.5);
    expect(result[0]!.score).toBeLessThan(1.0);
  });

  test('overlap below 0.5 is excluded', () => {
    const rows = [row('Patagonia', 'Capilene Thermal Weight Crew')];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toEqual([]);
  });

  test('score exactly 0.5 is included (>= boundary)', () => {
    // target tokens = {patagonia, houdini}; candidate = {patagonia}
    // |inter|=1, |union|=2, jaccard = 0.5
    const rows = [row('Patagonia', '')];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini', rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.score).toBeCloseTo(0.5, 5);
  });

  test('caps results at 3 even when more match', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row('Patagonia', `Houdini Jacket v${i}`));
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toHaveLength(3);
  });

  test('ranks higher scores first', () => {
    const rows = [
      row('Patagonia', 'Houdini Air Jacket Mens'),     // partial
      row('Patagonia', 'Houdini Jacket'),              // exact
      row('Patagonia', 'Houdini Jacket Mens Medium'),  // partial, closer
    ];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result[0]!.score).toBeGreaterThanOrEqual(result[1]!.score);
    expect(result[1]!.score).toBeGreaterThanOrEqual(result[2]!.score);
  });

  test('match result carries image, orderId, productUrl from the candidate row', () => {
    const rows = [row('Patagonia', 'Houdini Jacket', {
      image: '/images/abc.jpg',
      orderId: 'ORD-123',
      productUrl: 'https://patagonia.com/houdini',
    })];
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
    expect(result).toHaveLength(1);
    expect(result[0]!.image).toBe('/images/abc.jpg');
    expect(result[0]!.orderId).toBe('ORD-123');
    expect(result[0]!.productUrl).toBe('https://patagonia.com/houdini');
  });
});
