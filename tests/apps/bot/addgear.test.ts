import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddgearStateStore } from '../../../lib/addgearState.js';
import { PendingActionStore } from '../../../lib/pendingActions.js';
import { startAddgear, continueAddgear, type AddgearDeps } from '../../../apps/bot/commands/addgear.js';
import type { PhotoExtraction } from '../../../lib/parsers/photo.js';
import type { Classification } from '../../../lib/classifier.js';

function makeDeps(overrides: Partial<AddgearDeps> = {}): AddgearDeps {
  const addgearState = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
  const pendingActions = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
  return {
    addgearState,
    pendingActions,
    today: () => '2026-05-14',
    downloadPhoto: vi.fn(async (_fileId: string) => Buffer.from('FAKE')),
    extractFromPhoto: vi.fn(async (_buf: Buffer, _caption: string): Promise<PhotoExtraction | null> => ({
      brand: 'Patagonia',
      itemName: 'Houdini Jacket',
      color: 'Blue',
      size: 'M',
      confidence: { brand: 'high', itemName: 'high', color: 'high', size: 'high' },
    })),
    classify: vi.fn(async (): Promise<Classification> => ({
      domain: 'Outdoor',
      type: 'Gear',
      category: 'Hiking Gear',
      subCategory: 'Wind Shell',
      brand: 'Patagonia',
      reasoning: 'classified',
    })),
    listExistingRows: vi.fn((): readonly { brand: string; itemName: string }[] => []),
    randomHash: () => 'abc123',
    ...overrides,
  };
}

describe('startAddgear — vision extracts everything', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('with vision filling all fields and caption "~2018 ~$120", lands in awaiting-confirm', async () => {
    const deps = makeDeps();
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/About to log/i);
    expect(reply).toContain('Patagonia');
    expect(reply).toContain('Houdini Jacket');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
  });
});

describe('startAddgear — missing date triggers prompt', () => {
  test('with no caption hints, asks for date', async () => {
    const deps = makeDeps();
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    expect(reply).toMatch(/when did you buy it/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-date');
  });

  test('user replies with a year and flow advances to awaiting-price', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', '2018', deps);
    expect(reply).toMatch(/what did you pay/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-price');
    if (step?.kind === 'awaiting-price') {
      expect(step.draft.date).toBe('2018-01-01');
    }
  });
});

describe('startAddgear — missing price triggers prompt after date', () => {
  test('user replies with a price and flow advances to confirm', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    await continueAddgear('chat-1', '2018', deps);
    const reply = await continueAddgear('chat-1', '120', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.price).toBe(120);
      expect(step.row.source).toBe('Image');
      expect(step.row.orderId).toMatch(/^IMG-20260514-/);
    }
  });

  test('user replies "unknown" for price and flow advances to confirm', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    await continueAddgear('chat-1', '2018', deps);
    const reply = await continueAddgear('chat-1', 'unknown', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.price).toBe(0);
    }
  });
});

describe('startAddgear — fuzzy dedup match', () => {
  test('warns when a similar row exists', async () => {
    const deps = makeDeps({
      listExistingRows: () => [{ brand: 'Patagonia', itemName: 'Houdini Jacket' }],
    });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/similar to existing rows/i);
    expect(reply).toContain('Patagonia');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-dedup');
  });

  test('user replies "add anyway" and flow advances to confirm', async () => {
    const deps = makeDeps({
      listExistingRows: () => [{ brand: 'Patagonia', itemName: 'Houdini Jacket' }],
    });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'add anyway', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
  });
});

describe('continueAddgear — confirm, correct, cancel', () => {
  test('"yes" parks the row in pendingActions and clears addgearState', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'yes', deps);
    expect(reply).toMatch(/Reply \/confirm to write/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
    expect(deps.pendingActions.peek('chat-1')).not.toBeNull();
  });

  test('"color: red" patches the draft and re-shows', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'color: red', deps);
    expect(reply).toContain('red');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.color).toBe('red');
    }
  });

  test('"/cancel" clears the state', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', '/cancel', deps);
    expect(reply).toMatch(/cancelled/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
  });
});

describe('startAddgear — vision cannot read', () => {
  test('returns a helpful error and does not set state', async () => {
    const deps = makeDeps({
      extractFromPhoto: vi.fn(async () => ({
        brand: '', itemName: '', color: '', size: '',
        confidence: { brand: 'missing', itemName: 'missing', color: 'missing', size: 'missing' } as const,
      })),
    });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    expect(reply).toMatch(/couldn't read/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
  });

  test('returns a helpful error when vision call itself returns null', async () => {
    const deps = makeDeps({
      extractFromPhoto: vi.fn(async () => null),
    });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    expect(reply).toMatch(/couldn't read/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
  });
});
