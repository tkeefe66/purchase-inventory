import 'dotenv/config';
import { createSheetsClient, readMasterRows } from '../lib/sheets.js';
import { InventoryCache } from '../apps/bot/inventoryCache.js';
import { Stats, formatStats } from '../apps/bot/stats.js';
import { filterToActiveOutdoor } from '../domains/outdoor/inventory.js';

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId) {
    console.error('Missing GOOGLE_* env vars in .env');
    process.exit(1);
  }

  const sheets = createSheetsClient({ clientId, clientSecret, refreshToken });
  const fetcher = () => readMasterRows(sheets, spreadsheetId);

  const cache = new InventoryCache(fetcher);
  const stats = new Stats();

  const t0 = Date.now();
  await cache.refresh();
  const t1 = Date.now();
  stats.recordRefresh({
    rowCount: cache.getSnapshot().length,
    durationMs: t1 - t0,
    hashChanged: cache.lastRefreshChangedHash,
  });

  const view = cache.getCompactView();
  const activeOutdoor = filterToActiveOutdoor(cache.getSnapshot());

  const approxTokens = Math.ceil(view.text.length / 4);

  console.log(`\n=== Smoke results ===`);
  console.log(`Total rows in sheet: ${cache.getSnapshot().length}`);
  console.log(`Active outdoor rows: ${activeOutdoor.length}`);
  console.log(`Compact view length: ${view.text.length} chars (~${approxTokens} tokens)`);
  console.log(`Hash: ${view.hash}`);
  console.log(`Refresh duration: ${t1 - t0}ms`);

  await cache.refresh();
  console.log(`\n2nd refresh hashChanged: ${cache.lastRefreshChangedHash} (expected: false)`);

  console.log(`\n=== Sample rendered rows (first 3) ===`);
  console.log(view.text.split('\n').slice(0, 8).join('\n'));

  console.log(`\n=== /stats output (with synthetic query data) ===`);
  stats.recordQuery({ systemPromptTokens: approxTokens, cacheHit: false, firstTokenMs: 4200, totalResponseMs: 5500 });
  stats.recordQuery({ systemPromptTokens: approxTokens, cacheHit: true, firstTokenMs: 1300, totalResponseMs: 1900 });
  console.log(formatStats(stats, {
    activeOutdoorRows: activeOutdoor.length,
    freeContextTokens: 200_000 - approxTokens,
  }));
}

main().catch((err: unknown) => {
  console.error('Smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
