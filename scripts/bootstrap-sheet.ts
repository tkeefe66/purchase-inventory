import 'dotenv/config';
import { google, sheets_v4 } from 'googleapis';

const EXPECTED_HEADERS = [
  'Year',
  'Date Purchased',
  'Category',
  'Sub-Category',
  'Brand',
  'Item Name',
  'Color',
  'Size',
  'Qty',
  'Price (Paid)',
  'Source',
  'Order ID',
  'Status',
  'Domain',
  'Product URL',
];

const STATUS_ENUM = [
  'active',
  'retired',
  'returned',
  'lost',
  'broken',
  'sold',
  'donated',
  'excluded',
];

const NEEDS_REVIEW_HEADERS = [
  'Date Detected',
  'Source',
  'Email Subject',
  'Gmail Message ID',
  'Reason',
  'Raw Excerpt',
  'Resolved',
];

const STATUS_COL_INDEX = 12; // M = 13th column, 0-indexed = 12
const TOTAL_COLS = EXPECTED_HEADERS.length; // 15
const CONDITIONAL_FORMAT_FORMULA = '=$M2<>"active"';

async function main(): Promise<void> {
  const { clientId, clientSecret, refreshToken, spreadsheetId } = readEnv();

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  console.log(`Connecting to spreadsheet ${spreadsheetId}...`);

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields:
      'properties.title,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),conditionalFormats(ranges,booleanRule(condition(type,values))))',
  });

  console.log(`✓ Spreadsheet: "${meta.data.properties?.title}"`);
  console.log();

  const allTabs = meta.data.sheets ?? [];
  const tabNames = allTabs.map((s) => s.properties?.title ?? '(untitled)');
  console.log('Tabs found:');
  for (const name of tabNames) {
    console.log(`  - "${name}"`);
  }
  console.log();

  const targetTab = pickTargetTab(allTabs);
  if (!targetTab) {
    console.error('✗ Could not determine which tab to bootstrap.');
    console.error('  Expected a tab named "All Purchases" (case-sensitive), or set TARGET_TAB=<name> in .env to override.');
    console.error(`  Available: ${tabNames.map((n) => `"${n}"`).join(', ')}`);
    process.exit(1);
  }

  const targetTitle = targetTab.properties?.title;
  const targetSheetId = targetTab.properties?.sheetId;
  if (!targetTitle || targetSheetId == null) {
    console.error('✗ Target tab is missing title or sheetId.');
    process.exit(1);
  }

  console.log(`Target tab: "${targetTitle}" (sheetId=${targetSheetId})`);
  console.log();

  // Read existing header row (cols A through O — extend if more cols exist).
  const headerRange = `'${escapeTabName(targetTitle)}'!A1:Z1`;
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRange,
  });
  const existingHeaders = (headerResp.data.values?.[0] ?? []) as string[];

  console.log('Current headers:');
  for (let i = 0; i < TOTAL_COLS; i++) {
    const colLetter = colIndexToLetter(i);
    const existing = existingHeaders[i] ?? '';
    console.log(`  ${colLetter}: ${existing ? `"${existing}"` : '(empty)'}`);
  }
  console.log();

  // === Plan + apply: missing headers ===
  const headerUpdates: Array<{ col: string; value: string }> = [];
  const headerWarnings: string[] = [];
  for (let i = 0; i < TOTAL_COLS; i++) {
    const expected = EXPECTED_HEADERS[i]!;
    const existing = existingHeaders[i];
    const colLetter = colIndexToLetter(i);
    if (!existing) {
      headerUpdates.push({ col: colLetter, value: expected });
    } else if (existing.trim() !== expected) {
      headerWarnings.push(`  ${colLetter}: existing="${existing}" expected="${expected}" — leaving as-is`);
    }
  }

  if (headerWarnings.length > 0) {
    console.log('⚠ Header mismatches (existing values kept; review manually if needed):');
    for (const w of headerWarnings) console.log(w);
    console.log();
  }

  if (headerUpdates.length > 0) {
    console.log(`Applying ${headerUpdates.length} header addition(s):`);
    for (const u of headerUpdates) console.log(`  ${u.col} = "${u.value}"`);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: headerUpdates.map((u) => ({
          range: `'${escapeTabName(targetTitle)}'!${u.col}1`,
          values: [[u.value]],
        })),
      },
    });
    console.log('✓ Headers added');
  } else {
    console.log('✓ All expected headers already present');
  }
  console.log();

  // === Plan + apply: data validation, conditional formatting, Needs Review tab ===
  const requests: sheets_v4.Schema$Request[] = [];

  // Status column data validation (idempotent — setDataValidation replaces).
  requests.push({
    setDataValidation: {
      range: {
        sheetId: targetSheetId,
        startRowIndex: 1, // skip header row
        startColumnIndex: STATUS_COL_INDEX,
        endColumnIndex: STATUS_COL_INDEX + 1,
      },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: STATUS_ENUM.map((v) => ({ userEnteredValue: v })),
        },
        strict: true,
        showCustomUi: true,
      },
    },
  });
  console.log(`Plan: data validation on column M (Status enum: ${STATUS_ENUM.join(', ')})`);

  // Conditional formatting — only add if not already present.
  const existingRules = targetTab.conditionalFormats ?? [];
  const formatRuleAlreadyExists = existingRules.some(
    (r) =>
      r.booleanRule?.condition?.type === 'CUSTOM_FORMULA' &&
      r.booleanRule.condition.values?.[0]?.userEnteredValue === CONDITIONAL_FORMAT_FORMULA,
  );
  if (formatRuleAlreadyExists) {
    console.log('Plan: conditional formatting (already present — skip)');
  } else {
    console.log('Plan: conditional formatting — gray rows where Status != active');
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId: targetSheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: TOTAL_COLS,
            },
          ],
          booleanRule: {
            condition: {
              type: 'CUSTOM_FORMULA',
              values: [{ userEnteredValue: CONDITIONAL_FORMAT_FORMULA }],
            },
            format: {
              backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
              textFormat: { foregroundColor: { red: 0.5, green: 0.5, blue: 0.5 } },
            },
          },
        },
        index: 0,
      },
    });
  }

  // Needs Review tab — create if missing.
  const needsReviewExists = allTabs.some((s) => s.properties?.title === 'Needs Review');
  let needsReviewWillBeCreated = false;
  if (needsReviewExists) {
    console.log('Plan: "Needs Review" tab (already exists — skip)');
  } else {
    console.log('Plan: create "Needs Review" tab with 7 headers');
    needsReviewWillBeCreated = true;
    requests.push({
      addSheet: {
        properties: {
          title: 'Needs Review',
          gridProperties: { rowCount: 1000, columnCount: NEEDS_REVIEW_HEADERS.length },
        },
      },
    });
  }
  console.log();

  console.log('Applying batch update...');
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  console.log('✓ Batch update applied');

  // Populate Needs Review headers if we just created it.
  if (needsReviewWillBeCreated) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Needs Review'!A1:${colIndexToLetter(NEEDS_REVIEW_HEADERS.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [NEEDS_REVIEW_HEADERS] },
    });
    console.log('✓ "Needs Review" headers written');
  }

  console.log();
  console.log('Done. Re-run anytime — operations are idempotent.');
}

function pickTargetTab(allTabs: sheets_v4.Schema$Sheet[]): sheets_v4.Schema$Sheet | undefined {
  const override = process.env.TARGET_TAB;
  if (override) {
    const found = allTabs.find((s) => s.properties?.title === override);
    if (!found) {
      console.error(`✗ TARGET_TAB="${override}" not found among existing tabs.`);
      process.exit(1);
    }
    return found;
  }
  const named = allTabs.find((s) => s.properties?.title === 'All Purchases');
  if (named) return named;
  if (allTabs.length === 1) return allTabs[0];
  return undefined;
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
  const missing = [
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REFRESH_TOKEN', refreshToken],
    ['GOOGLE_SHEET_ID', spreadsheetId],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.error(`✗ Missing required env vars: ${missing.join(', ')}`);
    console.error('  Run `npm run auth` first if GOOGLE_REFRESH_TOKEN is missing.');
    process.exit(1);
  }
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    spreadsheetId: spreadsheetId!,
  };
}

function colIndexToLetter(index: number): string {
  let result = '';
  let i = index;
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  }
  return result;
}

function escapeTabName(name: string): string {
  return name.replace(/'/g, "''");
}

main().catch((err: unknown) => {
  console.error('✗ Bootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
