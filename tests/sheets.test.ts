import { describe, test, expect, vi } from 'vitest';
import { buildHeaderMap, colLetter, updateRowStatus, appendMasterRow } from '../lib/sheets.js';
import type { SheetsClient } from '../lib/sheets.js';

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

function makeFakeSheets(opts: {
  headerRow: string[];
  onUpdate?: (range: string, values: string[][]) => void;
}): SheetsClient {
  return {
    spreadsheets: {
      values: {
        get: vi.fn().mockResolvedValue({ data: { values: [opts.headerRow] } }),
        update: vi.fn().mockImplementation((args: { range: string; requestBody: { values: string[][] } }) => {
          opts.onUpdate?.(args.range, args.requestBody.values);
          return Promise.resolve({ data: {} });
        }),
      },
    },
  } as unknown as SheetsClient;
}

describe('updateRowStatus', () => {
  test('writes the new status to the Status column of the specified row', async () => {
    const writes: { range: string; values: string[][] }[] = [];
    const fakeSheets = makeFakeSheets({
      headerRow: ['Year', 'Brand', 'Item Name', 'Status'],
      onUpdate: (range, values) => writes.push({ range, values }),
    });
    await updateRowStatus(fakeSheets, 'SHEET_ID', { rowIndex: 2, newStatus: 'lost' });
    expect(writes).toHaveLength(1);
    expect(writes[0]!.range).toBe(`'All Purchases'!D2`);
    expect(writes[0]!.values).toEqual([['lost']]);
  });

  test('rejects an invalid status string', async () => {
    const fakeSheets = makeFakeSheets({ headerRow: ['Year', 'Status'] });
    await expect(
      updateRowStatus(fakeSheets, 'SHEET_ID', { rowIndex: 2, newStatus: 'gone-fishing' as any }),
    ).rejects.toThrow(/invalid status/i);
  });

  test('throws when Status column is missing from the header row', async () => {
    const fakeSheets = makeFakeSheets({ headerRow: ['Year', 'Brand', 'Item Name'] });
    await expect(
      updateRowStatus(fakeSheets, 'SHEET_ID', { rowIndex: 2, newStatus: 'lost' }),
    ).rejects.toThrow(/Status column/i);
  });
});

describe('appendMasterRow', () => {
  test('appends a row laid out by header position and returns the row index', async () => {
    const appendedValues: unknown[] = [];
    const fakeSheets = {
      spreadsheets: {
        values: {
          get: vi.fn().mockResolvedValue({
            data: { values: [['Year', 'Item Name', 'Status', 'Brand']] },
          }),
          append: vi.fn().mockImplementation((args: { requestBody: { values: unknown[][] } }) => {
            appendedValues.push(args.requestBody.values[0]);
            return Promise.resolve({ data: { updates: { updatedRange: `'All Purchases'!A5:D5` } } });
          }),
        },
      },
    } as unknown as SheetsClient;
    const row = {
      year: '2026', date: '2026-05-14', category: '', subCategory: '',
      brand: 'BD', itemName: 'Couloir', color: '', size: '', qty: 1, price: 80,
      source: 'REI' as const, orderId: '', status: 'active' as const, domain: 'Outdoor' as const,
      productUrl: '', type: 'Gear' as const, reasoning: '', notes: '', image: '', entryMethod: 'email' as const,
    };
    const { rowIndex } = await appendMasterRow(fakeSheets, 'SHEET_ID', row);
    expect(rowIndex).toBe(5);
    expect(appendedValues[0]).toEqual(['2026', 'Couloir', 'active', 'BD']);
  });
});
