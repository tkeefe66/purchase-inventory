import { describe, test, expect, vi } from 'vitest';
import { appendCronLogRow, readCronLogToday, type CronLogRow } from '../../lib/sheets.js';

function makeSheetsMock(opts: {
  existingTabs: string[];
  existingHeader?: (string | null)[];
}) {
  const created: string[] = [];
  const appended: { range: string; values: unknown[][] }[] = [];
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { sheets: opts.existingTabs.map((t) => ({ properties: { title: t } })) },
      }),
      batchUpdate: vi.fn(async (req: { requestBody: { requests: { addSheet: { properties: { title: string } } }[] } }) => {
        for (const r of req.requestBody.requests) {
          created.push(r.addSheet.properties.title);
        }
        return { data: {} };
      }),
      values: {
        get: vi.fn().mockResolvedValue({
          data: { values: opts.existingHeader ? [opts.existingHeader] : [] },
        }),
        append: vi.fn(async (req: { range: string; requestBody: { values: unknown[][] } }) => {
          appended.push({ range: req.range, values: req.requestBody.values });
          return { data: {} };
        }),
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
  return { sheets, created, appended };
}

const sampleRow: CronLogRow = {
  runTimestamp: '2026-05-15T13:00:00.000Z',
  itemsAdded: 2,
  itemsBySource: { Amazon: 2 },
  itemsByDomain: { Outdoor: 2 },
  returnsApplied: 0,
  messagesScanned: 5,
  errorsCount: 0,
  durationSeconds: 8.3,
};

describe('appendCronLogRow', () => {
  test('creates "Cron Log" tab on first write when missing', async () => {
    const { sheets, created } = makeSheetsMock({ existingTabs: ['All Purchases'] });
    await appendCronLogRow(sheets as never, 'sheet-id', sampleRow);
    expect(created).toContain('Cron Log');
  });

  test('appends a row with JSON-stringified maps', async () => {
    const header = ['Run Timestamp', 'Items Added', 'Items By Source', 'Items By Domain',
                    'Returns Applied', 'Messages Scanned', 'Errors Count', 'Duration (s)'];
    const { sheets, appended } = makeSheetsMock({
      existingTabs: ['All Purchases', 'Cron Log'],
      existingHeader: header,
    });
    await appendCronLogRow(sheets as never, 'sheet-id', sampleRow);
    expect(appended).toHaveLength(1);
    const row = appended[0]!.values[0]!;
    expect(row[0]).toBe('2026-05-15T13:00:00.000Z');
    expect(row[1]).toBe(2);
    expect(row[2]).toBe('{"Amazon":2}');
    expect(row[3]).toBe('{"Outdoor":2}');
  });

  test('does not re-create the tab when it already exists', async () => {
    const { sheets, created } = makeSheetsMock({
      existingTabs: ['All Purchases', 'Cron Log'],
      existingHeader: ['Run Timestamp', 'Items Added', 'Items By Source', 'Items By Domain',
                       'Returns Applied', 'Messages Scanned', 'Errors Count', 'Duration (s)'],
    });
    await appendCronLogRow(sheets as never, 'sheet-id', sampleRow);
    expect(created).not.toContain('Cron Log');
  });
});

describe('readCronLogToday', () => {
  function makeReader(rows: (string | number)[][]) {
    const header = ['Run Timestamp', 'Items Added', 'Items By Source', 'Items By Domain',
                    'Returns Applied', 'Messages Scanned', 'Errors Count', 'Duration (s)'];
    return {
      spreadsheets: {
        values: {
          get: vi.fn().mockResolvedValue({ data: { values: [header, ...rows] } }),
        },
      },
    };
  }

  test('returns only rows whose Run Timestamp falls on the requested MT date', async () => {
    // 2026-05-15 in Mountain time (UTC-6 in DST). 13:00 UTC = 07:00 MT, 06:00 UTC = 00:00 MT.
    const rows = [
      ['2026-05-15T07:00:00.000Z', 1, '{"Amazon":1}', '{"Outdoor":1}', 0, 3, 0, 5.0], // 01:00 MT 5/15
      ['2026-05-15T13:00:00.000Z', 2, '{"Amazon":2}', '{"Outdoor":2}', 0, 5, 0, 8.3], // 07:00 MT 5/15
      ['2026-05-14T23:00:00.000Z', 1, '{"REI":1}', '{"Outdoor":1}', 0, 2, 0, 4.1],    // 17:00 MT 5/14
      ['2026-05-16T02:00:00.000Z', 1, '{"Amazon":1}', '{"Home":1}', 0, 1, 0, 2.0],    // 20:00 MT 5/15
    ];
    const sheets = makeReader(rows);
    const today = await readCronLogToday(sheets as never, 'sheet-id', '2026-05-15');
    expect(today).toHaveLength(3); // first, second, fourth rows
    expect(today[0]!.itemsAdded).toBe(1);
    expect(today[1]!.itemsBySource).toEqual({ Amazon: 2 });
  });

  test('returns [] when the tab is empty / header-only', async () => {
    const sheets = makeReader([]);
    expect(await readCronLogToday(sheets as never, 'sheet-id', '2026-05-15')).toEqual([]);
  });

  test('returns [] when the Cron Log tab does not exist (404 from values.get)', async () => {
    const sheets = {
      spreadsheets: {
        values: {
          get: vi.fn().mockRejectedValue({ code: 400, message: 'Unable to parse range' }),
        },
      },
    };
    expect(await readCronLogToday(sheets as never, 'sheet-id', '2026-05-15')).toEqual([]);
  });

  test('propagates non-404 errors (auth/network/quota) rather than swallowing them', async () => {
    const sheets = {
      spreadsheets: {
        values: {
          get: vi.fn().mockRejectedValue({ code: 503, message: 'Service Unavailable' }),
        },
      },
    };
    await expect(
      readCronLogToday(sheets as never, 'sheet-id', '2026-05-15'),
    ).rejects.toMatchObject({ code: 503 });
  });
});
