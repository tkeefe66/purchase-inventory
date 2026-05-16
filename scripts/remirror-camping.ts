import 'dotenv/config';
import { createSheetsClient, mirrorCampingIndex } from '../lib/sheets.js';
import { readCampingIndex } from '../lib/campingState.js';

async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const indexPath = process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json';
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  const idx = await readCampingIndex(indexPath);
  console.log(`Mirroring ${idx.facilities.length} facilities to sheet (${idx.facilities.filter((f) => f.active).length} active)...`);
  await mirrorCampingIndex(sheets, spreadsheetId, idx.facilities);
  console.log('Done.');
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
