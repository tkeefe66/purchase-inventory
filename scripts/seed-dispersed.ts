import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createInterface } from 'node:readline/promises';
import { runDispersedRefresh } from '../apps/cron/camping/dispersed-refresh.js';
import { createSheetsClient, mirrorDispersedSites } from '../lib/sheets.js';
import { readDispersedSnapshot, writeDispersedSnapshot } from '../lib/dispersed/cache.js';
import { resolveAgencyUrl } from '../lib/dispersed/url-resolver.js';
import {
  lookupCachedUrl,
  readUrlCache,
  recordResolution,
  writeUrlCache,
  type UrlCache,
} from '../lib/dispersed/url-cache.js';
import type { DispersedSource, DispersedSpot } from '../lib/dispersed/types.js';

/**
 * Seed / refresh the dispersed-camping URL catalog.
 *
 * For each USFS + BLM spot, resolve a canonical agency URL via Sonnet 4.6 +
 * web_search and persist the result to `dispersed-url-cache.json`. Re-runs
 * only spend Anthropic credits on cache-misses, so quarterly refreshes are
 * near-free after the initial seed.
 *
 * Run cadence: quarterly (every 4 months) per Tom. Weekly cron only fetches
 * source lists (no Anthropic) — net-new spots get Google-fallback URLs until
 * the next seed run picks them up.
 *
 * Flags:
 *   --yes / -y   Skip the interactive cost-confirmation prompt (for CI).
 */

const CONCURRENCY = 8;
// Sonnet 4.6 tokens + 1-2 web_search ($0.01-0.02). web_search results echo
// back as input tokens (~15-20k per call), so real-world cost is ~$0.04-0.05.
const COST_PER_RESOLUTION_USD = 0.045;
const CACHE_WRITE_EVERY = 10;
// Fail-fast on prolonged systemic failure (e.g., billing/auth issues that
// somehow surface as silent null returns rather than thrown errors). Set
// generously — BLM dispersed sites legitimately return NONE in clusters
// because many tiny FCFS spots have no canonical agency page. 8 was too
// eager and aborted on the first BLM-heavy queue head.
const FAIL_FAST_CONSECUTIVE_NULLS = 30;

const SOURCE_DOMAINS: Record<DispersedSource, string> = {
  USFS: 'fs.usda.gov',
  BLM: 'blm.gov',
  OSM: 'openstreetmap.org', // OSM spots ship with usable URLs; not resolved.
};

function isCanonicalSnapshotUrl(url: string, domain: string): boolean {
  if (!url) return false;
  if (url.includes('google.com/search')) return false;
  return url.toLowerCase().includes(domain.toLowerCase());
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

/**
 * One-time migration: if the cache is empty (first run after this change) but
 * the prior snapshot already has canonical URLs from earlier `seed-dispersed`
 * runs, seed the cache from those so we don't re-pay to resolve them.
 */
async function bootstrapFromSnapshot(
  cache: UrlCache,
  snapshotPath: string,
): Promise<number> {
  if (cache.size > 0) return 0;
  const prior = await readDispersedSnapshot(snapshotPath);
  if (!prior) return 0;
  const seedTime = prior.refreshedAt ? new Date(prior.refreshedAt) : new Date();
  let seeded = 0;
  for (const s of prior.spots) {
    const domain = SOURCE_DOMAINS[s.source];
    if (!domain) continue;
    if (isCanonicalSnapshotUrl(s.sourceUrl, domain)) {
      recordResolution(cache, s.source, s.id, s.sourceUrl, seedTime);
      seeded++;
    }
  }
  return seeded;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const autoYes = args.includes('--yes') || args.includes('-y');

  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const snapshotPath = process.env.DISPERSED_SNAPSHOT_PATH ?? './local-data/dispersed-snapshot.json';
  const cachePath = process.env.DISPERSED_URL_CACHE_PATH ?? './local-data/dispersed-url-cache.json';
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

  console.log(`Loading URL cache from ${cachePath}...`);
  const cache = await readUrlCache(cachePath);
  console.log(`  ${cache.size} cached resolutions on disk`);
  const seeded = await bootstrapFromSnapshot(cache, snapshotPath);
  if (seeded > 0) {
    console.log(`  bootstrapped ${seeded} URLs from prior snapshot (one-time)`);
    await writeUrlCache(cachePath, cache);
  }

  // Apply cached URLs; queue everything else.
  const now = new Date();
  const toResolve: DispersedSpot[] = [];
  let appliedFromCache = 0;
  let skippedTriedNull = 0;
  for (const spot of res.snapshot.spots) {
    if (!SOURCE_DOMAINS[spot.source]) continue;
    const lookup = lookupCachedUrl(cache, spot.source, spot.id, now);
    if (lookup.hit) {
      if (lookup.url) {
        spot.sourceUrl = lookup.url;
        appliedFromCache++;
      } else {
        // Recently tried and got NONE — leave the Google-fallback URL the
        // adapter set, and skip re-resolution for the TTL window.
        skippedTriedNull++;
      }
    } else {
      toResolve.push(spot);
    }
  }
  console.log(`Cache stats: ${appliedFromCache} canonical applied, ${skippedTriedNull} tried-null skipped, ${toResolve.length} to resolve.`);

  const estCost = (toResolve.length * COST_PER_RESOLUTION_USD).toFixed(2);
  console.log(
    `\nWill resolve ${toResolve.length} URLs via Sonnet+web_search ` +
      `(~$${COST_PER_RESOLUTION_USD.toFixed(3)}/each, ~$${estCost} total).`,
  );

  if (toResolve.length > 0 && !autoYes) {
    const ok = await confirm('Continue?');
    if (!ok) {
      console.log('Aborted by user. Writing snapshot with cached/fallback URLs only.');
      await writeDispersedSnapshot(snapshotPath, res.snapshot);
      await mirrorDispersedSites(sheets, spreadsheetId, res.snapshot.spots);
      return;
    }
  }

  if (toResolve.length === 0) {
    console.log('Nothing to resolve — writing snapshot from cache.');
    await writeDispersedSnapshot(snapshotPath, res.snapshot);
    await mirrorDispersedSites(sheets, spreadsheetId, res.snapshot.spots);
    console.log('Done.');
    return;
  }

  console.log(`Resolving ${toResolve.length} URLs (concurrency=${CONCURRENCY})...`);

  // Shuffle so easy USFS hits and harder BLM lookups interleave. Without
  // this, a queue with all BLM at the front can hit FAIL_FAST_CONSECUTIVE_NULLS
  // before any USFS success — fail-fast then trips on what's actually just
  // a hard-case cluster, not a systemic failure.
  const queue = [...toResolve];
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j]!, queue[i]!];
  }

  let attempted = 0;
  let resolved = 0;
  let nullResolved = 0;
  let consecutiveFailures = 0;
  let abortedEarly = false;
  let writesSinceLastFlush = 0;

  async function flushCache(): Promise<void> {
    try {
      await writeUrlCache(cachePath, cache);
    } catch (err) {
      console.warn(`  cache write failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function worker(): Promise<void> {
    while (queue.length > 0 && !abortedEarly) {
      const spot = queue.shift();
      if (!spot) return;
      const domain = SOURCE_DOMAINS[spot.source];
      const url = await resolveAgencyUrl(anthropic, {
        name: spot.name,
        agency: spot.agency,
        domain,
      });
      const recordedAt = new Date();
      if (url) {
        spot.sourceUrl = url;
        recordResolution(cache, spot.source, spot.id, url, recordedAt);
        resolved++;
        consecutiveFailures = 0;
      } else {
        recordResolution(cache, spot.source, spot.id, null, recordedAt);
        nullResolved++;
        consecutiveFailures++;
        // Fail-fast: a long streak of consecutive nulls with zero successes
        // suggests systemic failure (auth/billing/web_search outage) rather
        // than hard data. With the queue shuffled, hitting this threshold
        // with no successes is very unlikely to be just a hard-case cluster.
        if (consecutiveFailures >= FAIL_FAST_CONSECUTIVE_NULLS && resolved === 0) {
          console.warn(
            `Aborting: ${consecutiveFailures} consecutive null responses with no successes — check Anthropic console (credits / web_search availability).`,
          );
          abortedEarly = true;
        }
      }
      attempted++;
      writesSinceLastFlush++;
      if (writesSinceLastFlush >= CACHE_WRITE_EVERY) {
        writesSinceLastFlush = 0;
        await flushCache();
      }
      if (attempted % 25 === 0) {
        console.log(`  ${attempted}/${toResolve.length} (${resolved} resolved, ${nullResolved} cached as no-match)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  await flushCache();
  const notAttempted = toResolve.length - attempted;
  console.log(
    `Resolution done: ${attempted} attempted (${resolved} canonical, ${nullResolved} cached as no-match for 30 days)` +
      (notAttempted > 0 ? `, ${notAttempted} not attempted` : '') +
      (abortedEarly ? ' [ABORTED EARLY]' : ''),
  );

  console.log(`\nWriting snapshot to ${snapshotPath}...`);
  try {
    await writeDispersedSnapshot(snapshotPath, res.snapshot);
    console.log('  ✓ wrote');
  } catch (err) {
    console.warn(
      `  ✗ JSON write failed (sheet mirror will still proceed): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  console.log('Mirroring to sheet...');
  await mirrorDispersedSites(sheets, spreadsheetId, res.snapshot.spots);
  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
