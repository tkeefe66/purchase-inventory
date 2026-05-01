import 'dotenv/config';
import { google } from 'googleapis';

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId) {
    console.error('Missing one of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / GOOGLE_SHEET_ID in .env');
    process.exit(1);
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tabs = meta.data.sheets ?? [];

  console.log(`Spreadsheet: "${meta.data.properties?.title}"`);
  console.log(`Total tabs: ${tabs.length}`);

  for (const tab of tabs) {
    const title = tab.properties?.title ?? '(untitled)';
    const grid = tab.properties?.gridProperties;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`TAB: "${title}"  (allocated ${grid?.rowCount} rows × ${grid?.columnCount} cols)`);
    console.log('='.repeat(70));

    const sample = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapeTab(title)}'!A1:AZ3`,
    });
    const rows = (sample.data.values ?? []) as string[][];

    if (rows.length === 0) {
      console.log('(empty)');
      continue;
    }

    const headers = rows[0] ?? [];
    console.log(`\nHeaders (${headers.length} cols):`);
    headers.forEach((h, i) => {
      console.log(`  ${colLetter(i)}: "${h}"`);
    });

    for (let r = 1; r < Math.min(3, rows.length); r++) {
      const row = rows[r] ?? [];
      console.log(`\nSample row ${r}:`);
      const maxCol = Math.max(headers.length, row.length);
      for (let c = 0; c < maxCol; c++) {
        const v = row[c];
        console.log(`  ${colLetter(c)}: ${v ? `"${v}"` : '(empty)'}`);
      }
    }

    const colA = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${escapeTab(title)}'!A:A`,
    });
    const filled = (colA.data.values ?? []).filter((r) => r[0]).length;
    console.log(`\nFilled rows in column A: ${filled} (incl. header → ~${Math.max(0, filled - 1)} data rows)`);
  }

  console.log();
}

function colLetter(index: number): string {
  let result = '';
  let i = index;
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  }
  return result;
}

function escapeTab(name: string): string {
  return name.replace(/'/g, "''");
}

main().catch((err: unknown) => {
  console.error('Inspection failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
