import { google, sheets_v4 } from 'googleapis';
import { formatInTimeZone } from 'date-fns-tz';
import { buildExistingKeySet, type DedupIndex } from './dedup.js';
import { STATUS_VALUES, type MasterRow, type Status, type Vocab } from './types.js';

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
