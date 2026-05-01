import 'dotenv/config';
import { google, sheets_v4 } from 'googleapis';
import { buildFallbackProductUrl, Source } from '../lib/url-fallback.js';

const TARGET_TAB = 'All Purchases';

// Column indices (0-based) in the All Purchases schema.
const COL_ITEM_NAME = 5; // F
const COL_SOURCE = 10; // K
const COL_ORDER_ID = 11; // L
const COL_PRODUCT_URL = 14; // O

async function main(): Promise<void> {
  const env = readEnv();
  const oauth2Client = new google.auth.OAuth2(env.clientId, env.clientSecret);
  oauth2Client.setCredentials({ refresh_token: env.refreshToken });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  console.log(`Reading "${TARGET_TAB}"...`);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: env.spreadsheetId,
    range: `'${TARGET_TAB}'!A2:Q`,
  });
  const rows = (resp.data.values ?? []) as string[][];
  console.log(`✓ ${rows.length} data rows`);

  let alreadyHaveUrl = 0;
  let willPopulate = 0;
  let skipped = 0;
  const updates: { rowIndex1Based: number; url: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const existingUrl = (row[COL_PRODUCT_URL] ?? '').trim();
    if (existingUrl) {
      alreadyHaveUrl++;
      continue;
    }
    const itemName = (row[COL_ITEM_NAME] ?? '').trim();
    const source = (row[COL_SOURCE] ?? '').trim();
    const orderId = (row[COL_ORDER_ID] ?? '').trim();
    if (!itemName || (source !== 'REI' && source !== 'Amazon')) {
      skipped++;
      continue;
    }
    const url = buildFallbackProductUrl({
      source: source as Source,
      orderId: orderId || undefined,
      itemName,
    });
    if (!url) {
      skipped++;
      continue;
    }
    // Sheet row index = data row index + 2 (header is row 1, data starts at row 2).
    updates.push({ rowIndex1Based: i + 2, url });
    willPopulate++;
  }

  console.log(`Plan:`);
  console.log(`  Already have URL: ${alreadyHaveUrl}`);
  console.log(`  Will populate:    ${willPopulate}`);
  console.log(`  Skipped:          ${skipped}`);

  if (updates.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  // Sample preview
  console.log(`\nSample URLs being written:`);
  for (const u of updates.slice(0, 3)) {
    console.log(`  Row ${u.rowIndex1Based}: ${u.url}`);
  }
  if (updates.length > 3) console.log(`  … and ${updates.length - 3} more`);

  console.log(`\nApplying ${updates.length} cell updates to column O...`);
  const data: sheets_v4.Schema$ValueRange[] = updates.map((u) => ({
    range: `'${TARGET_TAB}'!O${u.rowIndex1Based}`,
    values: [[u.url]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: env.spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });
  console.log(`✓ Done. ${updates.length} URLs populated.`);
}

function readEnv(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  spreadsheetId: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId) {
    console.error('✗ Missing one of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / GOOGLE_SHEET_ID in .env');
    process.exit(1);
  }
  return { clientId, clientSecret, refreshToken, spreadsheetId };
}

main().catch((err: unknown) => {
  console.error('✗ Backfill failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
