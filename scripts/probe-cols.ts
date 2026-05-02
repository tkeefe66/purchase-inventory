import 'dotenv/config';
import { createSheetsClient } from '../lib/sheets.js';

async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: `'All Purchases'!A1:Q4`,
  });
  const rows = resp.data.values ?? [];
  for (const [i, row] of rows.entries()) {
    console.log(`\n--- row ${i} ---`);
    for (let c = 0; c < 17; c++) {
      const col = String.fromCharCode(65 + c);
      const val = row[c] ?? '';
      console.log(`  ${col}: ${String(val).slice(0, 80)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
