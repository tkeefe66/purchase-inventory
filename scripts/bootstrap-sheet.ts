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

const CRON_LOG_HEADERS = [
  'Run Timestamp',
  'Items Added',
  'Items By Source',
  'Items By Domain',
  'Returns Applied',
  'Messages Scanned',
  'Errors Count',
  'Duration (s)',
];

const CAMPING_INDEX_HEADERS = [
  'Facility ID', 'Name', 'Site URL', 'Map URL', 'Photo',
  'Agency', 'Parent Unit', 'Region', 'Lat', 'Lng',
  'Lead Days', 'Special Release', 'Fee',
  'Reservation Type', 'Use Type', 'Restrictions',
  'Tent-Eligible Sites', 'Active',
  'Rating', '# Reviews', 'Cell Bars (/5)', 'ADA Sites', 'Max RV Length (ft)',
  'Pets Allowed', 'Has Restrooms', 'Restroom Type', 'Drinking Water',
  'Season Opens', 'FCFS Start', 'Reservable Start', 'Season Close', 'Next Season Opens',
  'Next Release Moment',
  'Next Calendar Opens', 'Next Reminder Fires',
  'Muted', 'Notes',
];
const CAMPING_TRIPS_HEADERS = [
  'Trip ID', 'Facility ID', 'Visit Date', 'Planned At',
  '7-Day Fired At', 'Release-Moment Fired At', 'Cancelled At',
];

const PHOTOGRAPHY_ASSIGNMENTS_HEADERS = [
  'id',
  'date_issued',
  'date_submitted',
  'date_graded',
  'topic_id',
  'assignment_text',
  'rubric_json',
  'status',
  'submitted_photo_telegram_file_id',
  'camera',
  'lens',
  'settings_extracted',
  'ai_verdict',
  'ai_critique',
  'per_criterion_json',
  'retry_count',
  'user_notes',
  'skipped_reason',
];

const PHOTOGRAPHY_ASSIGNMENTS_STATUS_ENUM = [
  'proposed',
  'active',
  'submitted',
  'passed',
  'did_not_pass',
  'skipped',
];

const PHOTOGRAPHY_ASSIGNMENTS_VERDICT_ENUM = ['pass', 'did_not_pass', ''];

const PHOTOGRAPHY_PROGRESS_HEADERS = [
  'topic_id',
  'status',
  'last_activity_at',
  'assignments_passed',
  'assignments_failed',
  'theory_last_read_at',
];

const PHOTOGRAPHY_PROGRESS_STATUS_ENUM = [
  'locked',
  'available',
  'in-progress',
  'completed',
  'skipped',
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

  // Cron Log tab — create if missing.
  const cronLogExists = allTabs.some((s) => s.properties?.title === 'Cron Log');
  let cronLogWillBeCreated = false;
  if (cronLogExists) {
    console.log('Plan: "Cron Log" tab (already exists — skip)');
  } else {
    console.log('Plan: create "Cron Log" tab with 8 headers');
    cronLogWillBeCreated = true;
    requests.push({
      addSheet: {
        properties: {
          title: 'Cron Log',
          gridProperties: { rowCount: 1000, columnCount: CRON_LOG_HEADERS.length },
        },
      },
    });
  }

  // Camping Index tab — create if missing.
  const campingIndexExists = allTabs.some((s) => s.properties?.title === 'Camping Index');
  let campingIndexWillBeCreated = false;
  if (campingIndexExists) {
    console.log('Plan: "Camping Index" tab (already exists — skip)');
  } else {
    console.log(`Plan: create "Camping Index" tab with ${CAMPING_INDEX_HEADERS.length} headers`);
    campingIndexWillBeCreated = true;
    requests.push({
      addSheet: {
        properties: {
          title: 'Camping Index',
          gridProperties: { rowCount: 2000, columnCount: CAMPING_INDEX_HEADERS.length },
        },
      },
    });
  }

  // Camping Trips tab — cross-service shared trip state (replaces JSON file).
  const campingTripsExists = allTabs.some((s) => s.properties?.title === 'Camping Trips');
  let campingTripsWillBeCreated = false;
  if (campingTripsExists) {
    console.log('Plan: "Camping Trips" tab (already exists — skip)');
  } else {
    console.log(`Plan: create "Camping Trips" tab with ${CAMPING_TRIPS_HEADERS.length} headers`);
    campingTripsWillBeCreated = true;
    requests.push({
      addSheet: {
        properties: {
          title: 'Camping Trips',
          gridProperties: { rowCount: 500, columnCount: CAMPING_TRIPS_HEADERS.length },
        },
      },
    });
  }

  // Photography Assignments tab — one row per assignment issued to Tom.
  const photographyAssignmentsExists = allTabs.some(
    (s) => s.properties?.title === 'Photography Assignments',
  );
  let photographyAssignmentsWillBeCreated = false;
  if (photographyAssignmentsExists) {
    console.log('Plan: "Photography Assignments" tab (already exists — skip)');
  } else {
    console.log(
      `Plan: create "Photography Assignments" tab with ${PHOTOGRAPHY_ASSIGNMENTS_HEADERS.length} headers`,
    );
    photographyAssignmentsWillBeCreated = true;
    requests.push({
      addSheet: {
        properties: {
          title: 'Photography Assignments',
          gridProperties: {
            rowCount: 1000,
            columnCount: PHOTOGRAPHY_ASSIGNMENTS_HEADERS.length,
          },
        },
      },
    });
  }

  // Photography Progress tab — one row per curriculum topic, tracks completion state.
  const photographyProgressExists = allTabs.some(
    (s) => s.properties?.title === 'Photography Progress',
  );
  let photographyProgressWillBeCreated = false;
  if (photographyProgressExists) {
    console.log('Plan: "Photography Progress" tab (already exists — skip)');
  } else {
    console.log(
      `Plan: create "Photography Progress" tab with ${PHOTOGRAPHY_PROGRESS_HEADERS.length} headers`,
    );
    photographyProgressWillBeCreated = true;
    requests.push({
      addSheet: {
        properties: {
          title: 'Photography Progress',
          gridProperties: {
            rowCount: 200,
            columnCount: PHOTOGRAPHY_PROGRESS_HEADERS.length,
          },
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

  if (cronLogWillBeCreated) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Cron Log'!A1:${colLetter(CRON_LOG_HEADERS.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [CRON_LOG_HEADERS] },
    });
    console.log('✓ "Cron Log" headers written');
  }

  if (campingIndexWillBeCreated) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Camping Index'!A1:${colLetter(CAMPING_INDEX_HEADERS.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [CAMPING_INDEX_HEADERS] },
    });
    console.log('✓ "Camping Index" headers written');
  }

  if (campingTripsWillBeCreated) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Camping Trips'!A1:${colLetter(CAMPING_TRIPS_HEADERS.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [CAMPING_TRIPS_HEADERS] },
    });
    console.log('✓ "Camping Trips" headers written');
  }

  if (photographyAssignmentsWillBeCreated) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Photography Assignments'!A1:${colLetter(PHOTOGRAPHY_ASSIGNMENTS_HEADERS.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [PHOTOGRAPHY_ASSIGNMENTS_HEADERS] },
    });
    console.log('✓ "Photography Assignments" headers written');

    // Re-fetch the sheet to get the new tab's sheetId for data validation.
    const newMeta = await sheets.spreadsheets.get({ spreadsheetId });
    const assignmentsTab = (newMeta.data.sheets ?? []).find(
      (s) => s.properties?.title === 'Photography Assignments',
    );
    const assignmentsSheetId = assignmentsTab?.properties?.sheetId;
    if (assignmentsSheetId != null) {
      const assignmentsHeaderMap = buildHeaderMap(PHOTOGRAPHY_ASSIGNMENTS_HEADERS);
      const statusColIdx = assignmentsHeaderMap.get('status');
      const verdictColIdx = assignmentsHeaderMap.get('ai_verdict');
      const validationRequests: sheets_v4.Schema$Request[] = [];
      if (statusColIdx !== undefined) {
        validationRequests.push({
          setDataValidation: {
            range: {
              sheetId: assignmentsSheetId,
              startRowIndex: 1,
              startColumnIndex: statusColIdx,
              endColumnIndex: statusColIdx + 1,
            },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: PHOTOGRAPHY_ASSIGNMENTS_STATUS_ENUM.map((v) => ({ userEnteredValue: v })),
              },
              strict: true,
              showCustomUi: true,
            },
          },
        });
      }
      if (verdictColIdx !== undefined) {
        validationRequests.push({
          setDataValidation: {
            range: {
              sheetId: assignmentsSheetId,
              startRowIndex: 1,
              startColumnIndex: verdictColIdx,
              endColumnIndex: verdictColIdx + 1,
            },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: PHOTOGRAPHY_ASSIGNMENTS_VERDICT_ENUM.map((v) => ({ userEnteredValue: v })),
              },
              strict: false,
              showCustomUi: true,
            },
          },
        });
      }
      if (validationRequests.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: validationRequests },
        });
        console.log('✓ "Photography Assignments" data validation applied');
      }
    }
  }

  if (photographyProgressWillBeCreated) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'Photography Progress'!A1:${colLetter(PHOTOGRAPHY_PROGRESS_HEADERS.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [PHOTOGRAPHY_PROGRESS_HEADERS] },
    });
    console.log('✓ "Photography Progress" headers written');

    const newMeta = await sheets.spreadsheets.get({ spreadsheetId });
    const progressTab = (newMeta.data.sheets ?? []).find(
      (s) => s.properties?.title === 'Photography Progress',
    );
    const progressSheetId = progressTab?.properties?.sheetId;
    if (progressSheetId != null) {
      const progressHeaderMap = buildHeaderMap(PHOTOGRAPHY_PROGRESS_HEADERS);
      const statusColIdx = progressHeaderMap.get('status');
      if (statusColIdx !== undefined) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                setDataValidation: {
                  range: {
                    sheetId: progressSheetId,
                    startRowIndex: 1,
                    startColumnIndex: statusColIdx,
                    endColumnIndex: statusColIdx + 1,
                  },
                  rule: {
                    condition: {
                      type: 'ONE_OF_LIST',
                      values: PHOTOGRAPHY_PROGRESS_STATUS_ENUM.map((v) => ({
                        userEnteredValue: v,
                      })),
                    },
                    strict: true,
                    showCustomUi: true,
                  },
                },
              },
            ],
          },
        });
        console.log('✓ "Photography Progress" data validation applied');
      }
    }
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
