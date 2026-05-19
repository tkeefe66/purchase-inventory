import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ImageUrlCacheStatus = 'canonical' | 'tried-null';

export interface ImageUrlCacheEntry {
  url: string | null;
  resolvedAt: string;
  status: ImageUrlCacheStatus;
}

export type ImageUrlCache = Map<string, ImageUrlCacheEntry>;

export const NULL_RETRY_TTL_DAYS = 30;
const NULL_RETRY_TTL_MS = NULL_RETRY_TTL_DAYS * 24 * 60 * 60 * 1000;

export async function readImageUrlCache(path: string): Promise<ImageUrlCache> {
  if (!existsSync(path)) return new Map();
  try {
    const raw = await readFile(path, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, ImageUrlCacheEntry>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export async function writeImageUrlCache(path: string, cache: ImageUrlCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const obj = Object.fromEntries(cache);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  await rename(tmp, path);
}

export interface CacheLookup {
  hit: boolean;
  /** Defined only when hit=true. Null means "we tried and got no match, recently". */
  url?: string | null;
}

export function lookupCachedImageUrl(
  cache: ImageUrlCache,
  key: string,
  now: Date,
): CacheLookup {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (entry.status === 'canonical') return { hit: true, url: entry.url };
  const resolvedAtMs = Date.parse(entry.resolvedAt);
  if (Number.isNaN(resolvedAtMs)) return { hit: false };
  if (now.getTime() - resolvedAtMs < NULL_RETRY_TTL_MS) {
    return { hit: true, url: null };
  }
  return { hit: false };
}

export function recordImageResolution(
  cache: ImageUrlCache,
  key: string,
  url: string | null,
  now: Date,
): void {
  cache.set(key, {
    url,
    resolvedAt: now.toISOString(),
    status: url ? 'canonical' : 'tried-null',
  });
}

export function imageCacheKey(brand: string, itemName: string): string {
  return `${brand.toLowerCase().trim()}|${itemName.toLowerCase().trim()}`;
}
