import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cacheKey,
  lookupCachedUrl,
  readUrlCache,
  recordResolution,
  writeUrlCache,
  NULL_RETRY_TTL_DAYS,
} from '../../../lib/dispersed/url-cache.js';

describe('url-cache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'urlcache-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('cacheKey formats as source|id', () => {
    expect(cacheKey('USFS', '123')).toBe('USFS|123');
    expect(cacheKey('BLM', 'abc')).toBe('BLM|abc');
    expect(cacheKey('OSM', 'node/9876')).toBe('OSM|node/9876');
  });

  it('readUrlCache returns empty Map when file missing', async () => {
    const cache = await readUrlCache(join(dir, 'missing.json'));
    expect(cache.size).toBe(0);
  });

  it('readUrlCache returns empty Map on malformed JSON', async () => {
    const path = join(dir, 'bad.json');
    await writeFile(path, '{not valid', 'utf-8');
    const cache = await readUrlCache(path);
    expect(cache.size).toBe(0);
  });

  it('write then read roundtrips entries', async () => {
    const cache = new Map();
    const now = new Date('2026-05-18T10:00:00Z');
    recordResolution(cache, 'USFS', '123', 'https://fs.usda.gov/foo', now);
    recordResolution(cache, 'BLM', '456', null, now);

    const path = join(dir, 'cache.json');
    await writeUrlCache(path, cache);
    const reloaded = await readUrlCache(path);

    expect(reloaded.size).toBe(2);
    expect(reloaded.get('USFS|123')).toEqual({
      url: 'https://fs.usda.gov/foo',
      resolvedAt: '2026-05-18T10:00:00.000Z',
      status: 'canonical',
    });
    expect(reloaded.get('BLM|456')).toEqual({
      url: null,
      resolvedAt: '2026-05-18T10:00:00.000Z',
      status: 'tried-null',
    });
  });

  it('writeUrlCache creates parent dirs', async () => {
    const path = join(dir, 'nested', 'sub', 'cache.json');
    const cache = new Map();
    recordResolution(cache, 'USFS', '1', 'https://fs.usda.gov/x', new Date());
    await writeUrlCache(path, cache);
    const reloaded = await readUrlCache(path);
    expect(reloaded.size).toBe(1);
  });

  it('lookupCachedUrl hits canonical entries', () => {
    const cache = new Map();
    const now = new Date('2026-05-18T10:00:00Z');
    recordResolution(cache, 'USFS', '1', 'https://fs.usda.gov/x', now);
    expect(lookupCachedUrl(cache, 'USFS', '1', now)).toEqual({
      hit: true,
      url: 'https://fs.usda.gov/x',
    });
  });

  it('lookupCachedUrl honors tried-null within TTL', () => {
    const cache = new Map();
    const resolveTime = new Date('2026-05-01T10:00:00Z');
    const checkTime = new Date('2026-05-15T10:00:00Z'); // 14 days later
    recordResolution(cache, 'BLM', '99', null, resolveTime);
    expect(lookupCachedUrl(cache, 'BLM', '99', checkTime)).toEqual({
      hit: true,
      url: null,
    });
  });

  it('lookupCachedUrl re-resolves tried-null past TTL', () => {
    const cache = new Map();
    const resolveTime = new Date('2026-04-01T10:00:00Z');
    // Exactly TTL+1 day later — should miss
    const checkTime = new Date(resolveTime.getTime() + (NULL_RETRY_TTL_DAYS + 1) * 86_400_000);
    recordResolution(cache, 'BLM', '99', null, resolveTime);
    expect(lookupCachedUrl(cache, 'BLM', '99', checkTime)).toEqual({ hit: false });
  });

  it('lookupCachedUrl misses unknown key', () => {
    const cache = new Map();
    expect(lookupCachedUrl(cache, 'USFS', 'nope', new Date())).toEqual({ hit: false });
  });

  it('recordResolution overwrites prior entry for same key', () => {
    const cache = new Map();
    const t1 = new Date('2026-05-01T10:00:00Z');
    const t2 = new Date('2026-05-10T10:00:00Z');
    recordResolution(cache, 'USFS', '1', null, t1);
    recordResolution(cache, 'USFS', '1', 'https://fs.usda.gov/now', t2);
    expect(cache.size).toBe(1);
    expect(lookupCachedUrl(cache, 'USFS', '1', t2)).toEqual({
      hit: true,
      url: 'https://fs.usda.gov/now',
    });
  });

  it('atomic write: rename leaves no .tmp file behind', async () => {
    const path = join(dir, 'cache.json');
    const cache = new Map();
    recordResolution(cache, 'USFS', '1', 'https://fs.usda.gov/x', new Date());
    await writeUrlCache(path, cache);
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    expect(files).toEqual(['cache.json']);
  });
});
