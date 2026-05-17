import type { DispersedSnapshot, DispersedSpot } from '../../../lib/dispersed/types.js';
import { fetchUsfsDispersed } from '../../../lib/dispersed/usfs.js';
import { fetchBlmDispersed } from '../../../lib/dispersed/blm.js';
import { fetchOsmDispersed } from '../../../lib/dispersed/osm.js';

/**
 * Orchestrates the weekly refresh of USFS + BLM + OSM dispersed-camping
 * spots into a single merged snapshot. Each source is fetched in turn (not
 * parallel — keeps load on the public APIs polite) and failures in one
 * source don't abort the others.
 */

export interface DispersedRefreshResult {
  snapshot: DispersedSnapshot;
  countsBySource: Record<'USFS' | 'BLM' | 'OSM', number>;
  failures: Array<{ source: 'USFS' | 'BLM' | 'OSM'; error: string }>;
}

export interface RunDispersedRefreshOpts {
  /** Allow tests + smoke scripts to inject stub fetchers per source. */
  usfsFetcher?: typeof fetch;
  blmFetcher?: typeof fetch;
  osmFetcher?: typeof fetch;
}

export async function runDispersedRefresh(opts: RunDispersedRefreshOpts = {}): Promise<DispersedRefreshResult> {
  const all: DispersedSpot[] = [];
  const counts = { USFS: 0, BLM: 0, OSM: 0 } as Record<'USFS' | 'BLM' | 'OSM', number>;
  const failures: Array<{ source: 'USFS' | 'BLM' | 'OSM'; error: string }> = [];

  try {
    const spots = await fetchUsfsDispersed({ ...(opts.usfsFetcher ? { fetcher: opts.usfsFetcher } : {}) });
    counts.USFS = spots.length;
    all.push(...spots);
  } catch (err) {
    failures.push({ source: 'USFS', error: err instanceof Error ? err.message : String(err) });
  }

  try {
    const spots = await fetchBlmDispersed({ ...(opts.blmFetcher ? { fetcher: opts.blmFetcher } : {}) });
    counts.BLM = spots.length;
    all.push(...spots);
  } catch (err) {
    failures.push({ source: 'BLM', error: err instanceof Error ? err.message : String(err) });
  }

  try {
    const spots = await fetchOsmDispersed({ ...(opts.osmFetcher ? { fetcher: opts.osmFetcher } : {}) });
    counts.OSM = spots.length;
    all.push(...spots);
  } catch (err) {
    failures.push({ source: 'OSM', error: err instanceof Error ? err.message : String(err) });
  }

  return {
    snapshot: { refreshedAt: new Date().toISOString(), spots: all },
    countsBySource: counts,
    failures,
  };
}
