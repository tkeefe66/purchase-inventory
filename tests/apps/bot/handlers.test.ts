import { describe, test, expect, vi } from 'vitest';
import { dispatchCommand, type HandlerDeps } from '../../../apps/bot/handlers.js';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import { Stats } from '../../../apps/bot/stats.js';
import { PendingActionStore } from '../../../lib/pendingActions.js';
import { AddgearStateStore } from '../../../lib/addgearState.js';
import { itemId } from '../../../domains/outdoor/types.js';
import type { MasterRow, Status } from '../../../lib/types.js';
import {
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
} from '../../fixtures/outdoor-items.js';

const TODAY = '2026-05-14';

function makeDeps(rows: MasterRow[], overrides: Partial<HandlerDeps> = {}): {
  deps: HandlerDeps;
  cache: InventoryCache;
  updateCalls: { rowIndex: number; newStatus: Status }[];
  appendCalls: MasterRow[];
} {
  const updateCalls: { rowIndex: number; newStatus: Status }[] = [];
  const appendCalls: MasterRow[] = [];
  const cache = new InventoryCache(async () => rows);
  const deps: HandlerDeps = {
    cache,
    stats: new Stats(),
    pendingActions: new PendingActionStore({ ttlMs: 5 * 60 * 1000 }),
    sheets: {} as HandlerDeps['sheets'],
    spreadsheetId: 'TEST',
    anthropic: {} as HandlerDeps['anthropic'],
    updateRowStatus: vi.fn(async (_s, _id, input) => { updateCalls.push(input); }) as unknown as HandlerDeps['updateRowStatus'],
    appendMasterRow: vi.fn(async (_s, _id, row) => { appendCalls.push(row); return { rowIndex: 99 }; }) as unknown as HandlerDeps['appendMasterRow'],
    extractLogDraft: vi.fn() as unknown as HandlerDeps['extractLogDraft'],
    today: () => TODAY,
    addgearState: new AddgearStateStore({ ttlMs: 5 * 60 * 1000 }),
    startAddgear: vi.fn() as unknown as HandlerDeps['startAddgear'],
    continueAddgear: vi.fn() as unknown as HandlerDeps['continueAddgear'],
    addgearInner: {
      downloadPhoto: vi.fn() as unknown as HandlerDeps['addgearInner']['downloadPhoto'],
      extractFromPhoto: vi.fn() as unknown as HandlerDeps['addgearInner']['extractFromPhoto'],
      classify: vi.fn() as unknown as HandlerDeps['addgearInner']['classify'],
      lookupProduct: vi.fn() as unknown as HandlerDeps['addgearInner']['lookupProduct'],
      fetchProductName: vi.fn() as unknown as HandlerDeps['addgearInner']['fetchProductName'],
      fetchProductInfo: vi.fn() as unknown as HandlerDeps['addgearInner']['fetchProductInfo'],
      listExistingRows: () => [],
    },
    runScan: vi.fn() as unknown as HandlerDeps['runScan'],
    camping: {
      readIndex: vi.fn(async () => ({ facilities: [] })),
      readTrips: vi.fn(async () => ({ trips: [] })),
      writeTrips: vi.fn(async () => undefined),
      readMutedIds: vi.fn(async () => []),
      setMuted: vi.fn(async () => undefined),
    },
    ...overrides,
  };
  return { deps, cache, updateCalls, appendCalls };
}

describe('dispatchCommand: non-slash + unknown', () => {
  test('returns null for plain text', async () => {
    const { deps } = makeDeps([FIXTURE_THERMAREST]);
    expect(await dispatchCommand('chat-1', 'hello', deps)).toBeNull();
  });
  test('returns null for unknown command', async () => {
    const { deps } = makeDeps([FIXTURE_THERMAREST]);
    expect(await dispatchCommand('chat-1', '/foo bar', deps)).toBeNull();
  });
});

describe('dispatchCommand: status-change family', () => {
  test('matches a single unambiguous item and flips its status', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    await cache.refresh();
    const out = await dispatchCommand('chat-1', '/retired salomon', deps);
    expect(out).toMatch(/Marked.*Salomon.*retired/i);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.newStatus).toBe('retired');
  });

  test('reports no match and does not write', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const out = await dispatchCommand('chat-1', '/lost nonexistent zzz', deps);
    expect(out).toMatch(/no match|couldn't find/i);
    expect(updateCalls).toHaveLength(0);
  });

  test('lists matches when ambiguous and asks the user to specify by id', async () => {
    const dup: MasterRow = { ...FIXTURE_THERMAREST, color: 'Blue', orderId: 'DUP-1' };
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST, dup]);
    await cache.refresh();
    const out = await dispatchCommand('chat-1', '/lost sleeping', deps);
    expect(out).toMatch(/multiple|more than one/i);
    expect(out).toMatch(new RegExp(itemId(FIXTURE_THERMAREST)));
    expect(out).toMatch(new RegExp(itemId(dup)));
    expect(updateCalls).toHaveLength(0);
  });

  test('accepts a 6-char id argument and resolves directly', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const out = await dispatchCommand('chat-1', `/sold ${itemId(FIXTURE_THERMAREST)}`, deps);
    expect(out).toMatch(/sold/i);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.newStatus).toBe('sold');
  });

  test('/broken /donated /lost all route through the same status-change path', async () => {
    for (const cmd of ['broken', 'donated', 'lost']) {
      const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
      await cache.refresh();
      await dispatchCommand('chat-1', `/${cmd} therm`, deps);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]?.newStatus).toBe(cmd as Status);
    }
  });
});

describe('dispatchCommand: /log + /confirm + /cancel', () => {
  test('/log with no extraction result reports a parse error', async () => {
    const extract = vi.fn(async () => null);
    const { deps } = makeDeps([FIXTURE_THERMAREST], { extractLogDraft: extract as unknown as HandlerDeps['extractLogDraft'] });
    const out = await dispatchCommand('chat-1', '/log gibberish', deps);
    expect(out).toMatch(/couldn't extract|parse/i);
  });

  test('/log stores a pending action and replies with a preview asking for /confirm', async () => {
    const extract = vi.fn(async () => ({
      itemName: 'Couloir', brand: 'Black Diamond', price: 80, source: 'REI' as const,
      date: '2026-05-14', category: 'Climbing', subCategory: 'Harness',
      color: '', size: 'M', type: 'Gear' as const,
    }));
    const { deps, appendCalls } = makeDeps([FIXTURE_THERMAREST], { extractLogDraft: extract as unknown as HandlerDeps['extractLogDraft'] });
    const out = await dispatchCommand('chat-1', '/log Black Diamond Couloir harness, $80, REI', deps);
    expect(out).toMatch(/about to log|preview|confirm/i);
    expect(out).toMatch(/^Item: Couloir$/m);
    expect(out).toMatch(/^Brand: Black Diamond$/m);
    expect(out).toMatch(/\$80/);
    expect(appendCalls).toHaveLength(0);
    expect(deps.pendingActions.peek('chat-1')).not.toBeNull();
  });

  test('/confirm with a pending /log appends the row and clears the pending action', async () => {
    const draft = {
      itemName: 'Couloir', brand: 'Black Diamond', price: 80, source: 'REI' as const,
      date: '2026-05-14', category: 'Climbing', subCategory: 'Harness',
      color: '', size: 'M', type: 'Gear' as const,
    };
    const extract = vi.fn(async () => draft);
    const { deps, appendCalls } = makeDeps([FIXTURE_THERMAREST], { extractLogDraft: extract as unknown as HandlerDeps['extractLogDraft'] });
    await dispatchCommand('chat-1', '/log whatever', deps);
    const out = await dispatchCommand('chat-1', '/confirm', deps);
    expect(out).toMatch(/logged|appended/i);
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]?.itemName).toBe('Couloir');
    expect(deps.pendingActions.peek('chat-1')).toBeNull();
  });

  test('/confirm with no pending action says so', async () => {
    const { deps, appendCalls } = makeDeps([FIXTURE_THERMAREST]);
    const out = await dispatchCommand('chat-1', '/confirm', deps);
    expect(out).toMatch(/nothing to confirm|no pending/i);
    expect(appendCalls).toHaveLength(0);
  });

  test('/cancel discards a pending /log', async () => {
    const draft = {
      itemName: 'X', brand: '', price: 1, source: 'REI' as const, date: '2026-05-14',
      category: '', subCategory: '', color: '', size: '', type: 'Gear' as const,
    };
    const extract = vi.fn(async () => draft);
    const { deps, appendCalls } = makeDeps([FIXTURE_THERMAREST], { extractLogDraft: extract as unknown as HandlerDeps['extractLogDraft'] });
    await dispatchCommand('chat-1', '/log X', deps);
    const out = await dispatchCommand('chat-1', '/cancel', deps);
    expect(out).toMatch(/cancel|discard/i);
    expect(appendCalls).toHaveLength(0);
    expect(deps.pendingActions.peek('chat-1')).toBeNull();
  });
});

describe('dispatchCommand: /stats + /refresh', () => {
  test('/stats returns the formatStats output', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON, FIXTURE_NO_BRAND]);
    await cache.refresh();
    const out = await dispatchCommand('chat-1', '/stats', deps);
    expect(out).toMatch(/Inventory/);
    expect(out).toMatch(/Threshold status/);
  });

  test('/refresh forces a refetch and reports the row count', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    await cache.refresh();
    const out = await dispatchCommand('chat-1', '/refresh', deps);
    expect(out).toMatch(/Refreshed|reloaded/i);
    expect(out).toMatch(/2/);
  });
});

describe('dispatchCommand: /scan', () => {
  test('reports summary when the pipeline adds items', async () => {
    const { deps, cache } = makeDeps([]);
    await cache.refresh();
    const fakeResult = {
      startedAt: '', endedAt: '',
      messagesScanned: 3, itemsAdded: 1,
      itemsBySource: { Amazon: 1 }, itemsByDomain: { Home: 1 },
      skippedNonReceipts: 1, duplicatesIgnored: 1,
      labelsApplied: 3, returnsApplied: 0, returnsUnmatched: 0,
      errors: [], dryRun: false,
    };
    deps.runScan = vi.fn(async () => fakeResult) as unknown as HandlerDeps['runScan'];
    const out = await dispatchCommand('chat-1', '/scan', deps);
    expect(out).toMatch(/Inbox scan complete/);
    expect(out).toMatch(/1 new item/);
    expect(out).toMatch(/Amazon: 1/);
    expect(out).toMatch(/3 emails scanned/);
  });

  test('reports "no new items" when itemsAdded=0', async () => {
    const { deps } = makeDeps([]);
    const fakeResult = {
      startedAt: '', endedAt: '',
      messagesScanned: 0, itemsAdded: 0,
      itemsBySource: {}, itemsByDomain: {},
      skippedNonReceipts: 0, duplicatesIgnored: 0,
      labelsApplied: 0, returnsApplied: 0, returnsUnmatched: 0,
      errors: [], dryRun: false,
    };
    deps.runScan = vi.fn(async () => fakeResult) as unknown as HandlerDeps['runScan'];
    const out = await dispatchCommand('chat-1', '/scan', deps);
    expect(out).toMatch(/No new items/);
  });

  test('surfaces returns and errors', async () => {
    const { deps } = makeDeps([]);
    const fakeResult = {
      startedAt: '', endedAt: '',
      messagesScanned: 2, itemsAdded: 0,
      itemsBySource: {}, itemsByDomain: {},
      skippedNonReceipts: 0, duplicatesIgnored: 0,
      labelsApplied: 2, returnsApplied: 1, returnsUnmatched: 1,
      errors: [{ messageId: 'x', subject: 'y', error: 'z' }], dryRun: false,
    };
    deps.runScan = vi.fn(async () => fakeResult) as unknown as HandlerDeps['runScan'];
    const out = await dispatchCommand('chat-1', '/scan', deps);
    expect(out).toMatch(/1 row marked returned/);
    expect(out).toMatch(/1 return\(s\) couldn't be matched/);
    expect(out).toMatch(/1 error/);
  });

  test('returns a friendly error if the pipeline throws', async () => {
    const { deps } = makeDeps([]);
    deps.runScan = vi.fn(async () => { throw new Error('oauth expired'); }) as unknown as HandlerDeps['runScan'];
    const out = await dispatchCommand('chat-1', '/scan', deps);
    expect(out).toMatch(/Scan failed: oauth expired/);
  });
});

describe('dispatchCommand: /help', () => {
  test('lists the major commands and links to the sheet', async () => {
    const { deps } = makeDeps([]);
    const out = await dispatchCommand('chat-1', '/help', deps);
    expect(out).not.toBeNull();
    expect(out).toContain('/addgear');
    expect(out).toContain('/log');
    expect(out).toContain('/confirm');
    expect(out).toContain('/cancel');
    expect(out).toContain('/scan');
    expect(out).toContain('/stats');
    expect(out).toContain('/refresh');
    expect(out).toContain(`https://docs.google.com/spreadsheets/d/${deps.spreadsheetId}/edit`);
  });
});
