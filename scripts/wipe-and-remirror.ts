import 'dotenv/config';
import { createSheetsClient, mirrorCampingIndex } from '../lib/sheets.js';
import { readCampingIndex } from '../lib/campingState.js';

async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const indexPath = process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json';

  console.log('Clearing all data rows in Camping Index (preserving header)...');
  // Range must cover every column the sheet uses today (29 cols → A:AC) AND
  // any leftover columns from previous schemas (going wider — A:AZ — is
  // cheap and prevents the "half-empty rows" bug where append() finds the
  // next "empty A column" row past stale rightmost columns.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: "'Camping Index'!A2:AZ5000",
  });
  console.log('✓ Cleared');

  const idx = await readCampingIndex(indexPath);
  console.log(`Mirroring ${idx.facilities.length} facilities (${idx.facilities.filter((f) => f.active).length} active)...`);
  await mirrorCampingIndex(sheets, spreadsheetId, idx.facilities);
  console.log('Done.');
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
