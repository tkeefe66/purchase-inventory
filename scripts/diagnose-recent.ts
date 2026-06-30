#!/usr/bin/env tsx
/**
 * One-off diagnostic: check the last N days of activity in the sheet.
 * Prints recent rows from "All Purchases" + recent rows from "Cron Log".
 */
import 'dotenv/config';
import { createSheetsClient, readMasterRows } from '../lib/sheets.js';

async function main() {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  // All Purchases — last 20 by date
  const rows = await readMasterRows(sheets, spreadsheetId);
  console.log(`\nTotal rows in All Purchases: ${rows.length}`);
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  console.log('\nMost recent 15 rows by Date Purchased:');
  for (const r of sorted.slice(0, 15)) {
    console.log(`  ${r.date}  ${r.status.padEnd(8)} ${r.domain.padEnd(11)} ${r.source.padEnd(8)} ${r.entryMethod.padEnd(8)} ${r.brand.padEnd(15)} ${r.itemName.slice(0, 50)}`);
  }

  // Cron Log — last 20 runs
  const cronResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'Cron Log'!A:H`,
  });
  const cronRows = (cronResp.data.values ?? []) as (string | number)[][];
  console.log(`\nTotal Cron Log rows: ${cronRows.length - 1}`);
  console.log('\nMost recent 15 cron runs:');
  const dataRows = cronRows.slice(1).sort((a, b) => String(b[0]).localeCompare(String(a[0])));
  for (const r of dataRows.slice(0, 15)) {
    console.log(`  ${String(r[0]).padEnd(28)}  added=${String(r[1]).padEnd(3)}  scanned=${String(r[5]).padEnd(3)}  errors=${String(r[6]).padEnd(3)}  bySource=${String(r[2]).slice(0, 40)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
