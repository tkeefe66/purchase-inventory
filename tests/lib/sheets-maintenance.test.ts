import { describe, test, expect, vi } from 'vitest';
import { readActiveMaintenanceAcks, appendMaintenanceAck } from '../../lib/sheets.js';

const HEADER = ['Item ID', 'Acked At', 'Notes'];

function mockSheets(opts: { existingTabs: string[]; existingRows?: (string | number | boolean)[][] }) {
  const updated: { range: string; values: unknown[][] }[] = [];
  const appended: unknown[][] = [];
  const created: string[] = [];
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { sheets: opts.existingTabs.map((t) => ({ properties: { title: t } })) },
      }),
      batchUpdate: vi.fn(async (req: { requestBody: { requests: { addSheet: { properties: { title: string } } }[] } }) => {
        for (const r of req.requestBody.requests) created.push(r.addSheet.properties.title);
        return { data: {} };
      }),
      values: {
        get: vi.fn().mockResolvedValue({
          data: { values: opts.existingRows ? [HEADER, ...opts.existingRows] : [HEADER] },
        }),
        update: vi.fn(async (req: { range: string; requestBody: { values: unknown[][] } }) => {
          updated.push({ range: req.range, values: req.requestBody.values });
          return { data: {} };
        }),
        append: vi.fn(async (req: { requestBody: { values: unknown[][] } }) => {
          appended.push(...req.requestBody.values);
          return { data: {} };
        }),
      },
    },
  };
  return { sheets, updated, appended, created };
}

describe('readActiveMaintenanceAcks', () => {
  const cutoff = '2025-05-17T00:00:00Z';

  test('returns empty Set when tab is empty', async () => {
    const { sheets } = mockSheets({ existingTabs: ['Maintenance Acked'] });
    const out = await readActiveMaintenanceAcks(sheets as never, 'sid', cutoff);
    expect(out.size).toBe(0);
  });

  test('returns Item IDs with ack newer than cutoff', async () => {
    const { sheets } = mockSheets({
      existingTabs: ['Maintenance Acked'],
      existingRows: [
        ['abc123', '2026-01-15T10:00:00Z', 'still fine'],
        ['def456', '2025-04-01T10:00:00Z', 'old ack'],   // before cutoff
        ['ghi789', '2025-09-15T10:00:00Z', 'recent'],
      ],
    });
    const out = await readActiveMaintenanceAcks(sheets as never, 'sid', cutoff);
    expect(out.has('abc123')).toBe(true);
    expect(out.has('ghi789')).toBe(true);
    expect(out.has('def456')).toBe(false);
  });

  test('creates the tab when missing', async () => {
    const { sheets, created } = mockSheets({ existingTabs: ['All Purchases'] });
    await readActiveMaintenanceAcks(sheets as never, 'sid', cutoff);
    expect(created).toContain('Maintenance Acked');
  });

  test('skips rows with empty Item ID or Acked At', async () => {
    const { sheets } = mockSheets({
      existingTabs: ['Maintenance Acked'],
      existingRows: [
        ['', '2026-01-15T10:00:00Z', 'orphan'],
        ['abc', '', 'no date'],
        ['valid', '2026-01-15T10:00:00Z', 'ok'],
      ],
    });
    const out = await readActiveMaintenanceAcks(sheets as never, 'sid', cutoff);
    expect(out.size).toBe(1);
    expect(out.has('valid')).toBe(true);
  });
});

describe('appendMaintenanceAck', () => {
  test('appends a new row', async () => {
    const { sheets, appended } = mockSheets({ existingTabs: ['Maintenance Acked'] });
    await appendMaintenanceAck(sheets as never, 'sid', {
      itemId: 'abc123', ackedAt: '2026-05-17T19:00:00Z', notes: 'via /ack',
    });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toEqual(['abc123', '2026-05-17T19:00:00Z', 'via /ack']);
  });
});
