import { describe, test, expect } from 'vitest';
import { formatDailySummary, formatErrorAlert } from '../../apps/cron/digest.js';
import type { CronLogRow } from '../../lib/sheets.js';

const r = (overrides: Partial<CronLogRow>): CronLogRow => ({
  runTimestamp: '2026-05-15T13:00:00.000Z',
  itemsAdded: 0,
  itemsBySource: {},
  itemsByDomain: {},
  returnsApplied: 0,
  messagesScanned: 0,
  errorsCount: 0,
  durationSeconds: 0,
  ...overrides,
});

describe('formatDailySummary', () => {
  test('no-activity day prints a clear "nothing to report" message', () => {
    const out = formatDailySummary([
      r({ messagesScanned: 1, durationSeconds: 3 }),
      r({ messagesScanned: 0, durationSeconds: 2 }),
    ], 24);
    expect(out).toMatch(/Daily inventory summary/i);
    expect(out).toMatch(/No new items/i);
    expect(out).toMatch(/24 runs/);
  });

  test('aggregates items by source and domain across runs', () => {
    const out = formatDailySummary([
      r({ itemsAdded: 2, itemsBySource: { Amazon: 2 }, itemsByDomain: { Outdoor: 2 } }),
      r({ itemsAdded: 1, itemsBySource: { REI: 1 }, itemsByDomain: { Outdoor: 1 } }),
      r({ returnsApplied: 1 }),
    ], 24);
    expect(out).toMatch(/3 new items/);
    expect(out).toMatch(/Amazon: 2/);
    expect(out).toMatch(/REI: 1/);
    expect(out).toMatch(/Outdoor: 3/);
    expect(out).toMatch(/1 return/);
  });

  test('reports run count even when log is empty (cron ran but log read failed)', () => {
    const out = formatDailySummary([], 24);
    expect(out).toMatch(/24 runs/);
    expect(out).toMatch(/No new items/i);
  });
});

describe('formatErrorAlert', () => {
  test('lists each error with its message id and subject', () => {
    const out = formatErrorAlert({
      startedAt: '', endedAt: '',
      messagesScanned: 3, itemsAdded: 0,
      itemsBySource: {}, itemsByDomain: {},
      skippedNonReceipts: 1, duplicatesIgnored: 0,
      labelsApplied: 0, returnsApplied: 0, returnsUnmatched: 0,
      errors: [
        { messageId: 'abc123', subject: 'Ordered: foo', error: 'JSON parse failed' },
        { messageId: 'def456', subject: 'Shipped: bar', error: '529 overloaded' },
      ],
      dryRun: false,
    });
    expect(out).toMatch(/Inventory cron error/i);
    expect(out).toMatch(/2 error/);
    expect(out).toContain('Ordered: foo');
    expect(out).toContain('Shipped: bar');
    expect(out).toContain('JSON parse failed');
  });
});
