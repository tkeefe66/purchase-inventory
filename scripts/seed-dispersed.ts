import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { runDispersedRefresh } from '../apps/cron/camping/dispersed-refresh.js';
import { createSheetsClient, mirrorDispersedSites } from '../lib/sheets.js';
import { readDispersedSnapshot, writeDispersedSnapshot } from '../lib/dispersed/cache.js';
import { resolveAgencyUrl } from '../lib/dispersed/url-resolver.js';
import type { DispersedSpot, DispersedSource } from '../lib/dispersed/types.js';

/**
 * One-shot seed of USFS + BLM dispersed-camping sites with URL enrichment.
 *
 * For each spot, resolve a canonical agency URL via Haiku + web_search.
 * Cache by (source, id) using the existing on-disk snapshot — only spots
 * with no cached resolution (or whose cached URL is still a Google search
 * fallback) hit the LLM on each run.
 */

const CONCURRENCY = 8;

const SOURCE_DOMAINS: Record<DispersedSource, string> = {
  USFS: 'fs.usda.gov',
  BLM: 'blm.gov',
  OSM: 'openstreetmap.org',  // OSM spots ship with usable URLs; not resolved.
};

function isResolved(url: string, domain: string): boolean {
  if (!url) return false;
  if (url.includes('google.com/search')) return false;
  return url.toLowerCase().includes(domain.toLowerCase());
}

async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const snapshotPath = process.env.DISPERSED_SNAPSHOT_PATH ?? './local-data/dispersed-snapshot.json';
  const anthropic = new Anthropic();

  console.log(`Pulling dispersed sites (sources: ${process.env.DISPERSED_SOURCES ?? 'USFS,BLM (default)'})...`);
  const res = await runDispersedRefresh();
  console.log(`  enabled: ${res.enabledSources.join(', ')}`);
  for (const src of res.enabledSources) {
    console.log(`  ${src}: ${res.countsBySource[src]}`);
  }
  console.log(`  total: ${res.snapshot.spots.length}`);
  if (res.failures.length > 0) {
    console.warn('Per-source failures:');
    for (const f of res.failures) console.warn(`  - ${f.source}: ${f.error}`);
  }

  // Build a (source|id) → resolvedUrl cache from the prior snapshot.
  const cache = new Map<string, string>();
  const prior = await readDispersedSnapshot(snapshotPath);
  if (prior) {
    for (const s of prior.spots) {
      const domain = SOURCE_DOMAINS[s.source];
      if (isResolved(s.sourceUrl, domain)) cache.set(`${s.source}|${s.id}`, s.sourceUrl);
    }
    console.log(`Cache hit pool from prior snapshot: ${cache.size} URLs`);
  }

  // Apply cached URLs, queue the rest.
  const toResolve: DispersedSpot[] = [];
  for (const spot of res.snapshot.spots) {
    const cached = cache.get(`${spot.source}|${spot.id}`);
    if (cached) {
      spot.sourceUrl = cached;
    } else if (SOURCE_DOMAINS[spot.source]) {
      toResolve.push(spot);
    }
  }
  console.log(`Resolving ${toResolve.length} URLs via Haiku + web_search (concurrency=${CONCURRENCY})...`);

  // Concurrent worker pool — bounded by CONCURRENCY.
  let done = 0;
  let resolved = 0;
  const queue = [...toResolve];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const spot = queue.shift();
      if (!spot) return;
      const domain = SOURCE_DOMAINS[spot.source];
      const url = await resolveAgencyUrl(anthropic, {
        name: spot.name,
        agency: spot.agency,
        domain,
      });
      if (url) {
        spot.sourceUrl = url;
        resolved++;
      }
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${toResolve.length} (${resolved} resolved)`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`Resolution done: ${resolved}/${toResolve.length} got canonical URLs (rest fall back to Google search)`);

  console.log(`Writing snapshot to ${snapshotPath}...`);
  try {
    await writeDispersedSnapshot(snapshotPath, res.snapshot);
    console.log('  ✓ wrote');
  } catch (err) {
    console.warn(`  ✗ JSON write failed (sheet mirror will still proceed): ${err instanceof Error ? err.message : err}`);
  }

  console.log('Mirroring to sheet...');
  await mirrorDispersedSites(sheets, spreadsheetId, res.snapshot.spots);
  console.log('Done.');
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
