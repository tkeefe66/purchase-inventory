import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DispersedSource } from './types.js';

/**
 * Persistent cache for `resolveAgencyUrl` results. Lives in its own file
 * (separate from the dispersed snapshot) so the cache survives even when a
 * resolution run is killed mid-flight or the snapshot is regenerated.
 *
 * Two kinds of entries:
 * - `canonical` — the resolver returned a real agency URL. Kept forever.
 * - `tried-null` — the resolver returned no match. Honored for 30 days, then
 *   eligible for retry (handles transient API blips without retry storms).
 *
 * Re-runs of `scripts/seed-dispersed.ts` only spend Anthropic credits on
 * cache-misses, so quarterly catalog refreshes stay near-free after the
 * initial seed.
 */

export type UrlCacheStatus = 'canonical' | 'tried-null';

export interface UrlCacheEntry {
  url: string | null;
  resolvedAt: string;
  status: UrlCacheStatus;
}

export type UrlCache = Map<string, UrlCacheEntry>;

export const NULL_RETRY_TTL_DAYS = 30;
const NULL_RETRY_TTL_MS = NULL_RETRY_TTL_DAYS * 24 * 60 * 60 * 1000;

export function cacheKey(source: DispersedSource, id: string): string {
  return `${source}|${id}`;
}

export async function readUrlCache(path: string): Promise<UrlCache> {
  if (!existsSync(path)) return new Map();
  try {
    const raw = await readFile(path, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, UrlCacheEntry>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export async function writeUrlCache(path: string, cache: UrlCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const obj = Object.fromEntries(cache);
  // Atomic write — temp file + rename — so a killed run doesn't corrupt the
  // cache. proper-lockfile is already a dep but rename is sufficient here
  // because only one seed-dispersed run should be in flight at a time.
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  await rename(tmp, path);
}

export interface CacheLookup {
  hit: boolean;
  /** Defined only when hit=true. Null means "we tried and got no match, recently". */
  url?: string | null;
}

export function lookupCachedUrl(
  cache: UrlCache,
  source: DispersedSource,
  id: string,
  now: Date,
): CacheLookup {
  const entry = cache.get(cacheKey(source, id));
  if (!entry) return { hit: false };
  if (entry.status === 'canonical') return { hit: true, url: entry.url };
  const resolvedAtMs = Date.parse(entry.resolvedAt);
  if (Number.isNaN(resolvedAtMs)) return { hit: false };
  if (now.getTime() - resolvedAtMs < NULL_RETRY_TTL_MS) {
    return { hit: true, url: null };
  }
  return { hit: false };
}

export function recordResolution(
  cache: UrlCache,
  source: DispersedSource,
  id: string,
  url: string | null,
  now: Date,
): void {
  cache.set(cacheKey(source, id), {
    url,
    resolvedAt: now.toISOString(),
    status: url ? 'canonical' : 'tried-null',
  });
}
