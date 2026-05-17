import type { DispersedSnapshot, DispersedSource, DispersedSpot } from '../../../lib/dispersed/types.js';
import { fetchUsfsDispersed } from '../../../lib/dispersed/usfs.js';
import { fetchBlmDispersed } from '../../../lib/dispersed/blm.js';
import { fetchOsmDispersed } from '../../../lib/dispersed/osm.js';

/**
 * Orchestrates the weekly refresh of dispersed-camping spots into a single
 * merged snapshot. Each source is fetched in turn (not parallel — keeps load
 * on the public APIs polite) and failures in one source don't abort others.
 *
 * Which sources run is controlled by `DISPERSED_SOURCES` env var (comma-list,
 * e.g. `USFS,BLM` or `USFS,BLM,OSM`). Default is `USFS,BLM` — OSM is opt-in
 * because the ~14k Western-US community-tagged points are noisy and don't
 * earn their keep in the sheet at this scale. Re-enable by setting
 * `DISPERSED_SOURCES=USFS,BLM,OSM` in Railway and redeploying.
 */

const VALID_SOURCES: ReadonlySet<DispersedSource> = new Set(['USFS', 'BLM', 'OSM']);

export function parseEnabledSources(raw: string | undefined): Set<DispersedSource> {
  if (!raw) return new Set(['USFS', 'BLM']);
  const out = new Set<DispersedSource>();
  for (const tok of raw.split(',')) {
    const s = tok.trim() as DispersedSource;
    if (VALID_SOURCES.has(s)) out.add(s);
  }
  return out.size > 0 ? out : new Set(['USFS', 'BLM']);
}

export interface DispersedRefreshResult {
  snapshot: DispersedSnapshot;
  countsBySource: Record<DispersedSource, number>;
  failures: Array<{ source: DispersedSource; error: string }>;
  /** Which sources actually ran this pass (the rest were skipped via env). */
  enabledSources: DispersedSource[];
}

export interface RunDispersedRefreshOpts {
  /** Allow tests + smoke scripts to inject stub fetchers per source. */
  usfsFetcher?: typeof fetch;
  blmFetcher?: typeof fetch;
  osmFetcher?: typeof fetch;
  /** Override DISPERSED_SOURCES env var (testing). */
  enabledSources?: Set<DispersedSource>;
}

export async function runDispersedRefresh(opts: RunDispersedRefreshOpts = {}): Promise<DispersedRefreshResult> {
  const enabled = opts.enabledSources ?? parseEnabledSources(process.env['DISPERSED_SOURCES']);
  const all: DispersedSpot[] = [];
  const counts: Record<DispersedSource, number> = { USFS: 0, BLM: 0, OSM: 0 };
  const failures: Array<{ source: DispersedSource; error: string }> = [];

  if (enabled.has('USFS')) {
    try {
      const spots = await fetchUsfsDispersed({ ...(opts.usfsFetcher ? { fetcher: opts.usfsFetcher } : {}) });
      counts.USFS = spots.length;
      all.push(...spots);
    } catch (err) {
      failures.push({ source: 'USFS', error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (enabled.has('BLM')) {
    try {
      const spots = await fetchBlmDispersed({ ...(opts.blmFetcher ? { fetcher: opts.blmFetcher } : {}) });
      counts.BLM = spots.length;
      all.push(...spots);
    } catch (err) {
      failures.push({ source: 'BLM', error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (enabled.has('OSM')) {
    try {
      const spots = await fetchOsmDispersed({ ...(opts.osmFetcher ? { fetcher: opts.osmFetcher } : {}) });
      counts.OSM = spots.length;
      all.push(...spots);
    } catch (err) {
      failures.push({ source: 'OSM', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    snapshot: { refreshedAt: new Date().toISOString(), spots: all },
    countsBySource: counts,
    failures,
    enabledSources: Array.from(enabled),
  };
}
