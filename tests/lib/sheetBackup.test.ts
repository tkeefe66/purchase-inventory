import { describe, it, expect } from 'vitest';
import { backupAllTabs } from '../../lib/sheetBackup.js';

function mockSheets(tabs: Record<string, string[][]>) {
  return {
    spreadsheets: {
      get: async () => ({
        data: { sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) },
      }),
      values: {
        get: async ({ range }: { range: string }) => {
          const title = range.replace(/^'|'$/g, '');
          return { data: { values: tabs[title] ?? [] } };
        },
      },
    },
  } as any;
}

describe('backupAllTabs', () => {
  it('dumps every tab keyed by title', async () => {
    const tabs = {
      'All Purchases': [['Date', 'Item'], ['2026-01-01', 'Tent']],
      'Cron Log': [['Run Timestamp'], ['2026-01-01T00:00:00Z']],
    };
    const out = await backupAllTabs(mockSheets(tabs), 'sheet123', '2026-08-03T09:00:00Z');
    expect(out.spreadsheetId).toBe('sheet123');
    expect(out.takenAt).toBe('2026-08-03T09:00:00Z');
    expect(out.tabs['All Purchases']).toEqual(tabs['All Purchases']);
    expect(out.tabs['Cron Log']).toEqual(tabs['Cron Log']);
  });

  it('represents an empty tab as an empty array', async () => {
    const out = await backupAllTabs(mockSheets({ Empty: [] }), 's', '2026-08-03T09:00:00Z');
    expect(out.tabs['Empty']).toEqual([]);
  });
});
