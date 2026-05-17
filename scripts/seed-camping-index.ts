import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createRecGovClient } from '../lib/reccgov/client.js';
import { createSheetsClient, mirrorCampingIndex } from '../lib/sheets.js';
import { readCampingIndex, writeCampingIndex } from '../lib/campingState.js';
import { runIndexRefresh } from '../apps/cron/camping/index-refresh.js';
import { runMetadataRefresh } from '../apps/cron/camping/metadata-refresh.js';

async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const recgov = createRecGovClient({ apiKey: process.env.RECGOV_API_KEY! });
  const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined;
  const indexPath = process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json';
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  console.log('Phase 1: index-refresh (fetching CO facility list)...');
  let idx = await readCampingIndex(indexPath);
  const r1 = await runIndexRefresh({ existingIndex: idx, client: recgov, sheets, sheetSpreadsheetId: spreadsheetId });
  await writeCampingIndex(indexPath, r1.index);
  console.log(`  +${r1.added} new, ${r1.totalActive} total active`);

  console.log('Phase 2: metadata-refresh (per-facility metadata + tent filter)...');
  if (!anthropic) console.log('  (ANTHROPIC_API_KEY unset — skipping LLM amenity parsing)');
  idx = await readCampingIndex(indexPath);
  const r2 = await runMetadataRefresh({
    existingIndex: idx, client: recgov,
    ...(anthropic ? { anthropic } : {}),
  });
  await writeCampingIndex(indexPath, r2.index);
  console.log(`  ${r2.refreshed} refreshed, ${r2.deactivated} deactivated, ${r2.failures} failures`);

  console.log('Phase 3: mirror to sheet (with computed Next Calendar Opens / Next Reminder Fires)...');
  await mirrorCampingIndex(sheets, spreadsheetId, r2.index.facilities);

  console.log('Seed complete.');
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
