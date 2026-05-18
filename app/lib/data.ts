import 'server-only';
import { createSheetsClient, readMasterRows } from '../../lib/sheets.js';
import type { MasterRow } from '../../lib/types.js';

function client() {
  return createSheetsClient({
    clientId: process.env['GOOGLE_CLIENT_ID']!,
    clientSecret: process.env['GOOGLE_CLIENT_SECRET']!,
    refreshToken: process.env['GOOGLE_REFRESH_TOKEN']!,
  });
}

export async function getMasterRows(): Promise<MasterRow[]> {
  return readMasterRows(client(), process.env['GOOGLE_SHEET_ID']!);
}

export interface NeedsReviewRow {
  dateDetected: string;
  source: string;
  emailSubject: string;
  gmailMessageId: string;
  reason: string;
  rawExcerpt: string;
  resolved: boolean;
}

/**
 * Read the "Needs Review" tab. The cron writes these rows when a parser
 * fails or returns low-confidence output — they sit here until an admin
 * manually flips the Resolved column.
 */
export async function getNeedsReviewRows(): Promise<NeedsReviewRow[]> {
  const sheets = client();
  const spreadsheetId = process.env['GOOGLE_SHEET_ID']!;
  let resp;
  try {
    resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'Needs Review'!A:G`,
    });
  } catch {
    return [];
  }
  const rows = (resp.data.values ?? []) as (string | number | boolean)[][];
  if (rows.length < 2) return [];
  return rows.slice(1)
    .filter((r) => r.some((c) => c !== '' && c !== null && c !== undefined))
    .map((r) => ({
      dateDetected: String(r[0] ?? ''),
      source: String(r[1] ?? ''),
      emailSubject: String(r[2] ?? ''),
      gmailMessageId: String(r[3] ?? ''),
      reason: String(r[4] ?? ''),
      rawExcerpt: String(r[5] ?? ''),
      resolved: String(r[6] ?? '').toUpperCase() === 'TRUE',
    }));
}
