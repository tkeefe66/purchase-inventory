import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddgearStateStore } from '../../../lib/addgearState.js';
import { PendingActionStore } from '../../../lib/pendingActions.js';
import {
  startAddgear,
  continueAddgear as continueAddgearRaw,
  type AddgearDeps,
} from '../../../apps/bot/commands/addgear.js';

// Test wrapper that auto-advances past the awaiting-source step — tests in
// this file don't care about source selection.
async function continueAddgear(chatId: string, text: string, deps: AddgearDeps): Promise<string | null> {
  const reply = await continueAddgearRaw(chatId, text, deps);
  if (deps.addgearState.peek(chatId)?.kind === 'awaiting-source') {
    return await continueAddgearRaw(chatId, 'Other', deps);
  }
  return reply;
}
import type { PhotoExtraction } from '../../../lib/parsers/photo.js';
import type { Classification } from '../../../lib/classifier.js';

// Mock saveItemImage so tests don't touch the filesystem.
vi.mock('../../../lib/integrations/image-storage.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/integrations/image-storage.js')>();
  return {
    ...original,
    saveItemImage: vi.fn(async () => ({ ok: true as const, path: '/images/test123.jpg' })),
  };
});

function makeRow(opts: { image?: string; orderId?: string; productUrl?: string; itemName?: string } = {}) {
  return {
    brand: 'Patagonia',
    itemName: opts.itemName ?? 'Houdini Jacket',
    image: opts.image ?? '',
    orderId: opts.orderId ?? 'ORD-456',
    productUrl: opts.productUrl ?? 'https://patagonia.com/houdini',
  };
}

function makeDeps(overrides: Partial<AddgearDeps> = {}): AddgearDeps {
  const addgearState = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
  const pendingActions = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
  return {
    addgearState,
    pendingActions,
    today: () => '2026-05-19',
    downloadPhoto: vi.fn(async (_fileId: string) => ({
      bytes: Buffer.from('FAKE_PHOTO'),
      mediaType: 'image/jpeg' as const,
    })),
    extractFromPhoto: vi.fn(async (): Promise<PhotoExtraction> => ({
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
    lookupProduct: vi.fn(async () => []),
    fetchProductName: vi.fn(async () => null),
    fetchProductInfo: vi.fn(async () => null),
    listExistingRows: vi.fn(() => []),
    updateImageOnExisting: vi.fn(async () => {}),
    ...overrides,
  };
}

/** Walk past the awaiting-product-pick step with 'skip'. */
async function startAndSkipPick(
  chatId: string,
  deps: AddgearDeps,
): Promise<string> {
  await startAddgear(chatId, 'FILE-1', '/addgear ~2018 ~$120', deps);
  return (await continueAddgear(chatId, 'skip', deps)) ?? '';
}

describe('awaiting-dedup — Attach/Replace label', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('matched row with no image shows "Attach (no image yet)"', async () => {
    const deps = makeDeps({
      listExistingRows: () => [makeRow({ image: '' })],
    });
    const reply = await startAndSkipPick('chat-1', deps);
    expect(reply).toMatch(/similar to existing rows/i);
    expect(reply).toContain('Attach (no image yet)');
    expect(reply).not.toContain('Replace (has image)');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-dedup');
  });

  test('matched row with existing image shows "Replace (has image)"', async () => {
    const deps = makeDeps({
      listExistingRows: () => [makeRow({ image: '/images/existing.jpg' })],
    });
    const reply = await startAndSkipPick('chat-1', deps);
    expect(reply).toMatch(/similar to existing rows/i);
    expect(reply).toContain('Replace (has image)');
    expect(reply).not.toContain('Attach (no image yet)');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-dedup');
  });

  test('mixed candidates show both labels', async () => {
    const deps = makeDeps({
      listExistingRows: () => [
        makeRow({ image: '', itemName: 'Houdini Jacket' }),
        makeRow({ image: '/images/x.jpg', itemName: 'Houdini Jacket v2' }),
      ],
    });
    const reply = await startAndSkipPick('chat-1', deps);
    expect(reply).toContain('Attach (no image yet)');
    expect(reply).toContain('Replace (has image)');
  });
});

describe('awaiting-dedup — numeric pick (Attach/Replace)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('replying "1" calls updateImageOnExisting with correct rowIndex and saved path', async () => {
    const updateImageOnExisting = vi.fn(async () => {});
    const deps = makeDeps({
      listExistingRows: () => [makeRow({ image: '', orderId: 'ORD-456', productUrl: 'https://patagonia.com/houdini' })],
      updateImageOnExisting,
    });
    await startAndSkipPick('chat-1', deps);
    const reply = await continueAddgear('chat-1', '1', deps);

    // rowIndex in the sheet = candidate.rowIndex (0) + 2 = 2
    expect(updateImageOnExisting).toHaveBeenCalledOnce();
    expect(updateImageOnExisting).toHaveBeenCalledWith(2, '/images/test123.jpg');
    // Addgear state should be cleared
    expect(deps.addgearState.peek('chat-1')).toBeNull();
    expect(deps.pendingActions.peek('chat-1')).toBeNull();
    expect(reply).toMatch(/attached to/i);
    expect(reply).toContain('Patagonia');
    expect(reply).toContain('Houdini Jacket');
  });

  test('replying "1" on a row with existing image says "replaced on"', async () => {
    const deps = makeDeps({
      listExistingRows: () => [makeRow({ image: '/images/old.jpg' })],
      updateImageOnExisting: vi.fn(async () => {}),
    });
    await startAndSkipPick('chat-1', deps);
    const reply = await continueAddgear('chat-1', '1', deps);
    expect(reply).toMatch(/replaced on/i);
  });

  test('"add anyway" still works (no regression)', async () => {
    const deps = makeDeps({
      listExistingRows: () => [makeRow({ image: '' })],
      updateImageOnExisting: vi.fn(async () => {}),
    });
    await startAndSkipPick('chat-1', deps);
    const reply = await continueAddgear('chat-1', 'add anyway', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    // updateImageOnExisting should NOT have been called
    expect(deps.updateImageOnExisting).not.toHaveBeenCalled();
  });
});
