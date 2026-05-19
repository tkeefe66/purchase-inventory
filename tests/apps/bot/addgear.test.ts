import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddgearStateStore } from '../../../lib/addgearState.js';
import { PendingActionStore } from '../../../lib/pendingActions.js';
import { startAddgear, continueAddgear, parseUserDate, extractDatePrefix, extractPrice, parseCaptionHints, type AddgearDeps } from '../../../apps/bot/commands/addgear.js';
import type { PhotoExtraction } from '../../../lib/parsers/photo.js';
import type { ProductCandidate } from '../../../lib/parsers/product-lookup.js';
import type { Classification } from '../../../lib/classifier.js';

// Mock saveItemImage at the module level so tests don't touch the filesystem.
vi.mock('../../../lib/integrations/image-storage.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../lib/integrations/image-storage.js')>();
  return {
    ...original,
    saveItemImage: vi.fn(async () => ({ ok: true as const, path: '/images/abc123def456.jpg' })),
  };
});

function makeDeps(overrides: Partial<AddgearDeps> = {}): AddgearDeps {
  const addgearState = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
  const pendingActions = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
  return {
    addgearState,
    pendingActions,
    today: () => '2026-05-14',
    downloadPhoto: vi.fn(async (_fileId: string) => ({
      bytes: Buffer.from('FAKE'),
      mediaType: 'image/jpeg' as const,
    })),
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
    // Default: lookup returns no candidates → user lands in awaiting-product-pick.
    // Tests that focus on downstream states (date / price / confirm) should use
    // startAddgearSkippingPick() to walk past the pick step.
    lookupProduct: vi.fn(async () => []),
    // Default: name refinement returns null (no change). Tests that exercise
    // refinement override with a function that returns the desired name.
    fetchProductName: vi.fn(async () => null),
    // Default: URL parser returns null (no URL in caption in most tests). Tests
    // that exercise the URL-in-caption flow override with a real return value.
    fetchProductInfo: vi.fn(async () => null),
    ...overrides,
  };
}

/**
 * Helper for tests that don't care about the product-pick step. Calls startAddgear
 * then immediately replies "skip" so the flow advances to date / price / confirm.
 */
async function startAddgearSkippingPick(
  chatId: string,
  photoFileId: string,
  caption: string,
  deps: AddgearDeps,
): Promise<string> {
  await startAddgear(chatId, photoFileId, caption, deps);
  const reply = await continueAddgear(chatId, 'skip', deps);
  return reply ?? '';
}

describe('startAddgear — vision extracts everything', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('with vision filling all fields and caption "~2018 ~$120", lands in awaiting-confirm', async () => {
    const deps = makeDeps();
    const reply = await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/About to log/i);
    expect(reply).toContain('Patagonia');
    expect(reply).toContain('Houdini Jacket');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
  });

  test('preview renders one labeled field per line (Item / Brand / Price / …)', async () => {
    const deps = makeDeps();
    const reply = await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    // Each field gets its own line; labels match the 'field: value' edit keys
    // so the preview doubles as a cheat-sheet.
    expect(reply).toMatch(/^Item: Houdini Jacket$/m);
    expect(reply).toMatch(/^Brand: Patagonia$/m);
    expect(reply).toMatch(/^Color: Blue$/m);
    expect(reply).toMatch(/^Size: M$/m);
    expect(reply).toMatch(/^Price: \$120$/m);
    expect(reply).toMatch(/^Date: 2018-01-01$/m);
    expect(reply).toMatch(/^Source: Image$/m);
    expect(reply).toMatch(/^Category: Hiking Gear$/m);
    expect(reply).toMatch(/^Sub-Category: Wind Shell$/m);
    expect(reply).toMatch(/^Domain: Outdoor$/m);
    expect(reply).toMatch(/^Type: Gear$/m);
  });
});

describe('startAddgear — missing date triggers prompt', () => {
  test('with no caption hints, asks for date', async () => {
    const deps = makeDeps();
    const reply = await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    expect(reply).toMatch(/when did you buy it/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-date');
  });

  test('user replies with a year and flow advances to awaiting-price', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
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
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    await continueAddgear('chat-1', '2018', deps);
    const reply = await continueAddgear('chat-1', '120', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { price: any } }).row.price)).toBe(120);
      expect(((step as { row: { source: any } }).row.source)).toBe('Image');
      expect(((step as { row: { orderId: any } }).row.orderId)).toMatch(/^IMG-20260514-/);
    }
  });

  test('user replies "unknown" for price and flow advances to confirm', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    await continueAddgear('chat-1', '2018', deps);
    const reply = await continueAddgear('chat-1', 'unknown', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { price: any } }).row.price)).toBe(0);
    }
  });
});

describe('startAddgear — fuzzy dedup match', () => {
  test('warns when a similar row exists', async () => {
    const deps = makeDeps({
      listExistingRows: () => [{ brand: 'Patagonia', itemName: 'Houdini Jacket' }],
    });
    const reply = await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/similar to existing rows/i);
    expect(reply).toContain('Patagonia');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-dedup');
  });

  test('user replies "add anyway" and flow advances to confirm', async () => {
    const deps = makeDeps({
      listExistingRows: () => [{ brand: 'Patagonia', itemName: 'Houdini Jacket' }],
    });
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'add anyway', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
  });
});

describe('continueAddgear — confirm, correct, cancel', () => {
  test('row is pre-parked in pendingActions when awaiting-confirm is reached', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(deps.addgearState.peek('chat-1')?.kind).toBe('awaiting-confirm');
    const pending = deps.pendingActions.peek('chat-1');
    expect(pending).not.toBeNull();
    expect(((pending && pending.type === 'log-append') ? ((pending as { row: { source: any } }).row.source) : undefined)).toBe('Image');
    expect(((pending && pending.type === 'log-append') ? ((pending as { row: { brand: any } }).row.brand) : undefined)).toBe('Patagonia');
  });

  test('"yes" alias points the user at /confirm (does not write directly)', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'yes', deps);
    expect(reply).toMatch(/\/confirm/);
    // Row is still parked, state is still awaiting-confirm — user just needs to type /confirm
    expect(deps.addgearState.peek('chat-1')?.kind).toBe('awaiting-confirm');
    expect(deps.pendingActions.peek('chat-1')).not.toBeNull();
  });

  test('"color: red" patches the row and re-parks the new version', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'color: red', deps);
    expect(reply).toContain('red');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { color: any } }).row.color)).toBe('red');
    }
    // Pending action reflects the corrected row, not the original
    const pending = deps.pendingActions.peek('chat-1');
    expect(((pending && pending.type === 'log-append') ? ((pending as { row: { color: any } }).row.color) : undefined)).toBe('red');
  });

  test('"/cancel" clears both state stores', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    // Pre-condition: both stores populated
    expect(deps.pendingActions.peek('chat-1')).not.toBeNull();
    const reply = await continueAddgear('chat-1', '/cancel', deps);
    expect(reply).toMatch(/cancelled/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
    expect(deps.pendingActions.peek('chat-1')).toBeNull();
  });
});

describe('startAddgear — image persistence via saveItemImage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('row.image is set to the /images/... path when imageBytes are present', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.image).toMatch(/^\/images\//);
    }
  });

  test('row.image is empty string when saveItemImage returns ok:false', async () => {
    const { saveItemImage: mockSave } = await import('../../../lib/integrations/image-storage.js');
    vi.mocked(mockSave).mockResolvedValueOnce({ ok: false, error: 'too_large' });

    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-2', '/addgear ~2018 ~$120', deps);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.image).toBe('');
    }
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

describe('parseUserDate', () => {
  test('year-only → Jan 1', () => {
    expect(parseUserDate('2018')).toBe('2018-01-01');
  });

  test('ISO date is preserved', () => {
    expect(parseUserDate('2018-06-15')).toBe('2018-06-15');
  });

  test('US slash with 2-digit year', () => {
    expect(parseUserDate('12/21/23')).toBe('2023-12-21');
  });

  test('US slash with 4-digit year', () => {
    expect(parseUserDate('12/21/2023')).toBe('2023-12-21');
  });

  test('US dash with 2-digit year', () => {
    expect(parseUserDate('5-7-24')).toBe('2024-05-07');
  });

  test('spelled-out month full + day + year', () => {
    expect(parseUserDate('May 5 2023')).toBe('2023-05-05');
  });

  test('spelled-out month full + day + comma + year', () => {
    expect(parseUserDate('May 5, 2023')).toBe('2023-05-05');
  });

  test('abbreviated month with period + day + year', () => {
    expect(parseUserDate('Sept. 12 2019')).toBe('2019-09-12');
  });

  test('month-only + year defaults to the 1st', () => {
    expect(parseUserDate('May 2023')).toBe('2023-05-01');
  });

  test('case-insensitive month name', () => {
    expect(parseUserDate('DECEMBER 3 2020')).toBe('2020-12-03');
  });

  test('invalid month number → null', () => {
    expect(parseUserDate('13/21/2023')).toBeNull();
  });

  test('invalid day number → null', () => {
    expect(parseUserDate('5/32/2023')).toBeNull();
  });

  test('unknown month name → null', () => {
    expect(parseUserDate('Mayyy 5 2023')).toBeNull();
  });

  test('empty string → null', () => {
    expect(parseUserDate('')).toBeNull();
  });

  test('random text → null', () => {
    expect(parseUserDate('two thousand twenty-three')).toBeNull();
  });
});

describe('parseCaptionHints', () => {
  test('natural date + $ price ("12-11-21 $135.15")', () => {
    const h = parseCaptionHints('12-11-21 $135.15');
    expect(h.date).toBe('2021-12-11');
    expect(h.price).toBe(135.15);
    expect(h.rest).toBe('');
  });

  test('natural date + bare price ("12-11-21 135.15")', () => {
    const h = parseCaptionHints('12-11-21 135.15');
    expect(h.date).toBe('2021-12-11');
    expect(h.price).toBe(135.15);
  });

  test('spelled-month + $ price ("May 5 2023 $99")', () => {
    const h = parseCaptionHints('May 5 2023 $99');
    expect(h.date).toBe('2023-05-05');
    expect(h.price).toBe(99);
  });

  test('just a date with no price', () => {
    const h = parseCaptionHints('12-11-21');
    expect(h.date).toBe('2021-12-11');
    expect(h.price).toBeUndefined();
  });

  test('just a $ price with no date', () => {
    const h = parseCaptionHints('$135.15');
    expect(h.date).toBeUndefined();
    expect(h.price).toBe(135.15);
  });

  test('legacy tilde format still works', () => {
    const h = parseCaptionHints('~2018 ~$120');
    expect(h.date).toBe('2018-01-01');
    expect(h.price).toBe(120);
  });

  test('caption-only freeform passes through as rest', () => {
    const h = parseCaptionHints('bought at the climbing gym');
    expect(h.date).toBeUndefined();
    expect(h.price).toBeUndefined();
    expect(h.rest).toBe('bought at the climbing gym');
  });

  test('mixed natural date + leftover descriptive text', () => {
    const h = parseCaptionHints('2018 from a friend');
    expect(h.date).toBe('2018-01-01');
    expect(h.rest).toContain('from a friend');
  });
});

describe('extractDatePrefix + extractPrice', () => {
  test('extractDatePrefix returns date and remaining text', () => {
    expect(extractDatePrefix('12-11-21 for 135.15')).toEqual({ date: '2021-12-11', rest: 'for 135.15' });
    expect(extractDatePrefix('May 5 2023 $99')).toEqual({ date: '2023-05-05', rest: '$99' });
    expect(extractDatePrefix('2018 paid $120')).toEqual({ date: '2018-01-01', rest: 'paid $120' });
    expect(extractDatePrefix('2018-06-15')).toEqual({ date: '2018-06-15', rest: '' });
  });

  test('extractDatePrefix returns null when no date at the start', () => {
    expect(extractDatePrefix('lol no date here')).toBeNull();
    expect(extractDatePrefix('')).toBeNull();
    expect(extractDatePrefix('$120')).toBeNull();
  });

  test('extractPrice handles decimals, dollar signs, and connector words', () => {
    expect(extractPrice('135.15')).toBe(135.15);
    expect(extractPrice('$135.15')).toBe(135.15);
    expect(extractPrice('for 135.15')).toBe(135.15);
    expect(extractPrice('for $135.15')).toBe(135.15);
    expect(extractPrice('paid 120')).toBe(120);
    expect(extractPrice('$1500')).toBe(1500);
  });

  test('extractPrice rejects bare 4-digit years', () => {
    expect(extractPrice('2018')).toBeNull();
    expect(extractPrice('1999')).toBeNull();
  });

  test('extractPrice rejects garbage', () => {
    expect(extractPrice('lol')).toBeNull();
    expect(extractPrice('')).toBeNull();
  });
});

describe('continueAddgear — combined date+price during awaiting-date', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('accepts "12-11-21 for 135.15" — sets date AND price, skips awaiting-price', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', '12-11-21 for 135.15', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { date: any } }).row.date)).toBe('2021-12-11');
      expect(((step as { row: { price: any } }).row.price)).toBe(135.15);
    }
  });

  test('accepts "May 5 2023 $99" — sets date AND price', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', 'May 5 2023 $99', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { date: any } }).row.date)).toBe('2023-05-05');
      expect(((step as { row: { price: any } }).row.price)).toBe(99);
    }
  });

  test('plain date still works — advances to awaiting-price', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', '12-11-21', deps);
    expect(reply).toMatch(/what did you pay/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-price');
    if (step?.kind === 'awaiting-price') {
      expect(step.draft.date).toBe('2021-12-11');
    }
  });
});

describe('continueAddgear — looser price parsing during awaiting-price', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('accepts "$135.15"', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    await continueAddgear('chat-1', '2021', deps);
    await continueAddgear('chat-1', '$135.15', deps);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { price: any } }).row.price)).toBe(135.15);
    }
  });

  test('accepts "for 120"', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    await continueAddgear('chat-1', '2021', deps);
    await continueAddgear('chat-1', 'for 120', deps);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { price: any } }).row.price)).toBe(120);
    }
  });
});

describe('continueAddgear — date input variations during awaiting-date', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('accepts slash date "12/21/23"', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', '12/21/23', deps);
    expect(reply).toMatch(/what did you pay/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-price');
    if (step?.kind === 'awaiting-price') {
      expect(step.draft.date).toBe('2023-12-21');
    }
  });

  test('accepts spelled-out date "May 5 2023"', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', 'May 5 2023', deps);
    expect(reply).toMatch(/what did you pay/i);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-price') {
      expect(step.draft.date).toBe('2023-05-05');
    }
  });

  test('rejects garbage with a helpful hint', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', 'lol idk', deps);
    expect(reply).toMatch(/couldn't read/i);
    expect(reply).toMatch(/12\/21\/23|May 5 2023/);
    // still in awaiting-date (we don't advance on bad input)
    expect(deps.addgearState.peek('chat-1')?.kind).toBe('awaiting-date');
  });
});

describe('startAddgear — caption price hints across the year-range', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('dollar-prefixed $1500 is parsed as a price (not skipped as year-like)', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2019 ~$1500', deps);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { price: any } }).row.price)).toBe(1500);
      expect(((step as { row: { date: any } }).row.date)).toBe('2019-01-01');
    }
  });

  test('bare 2018 (no dollar sign) is treated as a year, not a price', async () => {
    const deps = makeDeps();
    const reply = await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018', deps);
    // year filled, price still missing → flow stops at awaiting-price
    expect(reply).toMatch(/what did you pay/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-price');
    if (step?.kind === 'awaiting-price') {
      expect(step.draft.date).toBe('2018-01-01');
      expect(step.draft.price).toBeNull();
    }
  });
});

describe('startAddgear — product lookup populates URL candidates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  const twoCandidates: ProductCandidate[] = [
    {
      itemName: 'Houdini Jacket',
      productUrl: 'https://www.patagonia.com/product/mens-houdini-jacket/24142.html',
      source: 'patagonia.com',
    },
    {
      itemName: 'Houdini Air Jacket',
      productUrl: 'https://www.rei.com/product/123456/patagonia-houdini-air-jacket-mens',
      source: 'rei.com',
    },
  ];

  test('when lookup returns candidates, bot enters awaiting-product-pick', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => twoCandidates) });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/closest product matches/i);
    expect(reply).toContain('Houdini Jacket');
    expect(reply).toContain('patagonia.com');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-product-pick');
  });

  test('picking "1" sets canonical name + URL and advances to confirm', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => twoCandidates) });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', '1', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { itemName: any } }).row.itemName)).toBe('Houdini Jacket');
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toBe(twoCandidates[0]!.productUrl);
    }
  });

  test('pasting a URL stores it and refines the item name from the page', async () => {
    const deps = makeDeps({
      lookupProduct: vi.fn(async () => twoCandidates),
      fetchProductName: vi.fn(async (url: string) => {
        // Simulates a real page fetch that returns the canonical name.
        if (url.includes('example.com')) return "Bean Boots Men's 8\" Insulated";
        return null;
      }),
    });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'https://example.com/my-thing', deps);
    expect(reply).toMatch(/About to log/i);
    expect(reply).toContain("Bean Boots Men's 8\" Insulated");
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toBe('https://example.com/my-thing');
      expect(((step as { row: { itemName: any } }).row.itemName)).toBe("Bean Boots Men's 8\" Insulated");
    }
  });

  test('pasting a URL with failed name fetch keeps the vision item name', async () => {
    const deps = makeDeps({
      lookupProduct: vi.fn(async () => twoCandidates),
      fetchProductName: vi.fn(async () => null),
    });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    await continueAddgear('chat-1', 'https://example.com/my-thing', deps);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toBe('https://example.com/my-thing');
      expect(((step as { row: { itemName: any } }).row.itemName)).toBe('Houdini Jacket');  // vision's value, unchanged
    }
  });

  test('"skip" leaves URL blank, keeps vision item name', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => twoCandidates) });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'skip', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toBe('');
    }
  });

  test('invalid pick (e.g. "5" when there are 2 candidates) re-prompts', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => twoCandidates) });
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', '5', deps);
    expect(reply).toMatch(/pick 1, 2, or 3/i);
    expect(deps.addgearState.peek('chat-1')?.kind).toBe('awaiting-product-pick');
  });

  test('garbage reply re-prompts with options', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => twoCandidates) });
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', 'lol', deps);
    expect(reply).toMatch(/pick 1, 2, or 3/i);
    expect(deps.addgearState.peek('chat-1')?.kind).toBe('awaiting-product-pick');
  });

  test('when lookup returns no candidates, still enters awaiting-product-pick (URL paste / skip)', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => []) });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/couldn't find a confident product page/i);
    expect(reply).toMatch(/paste a product url/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-product-pick');
  });

  test('no-candidates state: "skip" advances to confirm with blank URL', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => []) });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'skip', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toBe('');
    }
  });

  test('no-candidates state: pasting a URL sets productUrl and advances', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => []) });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'https://llbean.com/bean-boots', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toBe('https://llbean.com/bean-boots');
    }
  });

  test('no-candidates state: replying "1" tells user to paste a URL', async () => {
    const deps = makeDeps({ lookupProduct: vi.fn(async () => []) });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', '1', deps);
    expect(reply).toMatch(/no candidates were found/i);
    expect(deps.addgearState.peek('chat-1')?.kind).toBe('awaiting-product-pick');
  });

  test('lookup throws → caught upstream, flow enters awaiting-product-pick with 0 candidates', async () => {
    const deps = makeDeps({
      lookupProduct: vi.fn(async () => { throw new Error('search service down'); }),
    });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/couldn't find a confident product page/i);
    expect(deps.addgearState.peek('chat-1')?.kind).toBe('awaiting-product-pick');
  });
});

describe('startAddgear — natural caption hints reach awaiting-confirm directly', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('"/addgear 12-11-21 $135.15" skips date and price prompts entirely', async () => {
    const deps = makeDeps();
    const reply = await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear 12-11-21 $135.15', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { date: any } }).row.date)).toBe('2021-12-11');
      expect(((step as { row: { year: any } }).row.year)).toBe('2021');
      expect(((step as { row: { price: any } }).row.price)).toBe(135.15);
    }
  });

  test('vision-extracted date+price (caption parser missed them) still populate the draft', async () => {
    // Simulates "/addgear LL Bean 12-11-21 $135.15": regex caption parser
    // catches the price but misses the date (LL Bean prefix), so vision
    // returns the resolved date itself.
    const deps = makeDeps({
      extractFromPhoto: vi.fn(async (): Promise<PhotoExtraction> => ({
        brand: 'L.L.Bean',
        itemName: 'Bean Boot',
        color: 'Brown',
        size: '10',
        date: '2021-12-11',
        price: 135.15,
        confidence: { brand: 'high', itemName: 'high', color: 'high', size: 'high' },
      })),
    });
    const reply = await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear LL Bean 12-11-21 $135.15', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { date: any } }).row.date)).toBe('2021-12-11');
      expect(((step as { row: { price: any } }).row.price)).toBe(135.15);
      expect(((step as { row: { brand: any } }).row.brand)).toBe('L.L.Bean');
    }
  });
});

describe('continueAddgear — url field correction at awaiting-confirm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('"url: https://..." updates productUrl', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'url: https://patagonia.com/x', deps);
    expect(reply).toContain('patagonia.com');
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toBe('https://patagonia.com/x');
    }
  });

  test('"url: clear" blanks the productUrl', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    await continueAddgear('chat-1', 'url: https://example.com/foo', deps);
    await continueAddgear('chat-1', 'url: clear', deps);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toBe('');
    }
  });

  test('"url: not-a-url" is rejected', async () => {
    const deps = makeDeps();
    await startAddgearSkippingPick('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'url: just-some-text', deps);
    expect(reply).toMatch(/must start with http/i);
  });
});

describe('startAddgear — URL pasted in caption (fast path: skip product-pick)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('URL + vision succeed → uses URL data, skips product-pick', async () => {
    const fetchInfo = vi.fn(async () => ({
      brand: 'Grass Sticks',
      itemName: 'Original Bamboo Ski Poles - Pair',
    }));
    const lookup = vi.fn(async () => []);
    const deps = makeDeps({
      fetchProductInfo: fetchInfo,
      lookupProduct: lookup,
      // Vision can't read bamboo — returns minimal data.
      extractFromPhoto: vi.fn(async (): Promise<PhotoExtraction> => ({
        brand: '', itemName: '', color: 'natural', size: '',
        confidence: { brand: 'missing', itemName: 'missing', color: 'low', size: 'missing' },
      })),
    });
    const reply = await startAddgear(
      'chat-1', 'FILE-1',
      '/addgear ~2018 ~$120 https://www.rei.com/product/163187/grass-sticks-original-bamboo-ski-poles-pair',
      deps,
    );
    // Goes straight to preview — no product-pick step.
    expect(reply).toMatch(/About to log/i);
    expect(fetchInfo).toHaveBeenCalledOnce();
    expect(lookup).not.toHaveBeenCalled();
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(((step as { row: { brand: any } }).row.brand)).toBe('Grass Sticks');
      expect(((step as { row: { itemName: any } }).row.itemName)).toBe('Original Bamboo Ski Poles - Pair');
      expect(((step as { row: { productUrl: any } }).row.productUrl)).toContain('rei.com');
      expect(((step as { row: { color: any } }).row.color)).toBe('natural'); // vision contributed color
    }
  });

  test('URL succeeds + vision returns nothing → still proceeds (no bail)', async () => {
    const deps = makeDeps({
      fetchProductInfo: vi.fn(async () => ({
        brand: 'Grass Sticks',
        itemName: 'Original Bamboo Ski Poles',
      })),
      extractFromPhoto: vi.fn(async () => null),
    });
    const reply = await startAddgear(
      'chat-1', 'FILE-1',
      '/addgear ~2018 ~$120 https://www.rei.com/product/163187/grass-sticks-original-bamboo-ski-poles-pair',
      deps,
    );
    expect(reply).toMatch(/About to log/i);
    expect(reply).not.toMatch(/couldn't read brand/i);
  });

  test('URL fails AND vision fails → returns a single clear error', async () => {
    const deps = makeDeps({
      fetchProductInfo: vi.fn(async () => null),
      extractFromPhoto: vi.fn(async () => null),
    });
    const reply = await startAddgear(
      'chat-1', 'FILE-1',
      '/addgear ~2018 ~$120 https://example.com/x',
      deps,
    );
    expect(reply).toMatch(/couldn't extract a product name/i);
  });

  test('photo and URL disagree on brand → preview is prefixed with a "Heads up" warning', async () => {
    const deps = makeDeps({
      fetchProductInfo: vi.fn(async () => ({
        brand: 'Grass Sticks',
        itemName: 'Original Bamboo Ski Poles',
      })),
      extractFromPhoto: vi.fn(async (): Promise<PhotoExtraction> => ({
        brand: 'Marmot', itemName: 'Tungsten Tent', color: 'orange', size: '',
        confidence: { brand: 'high', itemName: 'high', color: 'high', size: 'missing' },
      })),
    });
    const reply = await startAddgear(
      'chat-1', 'FILE-1',
      '/addgear ~2018 ~$120 https://www.rei.com/product/163187/grass-sticks-original-bamboo-ski-poles-pair',
      deps,
    );
    expect(reply).toMatch(/heads up/i);
    expect(reply).toContain('Marmot');
    expect(reply).toContain('Grass Sticks');
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    if (step?.kind === 'awaiting-confirm') {
      // URL wins, brand is from URL not from vision
      expect(((step as { row: { brand: any } }).row.brand)).toBe('Grass Sticks');
    }
  });

  test('photo and URL agree on brand → no warning', async () => {
    const deps = makeDeps({
      fetchProductInfo: vi.fn(async () => ({
        brand: 'Patagonia',
        itemName: 'Houdini Jacket',
      })),
      // Vision agrees on brand.
      extractFromPhoto: vi.fn(async (): Promise<PhotoExtraction> => ({
        brand: 'Patagonia', itemName: 'Houdini', color: 'blue', size: 'M',
        confidence: { brand: 'high', itemName: 'high', color: 'high', size: 'high' },
      })),
    });
    const reply = await startAddgear(
      'chat-1', 'FILE-1',
      '/addgear ~2018 ~$120 https://www.patagonia.com/product/foo',
      deps,
    );
    expect(reply).not.toMatch(/heads up/i);
  });
});
