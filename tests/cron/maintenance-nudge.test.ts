import { describe, test, expect, vi } from 'vitest';
import { runMaintenanceNudge, formatMessage } from '../../apps/cron/maintenance-nudge.js';
import type { MasterRow } from '../../lib/types.js';
import type { MergedFinding } from '../../domains/outdoor/maintenance.js';

function row(p: Partial<MasterRow>): MasterRow {
  return {
    year: '2020', date: '2020-01-15',
    category: 'Outerwear', subCategory: 'Hiking Boot',
    brand: 'Salomon', itemName: 'X Ultra 3',
    color: '', size: '', qty: 1, price: 100,
    source: 'REI', orderId: '',
    status: 'active', domain: 'Outdoor', productUrl: '', type: 'Gear',
    reasoning: '', notes: '',
    ...p,
  };
}

function mockSheets(ackedRows: (string | number | boolean)[][] = []): { sheets: never; spreadsheetId: string } {
  const allRows = [['Item ID', 'Acked At', 'Notes'], ...ackedRows];
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { sheets: [{ properties: { title: 'Maintenance Acked' } }] },
      }),
      batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
      values: {
        get: vi.fn().mockResolvedValue({ data: { values: allRows } }),
        update: vi.fn().mockResolvedValue({ data: {} }),
        append: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
  return { sheets: sheets as never, spreadsheetId: 'sid' };
}

const TODAY = new Date('2026-05-17T00:00:00Z');

describe('runMaintenanceNudge — surfacing logic', () => {
  test('returns empty message when no findings', async () => {
    const { sheets, spreadsheetId } = mockSheets();
    const res = await runMaintenanceNudge({
      sheets, spreadsheetId, now: TODAY,
      rows: [row({ subCategory: 'Hat', date: '2020-01-01' })],
    });
    expect(res.message).toBe('');
    expect(res.surfaced).toHaveLength(0);
  });

  test('surfaces findings and includes them in the message', async () => {
    const { sheets, spreadsheetId } = mockSheets();
    const res = await runMaintenanceNudge({
      sheets, spreadsheetId, now: TODAY,
      rows: [row({ subCategory: 'Hiking Boots', date: '2020-01-01', itemName: 'X Ultra 3' })],
    });
    expect(res.surfaced).toHaveLength(1);
    expect(res.message).toContain('X Ultra 3');
    expect(res.message).toContain('replace recommended');
    expect(res.message).toContain('/ack-maintenance');
  });

  test('suppresses acked items', async () => {
    // First compute the item ID for our fixture so we can ack it.
    const { sheets: probeSheets, spreadsheetId: probeId } = mockSheets();
    const probe = await runMaintenanceNudge({
      sheets: probeSheets, spreadsheetId: probeId, now: TODAY,
      rows: [row({ subCategory: 'Hiking Boots', date: '2020-01-01' })],
    });
    const id = probe.surfaced[0]!.itemId;

    const { sheets, spreadsheetId } = mockSheets([
      [id, '2026-01-15T00:00:00Z', 'acked'],
    ]);
    const res = await runMaintenanceNudge({
      sheets, spreadsheetId, now: TODAY,
      rows: [row({ subCategory: 'Hiking Boots', date: '2020-01-01' })],
    });
    expect(res.surfaced).toHaveLength(0);
    expect(res.suppressedItemIds).toContain(id);
    expect(res.message).toBe('');
  });

  test('ignores acks older than 12 months', async () => {
    const { sheets: probeSheets, spreadsheetId: probeId } = mockSheets();
    const probe = await runMaintenanceNudge({
      sheets: probeSheets, spreadsheetId: probeId, now: TODAY,
      rows: [row({ subCategory: 'Hiking Boots', date: '2020-01-01' })],
    });
    const id = probe.surfaced[0]!.itemId;

    const { sheets, spreadsheetId } = mockSheets([
      [id, '2024-01-01T00:00:00Z', 'stale ack'],  // > 12mo ago
    ]);
    const res = await runMaintenanceNudge({
      sheets, spreadsheetId, now: TODAY,
      rows: [row({ subCategory: 'Hiking Boots', date: '2020-01-01' })],
    });
    expect(res.surfaced).toHaveLength(1);
  });

  test('caps at 10 lines but reports total in note', async () => {
    const { sheets, spreadsheetId } = mockSheets();
    const rows = Array.from({ length: 15 }, (_, i) =>
      row({ subCategory: 'Hiking Boots', date: '2020-01-01', itemName: `Item ${i}`, orderId: `O${i}` }),
    );
    const res = await runMaintenanceNudge({ sheets, spreadsheetId, now: TODAY, rows });
    expect(res.surfaced).toHaveLength(10);
    expect(res.rawFindings).toHaveLength(15);
    expect(res.message).toContain('and 5 more');
  });
});

describe('formatMessage', () => {
  const sample: MergedFinding[] = [
    { itemId: 'aaa111', itemName: 'X Ultra 3', brand: 'Salomon', emoji: '🥾', ageYears: 5.5, issue: 'replace recommended', ruleIds: ['boots'] },
    { itemId: 'bbb222', itemName: 'Sterling Evolution', brand: '', emoji: '🧗', ageYears: 6.2, issue: 'retire — past 5y UV life', ruleIds: ['climbing-rope'] },
  ];
  test('header reports count and pluralization', () => {
    expect(formatMessage(sample, 2)).toContain('Monthly gear check (2 items)');
    expect(formatMessage(sample.slice(0, 1), 1)).toContain('Monthly gear check (1 item)');
  });
  test('includes ack instructions + per-item ID at bottom', () => {
    const out = formatMessage(sample, 2);
    expect(out).toContain('/ack-maintenance');
    expect(out).toContain('aaa111');
    expect(out).toContain('bbb222');
  });
  test('renders truncation note when items.length < totalCount', () => {
    const out = formatMessage(sample.slice(0, 1), 5);
    expect(out).toContain('and 4 more');
  });
});
