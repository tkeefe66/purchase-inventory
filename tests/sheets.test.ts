import { describe, test, expect } from 'vitest';
import { buildHeaderMap, colLetter } from '../lib/sheets.js';

describe('buildHeaderMap', () => {
  test('returns name → index map for a normal header row', () => {
    const map = buildHeaderMap(['Year', 'Date Purchased', 'Item Name']);
    expect(map.get('Year')).toBe(0);
    expect(map.get('Date Purchased')).toBe(1);
    expect(map.get('Item Name')).toBe(2);
  });

  test('reflects the actual physical position when columns are reordered', () => {
    // The whole point: if Tom moves Type from P to O in Sheets, the map
    // shifts and the rest of the code keeps working.
    const reordered = buildHeaderMap(['Year', 'Type', 'Product URL']);
    expect(reordered.get('Type')).toBe(1);
    expect(reordered.get('Product URL')).toBe(2);
  });

  test('trims whitespace and skips empty cells', () => {
    const map = buildHeaderMap(['  Year  ', '', 'Item Name', '  ']);
    expect(map.get('Year')).toBe(0);
    expect(map.has('')).toBe(false);
    expect(map.get('Item Name')).toBe(2);
    expect(map.size).toBe(2);
  });

  test('handles null/undefined entries safely', () => {
    const map = buildHeaderMap(['Year', null, undefined, 'Item Name']);
    expect(map.get('Year')).toBe(0);
    expect(map.get('Item Name')).toBe(3);
    expect(map.size).toBe(2);
  });
});

describe('colLetter', () => {
  test.each([
    [0, 'A'],
    [1, 'B'],
    [16, 'Q'], // matches our last data column
    [25, 'Z'],
    [26, 'AA'],
    [27, 'AB'],
    [51, 'AZ'],
    [52, 'BA'],
    [701, 'ZZ'],
  ])('index %i → %s', (idx, letter) => {
    expect(colLetter(idx)).toBe(letter);
  });
});
