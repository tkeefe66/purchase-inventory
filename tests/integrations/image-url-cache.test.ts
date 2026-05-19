import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readImageUrlCache,
  writeImageUrlCache,
  lookupCachedImageUrl,
  recordImageResolution,
} from '../../lib/integrations/image-url-cache.js';

const TMP_ROOT = join(tmpdir(), `image-url-cache-test-${process.pid}`);
const CACHE_PATH = join(TMP_ROOT, 'image-url-cache.json');

beforeEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('image url cache', () => {
  it('returns empty cache when file does not exist', async () => {
    const c = await readImageUrlCache(CACHE_PATH);
    expect(c.size).toBe(0);
  });

  it('round-trips canonical entries', async () => {
    const c = await readImageUrlCache(CACHE_PATH);
    recordImageResolution(c, 'patagonia|nano puff jacket', 'https://example.com/x.jpg', new Date());
    await writeImageUrlCache(CACHE_PATH, c);
    const c2 = await readImageUrlCache(CACHE_PATH);
    const hit = lookupCachedImageUrl(c2, 'patagonia|nano puff jacket', new Date());
    expect(hit.hit).toBe(true);
    expect(hit.url).toBe('https://example.com/x.jpg');
  });

  it('honors tried-null for 30 days, then expires', async () => {
    const c = await readImageUrlCache(CACHE_PATH);
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    recordImageResolution(c, 'patagonia|unicorn slippers', null, longAgo);
    const stale = lookupCachedImageUrl(c, 'patagonia|unicorn slippers', new Date());
    expect(stale.hit).toBe(false);

    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    recordImageResolution(c, 'patagonia|other', null, recent);
    const fresh = lookupCachedImageUrl(c, 'patagonia|other', new Date());
    expect(fresh.hit).toBe(true);
    expect(fresh.url).toBeNull();
  });
});
