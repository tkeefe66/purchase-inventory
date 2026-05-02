import { google, sheets_v4 } from 'googleapis';
import { makeDedupKey } from './dedup.js';
import type { MasterRow, Vocab } from './types.js';

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
      };
    });
}

/**
 * Returns the set of dedup keys (Order ID || Item Name || Color || Size) for
 * every row in the master tab. Used by the cron pipeline to skip already-
 * ingested items before appending.
 */
export async function readDedupKeys(
  sheets: SheetsClient,
  spreadsheetId: string,
  tabName = 'All Purchases',
): Promise<Set<string>> {
  const rows = await readMasterRows(sheets, spreadsheetId, tabName);
  return new Set(
    rows.map((r) =>
      makeDedupKey({
        orderId: r.orderId,
        itemName: r.itemName,
        color: r.color,
        size: r.size,
      }),
    ),
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

export { HEADERS as MASTER_HEADERS };
