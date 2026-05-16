import { describe, test, expect, vi } from 'vitest';
import { appendCronLogRow, type CronLogRow } from '../../lib/sheets.js';

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
