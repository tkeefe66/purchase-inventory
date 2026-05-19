import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveImage } from '../../lib/integrations/resolve-image.js';

const TMP_ROOT = join(tmpdir(), `resolve-image-test-${process.pid}`);
const CACHE_PATH = join(TMP_ROOT, 'image-url-cache.json');

beforeEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('resolveImage', () => {
  it('uses the parsed imageUrl when present (no Sonnet call)', async () => {
    const lookupCalls: number[] = [];
    const fakeAnthropic = {} as never;

    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(Buffer.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    try {
      const path = await resolveImage({
        itemId: 'A1',
        brand: 'Patagonia',
        itemName: 'Nano Puff',
        productUrl: '',
        parsedImageUrl: 'https://example.com/x.jpg',
        anthropic: fakeAnthropic,
        lookupFn: async () => {
          lookupCalls.push(1);
          return null;
        },
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(path).toMatch(/^\/images\//);
      expect(lookupCalls.length).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('falls back to lookup when parsedImageUrl is missing', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(Buffer.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    try {
      const path = await resolveImage({
        itemId: 'A2',
        brand: 'Patagonia',
        itemName: 'Nano Puff',
        productUrl: '',
        parsedImageUrl: undefined,
        anthropic: {} as never,
        lookupFn: async () => 'https://example.com/y.jpg',
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(path).toMatch(/^\/images\//);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns empty string when everything fails', async () => {
    const path = await resolveImage({
      itemId: 'A3',
      brand: 'X',
      itemName: 'Y',
      productUrl: '',
      parsedImageUrl: undefined,
      anthropic: {} as never,
      lookupFn: async () => null,
      storageRoot: TMP_ROOT,
      cachePath: CACHE_PATH,
    });
    expect(path).toBe('');
  });
});
