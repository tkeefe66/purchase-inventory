import 'dotenv/config';
import { runDispersedRefresh } from '../apps/cron/camping/dispersed-refresh.js';
import { createSheetsClient, mirrorDispersedSites } from '../lib/sheets.js';
import { writeDispersedSnapshot } from '../lib/dispersed/cache.js';

/**
 * One-shot: pull USFS + BLM + OSM dispersed-camping data, mirror to the
 * "Dispersed Sites" sheet tab, and write the snapshot JSON to the configured
 * path. Use this once after the dispersed-refresh feature deploys so the
 * sheet shows real data without waiting for the next scheduled Sunday 5am MT
 * cron tick.
 */
async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const snapshotPath = process.env.DISPERSED_SNAPSHOT_PATH ?? './local-data/dispersed-snapshot.json';

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

  console.log(`Writing JSON to ${snapshotPath}...`);
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
