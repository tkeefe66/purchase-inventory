import { describe, test, expect, vi } from 'vitest';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import type { MasterRow } from '../../../lib/types.js';
import {
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
} from '../../fixtures/outdoor-items.js';

function makeFetcher(rowsByCall: MasterRow[][]): { fetch: () => Promise<MasterRow[]>; calls: number } {
  let i = 0;
  const state = {
    fetch: async (): Promise<MasterRow[]> => {
      const next = rowsByCall[Math.min(i, rowsByCall.length - 1)] ?? [];
      i += 1;
      state.calls = i;
      return next;
    },
    calls: 0,
  };
  return state;
}

describe('InventoryCache', () => {
  test('initial refresh populates snapshot and compact view', async () => {
    const fetcher = makeFetcher([[FIXTURE_THERMAREST, FIXTURE_SALOMON]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    expect(cache.getSnapshot()).toHaveLength(2);
    const view = cache.getCompactView();
    expect(view.text).toContain('Therm-a-Rest');
    expect(view.text).toContain('Salomon');
  });

  test('hash unchanged across no-op refreshes', async () => {
    const fetcher = makeFetcher([
      [FIXTURE_THERMAREST, FIXTURE_SALOMON],
      [FIXTURE_THERMAREST, FIXTURE_SALOMON],
    ]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    const hashBefore = cache.getCompactView().hash;
    await cache.refresh();
    const hashAfter = cache.getCompactView().hash;
    expect(hashAfter).toBe(hashBefore);
    expect(cache.lastRefreshChangedHash).toBe(false);
  });

  test('hash changes when row data changes', async () => {
    const variant: MasterRow = { ...FIXTURE_THERMAREST, price: 59.95 };
    const fetcher = makeFetcher([[FIXTURE_THERMAREST], [variant]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    const hashBefore = cache.getCompactView().hash;
    await cache.refresh();
    expect(cache.getCompactView().hash).not.toBe(hashBefore);
    expect(cache.lastRefreshChangedHash).toBe(true);
  });

  test('compact view is memoized when hash unchanged', async () => {
    const fetcher = makeFetcher([[FIXTURE_THERMAREST]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    const view1 = cache.getCompactView();
    const view2 = cache.getCompactView();
    expect(view1).toBe(view2); // referential equality — same object
  });

  test('applyLocalChange updates snapshot and invalidates hash', async () => {
    const fetcher = makeFetcher([[FIXTURE_THERMAREST]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    const hashBefore = cache.getCompactView().hash;
    cache.applyLocalChange(FIXTURE_SALOMON);
    expect(cache.getSnapshot()).toContainEqual(FIXTURE_SALOMON);
    expect(cache.getCompactView().hash).not.toBe(hashBefore);
  });

  test('applyLocalChange replaces an existing row with the same itemId', async () => {
    const updated: MasterRow = { ...FIXTURE_THERMAREST, status: 'retired' };
    const fetcher = makeFetcher([[FIXTURE_THERMAREST]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    cache.applyLocalChange(updated);
    expect(cache.getSnapshot()).toHaveLength(1);
    // 'retired' filtered out of compact view
    expect(cache.getCompactView().text).not.toContain('Therm-a-Rest');
  });

  test('forceRefresh re-runs the fetcher', async () => {
    const fetcher = makeFetcher([[FIXTURE_THERMAREST]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    expect(fetcher.calls).toBe(1);
    await cache.forceRefresh();
    expect(fetcher.calls).toBe(2);
  });

  test('refresh failure preserves the previous snapshot', async () => {
    const fetcher = {
      calls: 0,
      fetch: vi.fn(),
    };
    fetcher.fetch.mockResolvedValueOnce([FIXTURE_THERMAREST]);
    fetcher.fetch.mockRejectedValueOnce(new Error('Sheets API down'));

    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    expect(cache.getSnapshot()).toHaveLength(1);

    await expect(cache.refresh()).rejects.toThrow('Sheets API down');
    expect(cache.getSnapshot()).toHaveLength(1); // preserved
  });

  test('start() schedules periodic refresh and stop() cancels it', async () => {
    vi.useFakeTimers();
    const fetcher = makeFetcher([
      [FIXTURE_THERMAREST],
      [FIXTURE_THERMAREST],
      [FIXTURE_THERMAREST, FIXTURE_NO_BRAND],
    ]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.start({ refreshIntervalMs: 1000 });
    expect(fetcher.calls).toBe(1); // initial

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.calls).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.calls).toBe(3);

    cache.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher.calls).toBe(3); // no further calls after stop
    vi.useRealTimers();
  });
});
