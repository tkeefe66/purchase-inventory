import { google, sheets_v4 } from 'googleapis';
import { formatInTimeZone } from 'date-fns-tz';
import { buildExistingKeySet, type DedupIndex } from './dedup.js';
import { STATUS_VALUES, type MasterRow, type Status, type Vocab } from './types.js';
import type { Facility } from './reccgov/types.js';
import { nextSeasonOpenDate, nextReminderDate, todayMtDateString } from './reccgov/seasons.js';

/**
 * Builds a name → column-index lookup from a sheet's header row. Use this for
 * every read/write so the code is robust to the user reordering columns in
 * the Sheets UI.
 */
export function buildHeaderMap(headerRow: readonly (string | null | undefined)[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headerRow.length; i++) {
    const h = (headerRow[i] ?? '').toString().trim();
    if (h) map.set(h, i);
  }
  return map;
}

/**
 * Converts a 0-indexed column position to its A1 letter. Handles multi-letter
 * columns: 0 → A, 25 → Z, 26 → AA, 27 → AB, 701 → ZZ, etc.
 */
export function colLetter(index: number): string {
  let result = '';
  let i = index;
  while (i >= 0) {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  }
  return result;
}

function getCell(row: readonly (string | number | null | undefined)[], map: ReadonlyMap<string, number>, name: string): string {
  const idx = map.get(name);
  if (idx === undefined) return '';
  const val = row[idx];
  if (val === undefined || val === null) return '';
  return val.toString().trim();
}

export interface SheetsClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export type SheetsClient = sheets_v4.Sheets;

export function createSheetsClient(cfg: SheetsClientConfig): SheetsClient {
  const oauth = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
  oauth.setCredentials({ refresh_token: cfg.refreshToken });
  return google.sheets({ version: 'v4', auth: oauth });
}

/**
 * Canonical header names for the master tab. Used to (a) tell bootstrap-sheet
 * which headers it must ensure exist, and (b) define the field-by-field
 * mapping used by readers/writers. **Position-independent** — the actual
 * column positions are looked up from the live header row at read/write time.
 */
const HEADERS = [
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
] as const;

async function readHeaderRow(
  sheets: SheetsClient,
  spreadsheetId: string,
  tabName: string,
): Promise<string[]> {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!1:1`,
  });
  return ((resp.data.values?.[0] ?? []) as Array<string | null | undefined>).map((s) =>
    (s ?? '').toString(),
  );
}

function requireColumns(map: ReadonlyMap<string, number>, names: readonly string[], tabName: string): void {
  const missing = names.filter((n) => !map.has(n));
  if (missing.length > 0) {
    const have = [...map.keys()].join(', ');
    throw new Error(
      `Required columns missing from "${tabName}" headers: [${missing.join(', ')}]. Found: [${have}]`,
    );
  }
}

/**
 * Pulls every data row in the `All Purchases` tab as a typed array.
 * Resolves columns by header *name*, not position — safe under column reordering.
 */
export async function readMasterRows(
  sheets: SheetsClient,
  spreadsheetId: string,
  tabName = 'All Purchases',
): Promise<MasterRow[]> {
  const headerRow = await readHeaderRow(sheets, spreadsheetId, tabName);
  const map = buildHeaderMap(headerRow);
  requireColumns(map, HEADERS, tabName);

  const lastCol = colLetter(headerRow.length - 1);
  const dataResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:${lastCol}`,
  });
  const raw = (dataResp.data.values ?? []) as Array<Array<string | number | null | undefined>>;

  return raw
    .filter((row) => row.some((cell) => cell !== '' && cell !== null && cell !== undefined))
    .map((row) => {
      const status = (getCell(row, map, 'Status') as MasterRow['status']) || 'active';
      const domain = (getCell(row, map, 'Domain') as MasterRow['domain']) || 'Other';
      const itemType = (getCell(row, map, 'Type') as MasterRow['type']) || 'Gear';
      const source = (getCell(row, map, 'Source') as MasterRow['source']) || 'REI';
      return {
        year: getCell(row, map, 'Year'),
        date: getCell(row, map, 'Date Purchased'),
        category: getCell(row, map, 'Category'),
        subCategory: getCell(row, map, 'Sub-Category'),
        brand: getCell(row, map, 'Brand'),
        itemName: getCell(row, map, 'Item Name'),
        color: getCell(row, map, 'Color'),
        size: getCell(row, map, 'Size'),
        qty: parseQty(getCell(row, map, 'Qty')),
        price: parsePrice(getCell(row, map, 'Price (Paid)')),
        source,
        orderId: getCell(row, map, 'Order ID'),
        status,
        domain,
        productUrl: getCell(row, map, 'Product URL'),
        type: itemType,
        reasoning: getCell(row, map, 'Reasoning'),
        notes: getCell(row, map, 'Notes'),
      };
    });
}

/**
 * Returns a DedupIndex for every row in the master tab. The index has both a
 * full-key set (for exact matches including Order ID + color + size) and a
 * blank-Order-ID-content set (for tolerant cross-matching of historical rows
 * against fresh-email rows). See `lib/dedup.ts` for the matching semantics.
 */
export async function readDedupKeys(
  sheets: SheetsClient,
  spreadsheetId: string,
  tabName = 'All Purchases',
): Promise<DedupIndex> {
  const rows = await readMasterRows(sheets, spreadsheetId, tabName);
  return buildExistingKeySet(
    rows.map((r) => ({
      orderId: r.orderId,
      brand: r.brand,
      itemName: r.itemName,
      color: r.color,
      size: r.size,
      productUrl: r.productUrl,
    })),
  );
}

/**
 * Builds the (Category, Sub-Category, Brand) vocabulary from existing rows.
 * Filters to active+retired rows so excluded/lost/etc. don't pollute the seed.
 */
export async function buildVocab(
  sheets: SheetsClient,
  spreadsheetId: string,
  tabName = 'All Purchases',
): Promise<Vocab> {
  const rows = await readMasterRows(sheets, spreadsheetId, tabName);
  const interesting = rows.filter((r) => r.status === 'active' || r.status === 'retired');

  const categoriesSet = new Set<string>();
  const subByCategory: Record<string, Set<string>> = {};
  const brandsSet = new Set<string>();

  for (const r of interesting) {
    if (r.category) {
      categoriesSet.add(r.category);
      if (!subByCategory[r.category]) subByCategory[r.category] = new Set();
      if (r.subCategory) subByCategory[r.category]!.add(r.subCategory);
    }
    if (r.brand) brandsSet.add(r.brand);
  }

  const subCategoriesByCategory: Record<string, string[]> = {};
  for (const [cat, set] of Object.entries(subByCategory)) {
    subCategoriesByCategory[cat] = [...set].sort();
  }

  return {
    categories: [...categoriesSet].sort(),
    subCategoriesByCategory,
    brands: [...brandsSet].sort(),
  };
}

/**
 * Appends the given rows to the master tab. Each row is written into the
 * positions specified by the live header order, so column reordering doesn't
 * shift values into the wrong cells.
 *
 * Returns the number of rows appended (always rows.length on success).
 */
export async function appendRows(
  sheets: SheetsClient,
  spreadsheetId: string,
  rows: MasterRow[],
  tabName = 'All Purchases',
): Promise<number> {
  if (rows.length === 0) return 0;
  const headerRow = await readHeaderRow(sheets, spreadsheetId, tabName);
  const map = buildHeaderMap(headerRow);
  requireColumns(map, HEADERS, tabName);

  const values = rows.map((r) => buildRowValues(headerRow.length, map, r));
  const lastCol = colLetter(headerRow.length - 1);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${tabName}'!A:${lastCol}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  return rows.length;
}

export async function appendMasterRow(
  sheets: SheetsClient,
  spreadsheetId: string,
  row: MasterRow,
): Promise<{ rowIndex: number }> {
  const headerRow = await readHeaderRow(sheets, spreadsheetId, 'All Purchases');
  const map = buildHeaderMap(headerRow);
  const out = buildRowValues(headerRow.length, map, row);
  const lastCol = colLetter(headerRow.length - 1);
  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'All Purchases'!A:${lastCol}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [out] },
  });
  const updatedRange = resp.data.updates?.updatedRange ?? '';
  const m = /![A-Z]+(\d+)/.exec(updatedRange);
  const rowIndex = m ? parseInt(m[1]!, 10) : -1;
  return { rowIndex };
}

function buildRowValues(
  length: number,
  map: ReadonlyMap<string, number>,
  r: MasterRow,
): Array<string | number> {
  const arr: Array<string | number> = new Array(length).fill('');
  const set = (name: string, val: string | number): void => {
    const idx = map.get(name);
    if (idx !== undefined) arr[idx] = val;
  };
  set('Year', r.year);
  set('Date Purchased', r.date);
  set('Category', r.category);
  set('Sub-Category', r.subCategory);
  set('Brand', r.brand);
  set('Item Name', r.itemName);
  set('Color', r.color);
  set('Size', r.size);
  set('Qty', r.qty);
  set('Price (Paid)', r.price);
  set('Source', r.source);
  set('Order ID', r.orderId);
  set('Status', r.status);
  set('Domain', r.domain);
  set('Product URL', r.productUrl);
  set('Type', r.type);
  set('Reasoning', r.reasoning);
  set('Notes', r.notes);
  return arr;
}

/**
 * Appends one or more rows to the `Needs Review` tab. Used when a parser
 * fails or returns low-confidence output for an email.
 */
export interface NeedsReviewEntry {
  source: string;        // "REI" | "Amazon"
  emailSubject: string;
  gmailMessageId: string;
  reason: string;        // "parse-failed" | "low-confidence" | "unknown-domain" | etc.
  rawExcerpt: string;    // first ~500 chars of body
}

export async function appendNeedsReview(
  sheets: SheetsClient,
  spreadsheetId: string,
  entries: NeedsReviewEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const dateDetected = new Date().toISOString();
  const values = entries.map((e) => [
    dateDetected,
    e.source,
    e.emailSubject,
    e.gmailMessageId,
    e.reason,
    e.rawExcerpt.slice(0, 500),
    'FALSE',
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'Needs Review'!A:G`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
  return entries.length;
}

function parseQty(s: string | number): number {
  const n = typeof s === 'number' ? s : parseInt(String(s).replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parsePrice(s: string | number): number {
  const n = typeof s === 'number' ? s : parseFloat(String(s).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export interface UpdateStatusInput {
  rowIndex: number;
  newStatus: Status;
}

export async function updateRowStatus(
  sheets: SheetsClient,
  spreadsheetId: string,
  input: UpdateStatusInput,
): Promise<void> {
  if (!STATUS_VALUES.includes(input.newStatus as Status)) {
    throw new Error(`Invalid status: ${input.newStatus}. Expected one of ${STATUS_VALUES.join(', ')}.`);
  }
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'All Purchases'!1:1`,
  });
  const headerRow = (headerResp.data.values?.[0] ?? []) as (string | null | undefined)[];
  const map = buildHeaderMap(headerRow);
  const statusCol = map.get('Status');
  if (statusCol === undefined) {
    throw new Error(`Status column not found in 'All Purchases' header row`);
  }
  const range = `'All Purchases'!${colLetter(statusCol)}${input.rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [[input.newStatus]] },
  });
}

/**
 * Updates a subset of cells across one or more rows in a single batch API call.
 *
 * `rowIndex` is the 1-based spreadsheet row number (so the first data row is 2,
 * not 0). `fields` is a partial MasterRow — only listed keys are written.
 * Empty / omitted keys leave the existing cell untouched.
 *
 * Uses `values.batchUpdate`, which accepts multiple non-contiguous ranges per
 * call — much cheaper than N separate `values.update` round-trips.
 */
export interface RowFieldsUpdate {
  rowIndex: number;
  fields: Partial<MasterRow>;
}

const FIELD_TO_HEADER: ReadonlyMap<keyof MasterRow, string> = new Map([
  ['year', 'Year'],
  ['date', 'Date Purchased'],
  ['category', 'Category'],
  ['subCategory', 'Sub-Category'],
  ['brand', 'Brand'],
  ['itemName', 'Item Name'],
  ['color', 'Color'],
  ['size', 'Size'],
  ['qty', 'Qty'],
  ['price', 'Price (Paid)'],
  ['source', 'Source'],
  ['orderId', 'Order ID'],
  ['status', 'Status'],
  ['domain', 'Domain'],
  ['productUrl', 'Product URL'],
  ['type', 'Type'],
  ['reasoning', 'Reasoning'],
  ['notes', 'Notes'],
]);

export async function updateRowFields(
  sheets: SheetsClient,
  spreadsheetId: string,
  updates: readonly RowFieldsUpdate[],
  tabName = 'All Purchases',
): Promise<void> {
  if (updates.length === 0) return;
  const headerRow = await readHeaderRow(sheets, spreadsheetId, tabName);
  const map = buildHeaderMap(headerRow);
  requireColumns(map, HEADERS, tabName);

  const data: Array<{ range: string; values: Array<Array<string | number>> }> = [];
  for (const upd of updates) {
    for (const [field, header] of FIELD_TO_HEADER) {
      const value = upd.fields[field];
      if (value === undefined) continue;
      const col = map.get(header);
      if (col === undefined) continue;
      data.push({
        range: `'${tabName}'!${colLetter(col)}${upd.rowIndex}`,
        values: [[value as string | number]],
      });
    }
  }
  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

export { HEADERS as MASTER_HEADERS };

const CRON_LOG_TAB = 'Cron Log';
const CRON_LOG_HEADER = [
  'Run Timestamp',
  'Items Added',
  'Items By Source',
  'Items By Domain',
  'Returns Applied',
  'Messages Scanned',
  'Errors Count',
  'Duration (s)',
] as const;

export interface CronLogRow {
  runTimestamp: string;
  itemsAdded: number;
  itemsBySource: Record<string, number>;
  itemsByDomain: Record<string, number>;
  returnsApplied: number;
  messagesScanned: number;
  errorsCount: number;
  durationSeconds: number;
}

async function ensureCronLogTab(sheets: SheetsClient, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === CRON_LOG_TAB,
  );
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: CRON_LOG_TAB } } }],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${CRON_LOG_TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [Array.from(CRON_LOG_HEADER)] },
  });
}

export async function appendCronLogRow(
  sheets: SheetsClient,
  spreadsheetId: string,
  row: CronLogRow,
): Promise<void> {
  await ensureCronLogTab(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${CRON_LOG_TAB}'!A:H`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        row.runTimestamp,
        row.itemsAdded,
        JSON.stringify(row.itemsBySource),
        JSON.stringify(row.itemsByDomain),
        row.returnsApplied,
        row.messagesScanned,
        row.errorsCount,
        row.durationSeconds,
      ]],
    },
  });
}

export async function readCronLogToday(
  sheets: SheetsClient,
  spreadsheetId: string,
  todayMt: string,  // 'YYYY-MM-DD' in Mountain time
): Promise<CronLogRow[]> {
  let raw: (string | number)[][];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${CRON_LOG_TAB}'!A:H`,
    });
    raw = (resp.data.values ?? []) as (string | number)[][];
  } catch (err) {
    // Only swallow "tab/range not found" — let real failures (auth, quota,
    // network) propagate so the cron's error path surfaces them.
    const code = (err as { code?: number }).code;
    if (code === 400 || code === 404) return [];
    throw err;
  }
  if (raw.length < 2) return [];

  const out: CronLogRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i]!;
    const tsRaw = String(r[0] ?? '');
    if (!tsRaw) continue;
    const ts = new Date(tsRaw);
    if (Number.isNaN(ts.getTime())) continue;
    const tsMtDate = formatInTimeZone(ts, 'America/Denver', 'yyyy-MM-dd');
    if (tsMtDate !== todayMt) continue;
    out.push({
      runTimestamp: tsRaw,
      itemsAdded: Number(r[1] ?? 0),
      itemsBySource: safeJson(String(r[2] ?? '{}')),
      itemsByDomain: safeJson(String(r[3] ?? '{}')),
      returnsApplied: Number(r[4] ?? 0),
      messagesScanned: Number(r[5] ?? 0),
      errorsCount: Number(r[6] ?? 0),
      durationSeconds: Number(r[7] ?? 0),
    });
  }
  return out;
}

export async function pruneCronLog(
  sheets: SheetsClient,
  spreadsheetId: string,
  olderThanDays: number,
): Promise<{ deleted: number }> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = (meta.data.sheets ?? []).find((s) => s.properties?.title === CRON_LOG_TAB);
  if (!tab?.properties?.sheetId) return { deleted: 0 };
  const sheetId = tab.properties.sheetId;

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CRON_LOG_TAB}'!A:H`,
  });
  const rows = (resp.data.values ?? []) as (string | number)[][];
  if (rows.length < 2) return { deleted: 0 };

  const cutoff = Date.now() - olderThanDays * 86400 * 1000;
  const toDelete: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const ts = new Date(String(rows[i]![0] ?? ''));
    if (Number.isNaN(ts.getTime())) continue;
    if (ts.getTime() < cutoff) toDelete.push(i);
  }
  if (toDelete.length === 0) return { deleted: 0 };

  // Sort descending so earlier deletes don't shift indices of later ones.
  toDelete.sort((a, b) => b - a);
  const requests = toDelete.map((i) => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 },
    },
  }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  return { deleted: toDelete.length };
}

function safeJson(s: string): Record<string, number> {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Camping Index tab helpers
// ---------------------------------------------------------------------------

const CAMPING_INDEX_TAB = 'Camping Index';
const CAMPING_INDEX_HEADER = [
  'Facility ID', 'Name', 'Site URL', 'Map URL',
  'Agency', 'Parent Unit', 'Region', 'Lat', 'Lng',
  'Lead Days', 'Special Release', 'Fee',
  'Reservation Type', 'Use Type', 'Restrictions', 'Has Restrooms',
  'Amenities', 'Tent-Eligible Sites', 'Active',
  // Rec.gov booking-windows data (this season's actual dates, from /rates)
  'Season Opens', 'FCFS Start', 'Reservable Start', 'Season Close', 'Next Season Opens',
  'Next Release Moment',
  // Heuristic next-year planning (used when Rec.gov /rates data unavailable)
  'Next Calendar Opens', 'Next Reminder Fires',
  'Muted', 'Notes',
] as const;

// End-of-column reference for range strings, e.g. "A:AE" for the 31-column tab.
// Uses the top-level colLetter exported above.
const CAMPING_INDEX_RANGE_END = colLetter(CAMPING_INDEX_HEADER.length - 1);

function siteUrlFor(facilityId: string): string {
  return `https://www.recreation.gov/camping/campgrounds/${facilityId}`;
}

function mapUrlFor(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function fmtReleaseTimeMt(iso: string | null | undefined): string {
  if (!iso) return '';
  // Render the API release moment in Mountain Time for human readability.
  // The bot fires the alert at the precise moment regardless of format here.
  try {
    return formatInTimeZone(new Date(iso), 'America/Denver', "yyyy-MM-dd HH:mm zzz");
  } catch {
    return '';
  }
}

async function ensureCampingIndexTab(sheets: SheetsClient, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === CAMPING_INDEX_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: CAMPING_INDEX_TAB } } }] },
    });
  }
  // Always ensure the header row matches the current schema. This makes the
  // mirror self-healing across column-schema migrations (e.g. when new
  // computed columns are added — without this, a tab created under an older
  // schema would keep its stale headers and new mirrors would write data
  // into the wrong columns).
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CAMPING_INDEX_TAB}'!1:1`,
  });
  const currentHeader = (headerResp.data.values?.[0] ?? []) as string[];
  const expected = Array.from(CAMPING_INDEX_HEADER);
  const stale = currentHeader.length !== expected.length
    || expected.some((h, i) => currentHeader[i] !== h);
  if (stale) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${CAMPING_INDEX_TAB}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [expected] },
    });
  }
}

function facilityRow(f: Facility, todayMt: string): (string | number | boolean)[] {
  const open = nextSeasonOpenDate(f, todayMt);
  const reminder = nextReminderDate(f, todayMt);
  const bw = f.bookingWindows ?? null;
  // Site URL only emitted for active facilities. /camping/campgrounds/<id>
  // 200s to a generic "something went wrong" homepage for non-campground
  // facility IDs (trailheads, ranger districts, etc.), so emitting URLs for
  // inactive rows just creates dead links.
  const siteUrl = f.active ? siteUrlFor(f.facilityId) : '';
  return [
    f.facilityId, f.name, siteUrl, mapUrlFor(f.lat, f.lng),
    f.agency, f.parentUnit, f.region ?? '',
    f.lat, f.lng, f.leadTimeDays, f.specialReleaseDate ?? '', f.feeUSD,
    f.reservationType, f.useType,
    f.restrictions.join('; '), f.hasRestrooms,
    f.amenities.join('; '), f.tentEligibleSites.length, f.active,
    // Tier-3 booking windows (real Rec.gov data, empty when /rates unavailable)
    bw?.seasonOpenDate ?? '', bw?.fcfsStartDate ?? '', bw?.reservableStartDate ?? '',
    bw?.seasonCloseDate ?? '', bw?.nextSeasonStartDate ?? '',
    fmtReleaseTimeMt(f.nextReleaseAtIso),
    // Heuristic next-year planning
    open ?? '', reminder ?? '',
  ];
}

export async function mirrorCampingIndex(
  sheets: SheetsClient,
  spreadsheetId: string,
  facilities: readonly Facility[],
): Promise<void> {
  await ensureCampingIndexTab(sheets, spreadsheetId);
  const todayMt = todayMtDateString(new Date());
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CAMPING_INDEX_TAB}'!A:${CAMPING_INDEX_RANGE_END}`,
  });
  const rows = (resp.data.values ?? []) as (string | number | boolean)[][];
  const header = rows[0] ?? Array.from(CAMPING_INDEX_HEADER);
  const idIdx = header.indexOf('Facility ID');
  const mutedIdx = header.indexOf('Muted');
  const notesIdx = header.indexOf('Notes');

  const existingById = new Map<string, { gridRow: number; muted: unknown; notes: unknown }>();
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i]![idIdx] ?? '');
    if (!id) continue;
    existingById.set(id, {
      gridRow: i + 1,
      muted: rows[i]![mutedIdx],
      notes: rows[i]![notesIdx],
    });
  }

  const valueUpdates: { range: string; values: unknown[][] }[] = [];
  const toAppend: unknown[][] = [];
  for (const f of facilities) {
    const row = facilityRow(f, todayMt);
    const existing = existingById.get(f.facilityId);
    if (existing) {
      const muted: string | number | boolean = (typeof existing.muted === 'boolean' || typeof existing.muted === 'string' || typeof existing.muted === 'number') ? existing.muted : false;
      const notes: string | number | boolean = (typeof existing.notes === 'string' || typeof existing.notes === 'number' || typeof existing.notes === 'boolean') ? existing.notes : '';
      row.push(muted);
      row.push(notes);
      valueUpdates.push({
        range: `'${CAMPING_INDEX_TAB}'!A${existing.gridRow}`,
        values: [row],
      });
    } else {
      row.push(false);
      row.push('');
      toAppend.push(row);
    }
  }
  // Batch all per-row updates into a single API call to stay under Sheets'
  // 60 writes/min/user quota — N facilities = 1 request instead of N.
  if (valueUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data: valueUpdates },
    });
  }
  if (toAppend.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${CAMPING_INDEX_TAB}'!A:${CAMPING_INDEX_RANGE_END}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: toAppend },
    });
  }
}

export async function readMutedFacilityIds(
  sheets: SheetsClient,
  spreadsheetId: string,
): Promise<string[]> {
  let raw: (string | number | boolean)[][];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${CAMPING_INDEX_TAB}'!A:${CAMPING_INDEX_RANGE_END}`,
    });
    raw = (resp.data.values ?? []) as (string | number | boolean)[][];
  } catch { return []; }
  if (raw.length < 2) return [];
  const header = raw[0]!;
  const idIdx = header.indexOf('Facility ID');
  const mutedIdx = header.indexOf('Muted');
  if (idIdx < 0 || mutedIdx < 0) return [];
  const out: string[] = [];
  for (let i = 1; i < raw.length; i++) {
    const id = String(raw[i]![idIdx] ?? '');
    const muted = raw[i]![mutedIdx];
    if (id && (muted === true || muted === 'TRUE' || muted === 'true')) out.push(id);
  }
  return out;
}

export async function setMutedInCampingIndex(
  sheets: SheetsClient,
  spreadsheetId: string,
  facilityIds: string[],
  muted: boolean,
): Promise<void> {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CAMPING_INDEX_TAB}'!A:${CAMPING_INDEX_RANGE_END}`,
  });
  const rows = (resp.data.values ?? []) as (string | number | boolean)[][];
  if (rows.length < 2) return;
  const header = rows[0]!;
  const idIdx = header.indexOf('Facility ID');
  const mutedColIdx = header.indexOf('Muted');
  if (idIdx < 0 || mutedColIdx < 0) return;
  const targetSet = new Set(facilityIds);
  for (let i = 1; i < rows.length; i++) {
    const id = String(rows[i]![idIdx] ?? '');
    if (!targetSet.has(id)) continue;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${CAMPING_INDEX_TAB}'!${colLetter(mutedColIdx)}${i + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[muted]] },
    });
  }
}

/**
 * Read the Camping Index sheet tab and reconstruct CampingIndex (Facility[]).
 *
 * Used by the bot service so it doesn't need a synchronized JSON volume —
 * the sheet IS the cross-service source of truth (the cron mirrors to it
 * after each refresh phase). Returns whatever the sheet currently shows;
 * facilities with empty Facility ID are dropped.
 */
export async function readCampingIndexFromSheet(
  sheets: SheetsClient,
  spreadsheetId: string,
): Promise<import('./reccgov/types.js').CampingIndex> {
  let resp;
  try {
    resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${CAMPING_INDEX_TAB}'!A:${CAMPING_INDEX_RANGE_END}`,
    });
  } catch {
    return { facilities: [] };
  }
  const rows = (resp.data.values ?? []) as (string | number | boolean)[][];
  if (rows.length < 2) return { facilities: [] };
  const header = (rows[0] as (string | undefined)[]).map((h) => String(h ?? ''));
  const map = new Map(header.map((h, i) => [h, i]));
  const idx = (name: string): number => map.get(name) ?? -1;
  const cell = (row: (string | number | boolean)[], name: string): string | number | boolean | undefined => {
    const i = idx(name);
    return i >= 0 ? row[i] : undefined;
  };
  const cellStr = (row: (string | number | boolean)[], name: string): string => {
    const v = cell(row, name);
    return v === undefined || v === null ? '' : String(v);
  };
  const cellNum = (row: (string | number | boolean)[], name: string): number => {
    const v = cell(row, name);
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
    return 0;
  };
  const cellBool = (row: (string | number | boolean)[], name: string): boolean => {
    const v = cell(row, name);
    return v === true || v === 'TRUE' || v === 'true';
  };

  type Facility = import('./reccgov/types.js').Facility;
  const facilities: Facility[] = [];
  for (const row of rows.slice(1)) {
    const id = cellStr(row, 'Facility ID');
    if (!id) continue;
    const seasonOpen = cellStr(row, 'Season Opens');
    const fcfsStart = cellStr(row, 'FCFS Start');
    const reservableStart = cellStr(row, 'Reservable Start');
    const seasonClose = cellStr(row, 'Season Close');
    const nextSeasonStart = cellStr(row, 'Next Season Opens');
    const hasBW = !!(seasonOpen || fcfsStart || reservableStart || seasonClose || nextSeasonStart);
    const restrictionsRaw = cellStr(row, 'Restrictions');
    const amenitiesRaw = cellStr(row, 'Amenities');
    const f: Facility = {
      facilityId: id,
      name: cellStr(row, 'Name'),
      state: 'CO',
      parentUnit: cellStr(row, 'Parent Unit'),
      region: cellStr(row, 'Region') || null,
      lat: cellNum(row, 'Lat'),
      lng: cellNum(row, 'Lng'),
      agency: (cellStr(row, 'Agency') || 'USFS') as import('./reccgov/types.js').Agency,
      useType: (cellStr(row, 'Use Type') || 'overnight') as import('./reccgov/types.js').UseType,
      leadTimeDays: cellNum(row, 'Lead Days') || 180,
      specialReleaseDate: cellStr(row, 'Special Release') || null,
      seasonStart: cellStr(row, 'Season Start') || null,
      seasonEnd: cellStr(row, 'Season End') || null,
      feeUSD: cellNum(row, 'Fee'),
      reservationType: (cellStr(row, 'Reservation Type') || 'reservation') as import('./reccgov/types.js').ReservationType,
      tentEligibleSites: [] as string[],
      totalSites: cellNum(row, 'Tent-Eligible Sites'),
      restrictions: restrictionsRaw ? restrictionsRaw.split('; ').filter(Boolean) : [],
      amenities: amenitiesRaw ? amenitiesRaw.split('; ').filter(Boolean) : [],
      hasRestrooms: cellBool(row, 'Has Restrooms'),
      reservationUrl: '',
      lastMetadataRefresh: '',
      active: cellBool(row, 'Active'),
      nextReleaseAtIso: null,
      bookingWindows: hasBW ? {
        seasonOpenDate: seasonOpen || null,
        fcfsStartDate: fcfsStart || null,
        reservableStartDate: reservableStart || null,
        seasonCloseDate: seasonClose || null,
        nextSeasonStartDate: nextSeasonStart || null,
      } : null,
    };
    facilities.push(f);
  }
  return { facilities };
}

// ---------------------------------------------------------------------------
// Camping Trips tab — shared cross-service trip state
// ---------------------------------------------------------------------------
//
// The bot and camping-cron need to share trip state for /plan-trip to actually
// trigger release alerts. Because Railway volumes are single-attach, we use
// the Google Sheet as the cross-service source of truth (same pattern as the
// Muted column in Camping Index).
//
// Schema: one row per trip, columns:
//   A  Trip ID (UUID)
//   B  Facility ID
//   C  Visit Date (YYYY-MM-DD)
//   D  Planned At (ISO timestamp)
//   E  7-Day Nudge Fired At (ISO or empty)
//   F  Release-Moment Nudge Fired At (ISO or empty)
//   G  Cancelled At (ISO or empty)

const CAMPING_TRIPS_TAB = 'Camping Trips';
const CAMPING_TRIPS_HEADER = [
  'Trip ID', 'Facility ID', 'Visit Date', 'Planned At',
  '7-Day Fired At', 'Release-Moment Fired At', 'Cancelled At',
] as const;
const CAMPING_TRIPS_RANGE_END = colLetter(CAMPING_TRIPS_HEADER.length - 1);

async function ensureCampingTripsTab(sheets: SheetsClient, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === CAMPING_TRIPS_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: CAMPING_TRIPS_TAB } } }] },
    });
  }
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CAMPING_TRIPS_TAB}'!1:1`,
  });
  const currentHeader = (headerResp.data.values?.[0] ?? []) as string[];
  const expected = Array.from(CAMPING_TRIPS_HEADER);
  const stale = currentHeader.length !== expected.length
    || expected.some((h, i) => currentHeader[i] !== h);
  if (stale) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${CAMPING_TRIPS_TAB}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [expected] },
    });
  }
}

export async function readCampingTripsFromSheet(
  sheets: SheetsClient,
  spreadsheetId: string,
): Promise<import('./reccgov/types.js').CampingTrips> {
  await ensureCampingTripsTab(sheets, spreadsheetId);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CAMPING_TRIPS_TAB}'!A:${CAMPING_TRIPS_RANGE_END}`,
  });
  const rows = (resp.data.values ?? []) as (string | number | boolean)[][];
  if (rows.length < 2) return { trips: [] };
  return {
    trips: rows.slice(1).map((row) => ({
      id: String(row[0] ?? ''),
      facilityId: String(row[1] ?? ''),
      visitDate: String(row[2] ?? ''),
      plannedAt: String(row[3] ?? ''),
      nudges: [
        { kind: '7-day' as const, firedAt: row[4] ? String(row[4]) : null },
        { kind: 'release-moment' as const, firedAt: row[5] ? String(row[5]) : null },
      ],
      cancelledAt: row[6] ? String(row[6]) : null,
    })).filter((t) => t.id),
  };
}

export async function writeCampingTripsToSheet(
  sheets: SheetsClient,
  spreadsheetId: string,
  trips: import('./reccgov/types.js').CampingTrips,
): Promise<void> {
  await ensureCampingTripsTab(sheets, spreadsheetId);
  // Clear all data rows (preserving the header at row 1), then append the new state.
  // Single user, low volume — atomicity tradeoff is fine.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${CAMPING_TRIPS_TAB}'!A2:${CAMPING_TRIPS_RANGE_END}`,
  });
  if (trips.trips.length === 0) return;
  const values = trips.trips.map((t) => [
    t.id, t.facilityId, t.visitDate, t.plannedAt,
    t.nudges.find((n) => n.kind === '7-day')?.firedAt ?? '',
    t.nudges.find((n) => n.kind === 'release-moment')?.firedAt ?? '',
    t.cancelledAt ?? '',
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${CAMPING_TRIPS_TAB}'!A:${CAMPING_TRIPS_RANGE_END}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}
