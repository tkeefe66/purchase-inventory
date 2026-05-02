import 'dotenv/config';
import { google, sheets_v4 } from 'googleapis';
import { buildHeaderMap, colLetter } from '../lib/sheets.js';

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
  'Type',
  'Reasoning',
  'Notes',
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

const DOMAIN_ENUM = [
  'Outdoor',
  'Photography',
  'Kitchen',
  'Home',
  'Tech',
  'Wardrobe',
  'Auto',
  'Fitness',
  'Health',
  'Media',
  'Other',
];

const TYPE_ENUM = ['Gear', 'Consumable', 'Service'];

const NEEDS_REVIEW_HEADERS = [
  'Date Detected',
  'Source',
  'Email Subject',
  'Gmail Message ID',
  'Reason',
  'Raw Excerpt',
  'Resolved',
];

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
  for (const name of tabNames) console.log(`  - "${name}"`);
  console.log();

  const targetTab = pickTargetTab(allTabs);
  if (!targetTab) {
    console.error('✗ Could not determine which tab to bootstrap.');
    console.error('  Expected a tab named "All Purchases", or set TARGET_TAB=<name> in .env.');
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

  // Read existing header row
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${escapeTabName(targetTitle)}'!1:1`,
  });
  const existingHeaders = ((headerResp.data.values?.[0] ?? []) as Array<string | null | undefined>).map(
    (s) => (s ?? '').toString(),
  );
  const headerMap = buildHeaderMap(existingHeaders);

  console.log('Current headers (in physical order):');
  for (let i = 0; i < Math.max(existingHeaders.length, EXPECTED_HEADERS.length); i++) {
    const colL = colLetter(i);
    const existing = existingHeaders[i] ?? '';
    console.log(`  ${colL.padStart(2)}: ${existing ? `"${existing}"` : '(empty)'}`);
  }
  console.log();

  // === Plan + apply: append any missing headers at end of row ===
  const missingHeaders = EXPECTED_HEADERS.filter((h) => !headerMap.has(h));
  if (missingHeaders.length > 0) {
    let nextCol = existingHeaders.length;
    console.log(`Appending ${missingHeaders.length} missing header(s) at end:`);
    const updates: { range: string; value: string }[] = [];
    for (const h of missingHeaders) {
      const colL = colLetter(nextCol);
      console.log(`  ${colL} = "${h}"`);
      updates.push({ range: `'${escapeTabName(targetTitle)}'!${colL}1`, value: h });
      headerMap.set(h, nextCol);
      nextCol++;
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
      },
    });
    console.log('✓ Headers added');
  } else {
    console.log('✓ All expected headers present (in any order)');
  }
  console.log();

  // === Plan + apply: data validation, conditional formatting, Needs Review tab ===
  const requests: sheets_v4.Schema$Request[] = [];

  const dropdowns: Array<{ headerName: string; values: string[] }> = [
    { headerName: 'Status', values: STATUS_ENUM },
    { headerName: 'Domain', values: DOMAIN_ENUM },
    { headerName: 'Type', values: TYPE_ENUM },
  ];
  for (const d of dropdowns) {
    const colIdx = headerMap.get(d.headerName);
    if (colIdx === undefined) {
      console.warn(`  ⚠ Header "${d.headerName}" not found — skipping dropdown`);
      continue;
    }
    requests.push({
      setDataValidation: {
        range: {
          sheetId: targetSheetId,
          startRowIndex: 1, // skip header row
          startColumnIndex: colIdx,
          endColumnIndex: colIdx + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: d.values.map((v) => ({ userEnteredValue: v })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    });
    console.log(
      `Plan: data validation on column ${colLetter(colIdx)} (${d.headerName}: ${d.values.join(', ')})`,
    );
  }

  // Conditional formatting — formula references the Status column dynamically.
  const statusColIdx = headerMap.get('Status');
  if (statusColIdx === undefined) {
    console.warn('  ⚠ Status column not found — skipping conditional formatting');
  } else {
    const statusColLetter = colLetter(statusColIdx);
    const formula = `=$${statusColLetter}2<>"active"`;
    const existingRules = targetTab.conditionalFormats ?? [];
    const formatRuleAlreadyExists = existingRules.some(
      (r) =>
        r.booleanRule?.condition?.type === 'CUSTOM_FORMULA' &&
        r.booleanRule.condition.values?.[0]?.userEnteredValue === formula,
    );
    if (formatRuleAlreadyExists) {
      console.log(`Plan: conditional formatting (already present for ${formula} — skip)`);
    } else {
      console.log(`Plan: conditional formatting — gray rows where ${formula}`);
      requests.push({
        addConditionalFormatRule: {
          rule: {
            ranges: [
              {
                sheetId: targetSheetId,
                startRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: Math.max(EXPECTED_HEADERS.length, existingHeaders.length),
              },
            ],
            booleanRule: {
              condition: {
                type: 'CUSTOM_FORMULA',
                values: [{ userEnteredValue: formula }],
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

  if (needsReviewWillBeCreated) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Needs Review'!A1:${colLetter(NEEDS_REVIEW_HEADERS.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [NEEDS_REVIEW_HEADERS] },
    });
    console.log('✓ "Needs Review" headers written');
  }

  console.log();
  console.log('Done. Re-run anytime — operations are idempotent under column reordering.');
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

function escapeTabName(name: string): string {
  return name.replace(/'/g, "''");
}

main().catch((err: unknown) => {
  console.error('✗ Bootstrap failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
