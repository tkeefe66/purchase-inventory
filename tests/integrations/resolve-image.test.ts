import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveImage } from '../../lib/integrations/resolve-image.js';

const TMP_ROOT = join(tmpdir(), `resolve-image-test-${process.pid}`);
const CACHE_PATH = join(TMP_ROOT, 'image-url-cache.json');

function jpegFetch(): typeof fetch {
  return (async () =>
    new Response(Buffer.from([0xff, 0xd8, 0xff]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })) as unknown as typeof fetch;
}

beforeEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('resolveImage', () => {
  it('returns parsedImageUrl immediately when present (no search, no Sonnet)', async () => {
    const searchFn = vi.fn();
    const lookupFn = vi.fn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = jpegFetch();
    try {
      const ref = await resolveImage({
        itemId: 'A1',
        brand: 'Patagonia',
        itemName: 'Nano Puff',
        productUrl: '',
        parsedImageUrl: 'https://example.com/x.jpg',
        anthropic: {} as never,
        searchFn,
        lookupFn,
        imageSearchConfig: { provider: 'brave', apiKey: 'tok' },
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(ref).toBe('https://example.com/x.jpg');
      expect(searchFn).not.toHaveBeenCalled();
      expect(lookupFn).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('tries Brave before Sonnet — Brave hit short-circuits Sonnet', async () => {
    const searchFn = vi.fn().mockResolvedValue({
      url: 'https://m.media-amazon.com/images/I/brave.jpg',
      pageUrl: 'https://amazon.com/x',
    });
    const lookupFn = vi.fn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = jpegFetch();
    try {
      const ref = await resolveImage({
        itemId: 'A2',
        brand: 'Patagonia',
        itemName: 'Nano Puff',
        productUrl: '',
        parsedImageUrl: undefined,
        anthropic: {} as never,
        searchFn,
        lookupFn,
        imageSearchConfig: { provider: 'brave', apiKey: 'tok' },
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(ref).toBe('https://m.media-amazon.com/images/I/brave.jpg');
      expect(searchFn).toHaveBeenCalledOnce();
      expect(lookupFn).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('falls through to Sonnet when Brave returns null', async () => {
    const searchFn = vi.fn().mockResolvedValue(null);
    const lookupFn = vi.fn().mockResolvedValue('https://example.com/sonnet.jpg');
    const realFetch = globalThis.fetch;
    globalThis.fetch = jpegFetch();
    try {
      const ref = await resolveImage({
        itemId: 'A3',
        brand: 'X',
        itemName: 'Y',
        productUrl: '',
        parsedImageUrl: undefined,
        anthropic: {} as never,
        searchFn,
        lookupFn,
        imageSearchConfig: { provider: 'brave', apiKey: 'tok' },
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(ref).toBe('https://example.com/sonnet.jpg');
      expect(searchFn).toHaveBeenCalledOnce();
      expect(lookupFn).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('skips Brave entirely when imageSearchConfig is null', async () => {
    const searchFn = vi.fn();
    const lookupFn = vi.fn().mockResolvedValue('https://example.com/sonnet.jpg');
    const realFetch = globalThis.fetch;
    globalThis.fetch = jpegFetch();
    try {
      const ref = await resolveImage({
        itemId: 'A4',
        brand: 'X',
        itemName: 'Y',
        productUrl: '',
        parsedImageUrl: undefined,
        anthropic: {} as never,
        searchFn,
        lookupFn,
        imageSearchConfig: null,
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(ref).toBe('https://example.com/sonnet.jpg');
      expect(searchFn).not.toHaveBeenCalled();
      expect(lookupFn).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns empty string when everything fails, caches tried-null', async () => {
    const searchFn = vi.fn().mockResolvedValue(null);
    const lookupFn = vi.fn().mockResolvedValue(null);
    const ref = await resolveImage({
      itemId: 'A5',
      brand: 'X',
      itemName: 'Y',
      productUrl: '',
      parsedImageUrl: undefined,
      anthropic: {} as never,
      searchFn,
      lookupFn,
      imageSearchConfig: { provider: 'brave', apiKey: 'tok' },
      storageRoot: TMP_ROOT,
      cachePath: CACHE_PATH,
    });
    expect(ref).toBe('');
    const cache = JSON.parse(await readFile(CACHE_PATH, 'utf-8')) as Record<
      string,
      { status: string; url: string | null }
    >;
    const entry = cache['x|y'];
    expect(entry?.status).toBe('tried-null');
  });

  it('uses cached canonical URL without re-calling providers', async () => {
    const searchFn = vi.fn().mockResolvedValue({
      url: 'https://cdn/first.jpg',
      pageUrl: '',
    });
    const lookupFn = vi.fn();
    const realFetch = globalThis.fetch;
    globalThis.fetch = jpegFetch();
    try {
      // First call writes to cache.
      await resolveImage({
        itemId: 'A6a',
        brand: 'Patagonia',
        itemName: 'Black Hole',
        productUrl: '',
        parsedImageUrl: undefined,
        anthropic: {} as never,
        searchFn,
        lookupFn,
        imageSearchConfig: { provider: 'brave', apiKey: 'tok' },
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(searchFn).toHaveBeenCalledOnce();

      // Second call (same brand+itemName) should hit cache.
      searchFn.mockClear();
      const ref2 = await resolveImage({
        itemId: 'A6b',
        brand: 'Patagonia',
        itemName: 'Black Hole',
        productUrl: '',
        parsedImageUrl: undefined,
        anthropic: {} as never,
        searchFn,
        lookupFn,
        imageSearchConfig: { provider: 'brave', apiKey: 'tok' },
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(ref2).toBe('https://cdn/first.jpg');
      expect(searchFn).not.toHaveBeenCalled();
      expect(lookupFn).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
