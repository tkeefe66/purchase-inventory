import 'dotenv/config';
import { google, sheets_v4 } from 'googleapis';
import { buildFallbackProductUrl, Source } from '../lib/url-fallback.js';
import { buildHeaderMap, colLetter } from '../lib/sheets.js';

const TARGET_TAB = 'All Purchases';

async function main(): Promise<void> {
  const env = readEnv();
  const oauth2Client = new google.auth.OAuth2(env.clientId, env.clientSecret);
  oauth2Client.setCredentials({ refresh_token: env.refreshToken });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  // Read header row + look up columns by name (resilient to column reordering).
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId: env.spreadsheetId,
    range: `'${TARGET_TAB}'!1:1`,
  });
  const headers = ((headerResp.data.values?.[0] ?? []) as Array<string | null | undefined>).map((s) =>
    (s ?? '').toString(),
  );
  const map = buildHeaderMap(headers);
  const productUrlIdx = map.get('Product URL');
  const itemNameIdx = map.get('Item Name');
  const sourceIdx = map.get('Source');
  const orderIdIdx = map.get('Order ID');
  if (
    productUrlIdx === undefined ||
    itemNameIdx === undefined ||
    sourceIdx === undefined ||
    orderIdIdx === undefined
  ) {
    console.error('✗ One or more required columns missing in headers.');
    console.error(`  Need: Product URL, Item Name, Source, Order ID. Found: [${[...map.keys()].join(', ')}]`);
    process.exit(1);
  }
  const productUrlColLetter = colLetter(productUrlIdx);
  const lastColLetter = colLetter(headers.length - 1);
  console.log(`Reading "${TARGET_TAB}" (Product URL is column ${productUrlColLetter})...`);

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: env.spreadsheetId,
    range: `'${TARGET_TAB}'!A2:${lastColLetter}`,
  });
  const rows = (resp.data.values ?? []) as string[][];
  console.log(`✓ ${rows.length} data rows`);

  let alreadyHaveUrl = 0;
  let willPopulate = 0;
  let skipped = 0;
  const updates: { rowIndex1Based: number; url: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const existingUrl = ((row[productUrlIdx] as string) ?? '').trim();
    if (existingUrl) {
      alreadyHaveUrl++;
      continue;
    }
    const itemName = ((row[itemNameIdx] as string) ?? '').trim();
    const source = ((row[sourceIdx] as string) ?? '').trim();
    const orderId = ((row[orderIdIdx] as string) ?? '').trim();
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

  console.log(`\nSample URLs being written:`);
  for (const u of updates.slice(0, 3)) {
    console.log(`  Row ${u.rowIndex1Based}: ${u.url}`);
  }
  if (updates.length > 3) console.log(`  … and ${updates.length - 3} more`);

  console.log(`\nApplying ${updates.length} cell updates to column ${productUrlColLetter}...`);
  const data: sheets_v4.Schema$ValueRange[] = updates.map((u) => ({
    range: `'${TARGET_TAB}'!${productUrlColLetter}${u.rowIndex1Based}`,
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
