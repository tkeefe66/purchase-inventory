import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupAllTabs, writeBackup, pruneBackups } from '../../lib/sheetBackup.js';

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

describe('writeBackup', () => {
  it('writes a dated JSON file under backups/ and returns its path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bk-'));
    const p = await writeBackup(root, { takenAt: 't', spreadsheetId: 's', tabs: { A: [['x']] } }, '2026-08-03');
    expect(p).toBe(join(root, 'backups', 'sheet-2026-08-03.json'));
    const parsed = JSON.parse(await readFile(p, 'utf-8'));
    expect(parsed.tabs.A).toEqual([['x']]);
  });
});

describe('pruneBackups', () => {
  it('deletes files older than keepDays, keeps the rest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bk-'));
    const dir = join(root, 'backups');
    await mkdir(dir, { recursive: true });
    for (const d of ['2026-07-01', '2026-07-30', '2026-08-03']) {
      await writeFile(join(dir, `sheet-${d}.json`), '{}');
    }
    const deleted = await pruneBackups(root, 30, '2026-08-03'); // keep >= 2026-07-04
    expect(deleted).toContain('sheet-2026-07-01.json');
    const left = await readdir(dir);
    expect(left.sort()).toEqual(['sheet-2026-07-30.json', 'sheet-2026-08-03.json']);
  });
});
