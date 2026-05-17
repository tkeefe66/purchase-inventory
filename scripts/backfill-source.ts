import 'dotenv/config';
import {
  createSheetsClient,
  mirrorCampingIndex,
  readCampingIndexFromSheet,
} from '../lib/sheets.js';

// Reads facilities from the Camping Index sheet tab (the cross-service source
// of truth — the cron's /data JSON is single-attach and not reachable from a
// local `railway run`), stamps `source='rec.gov'` on every facility
// missing it, and re-mirrors. The cron's own JSON gets backfilled by
// index-refresh.ts on its next scheduled tick (Sunday 4am MT) — by then this
// is a no-op there too.
async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  const idx = await readCampingIndexFromSheet(sheets, spreadsheetId);
  console.log(`Read ${idx.facilities.length} facilities from sheet.`);

  let updated = 0;
  for (const f of idx.facilities) {
    if (!f.source) {
      f.source = 'rec.gov';
      updated++;
    }
  }
  console.log(`Set source='rec.gov' on ${updated}/${idx.facilities.length} facilities. Mirroring back...`);

  await mirrorCampingIndex(sheets, spreadsheetId, idx.facilities);
  console.log('Done.');
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
