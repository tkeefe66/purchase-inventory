import 'dotenv/config';
import {
  createSheetsClient,
  readMasterRows,
  updateRowFields,
} from '../lib/sheets.js';
import type { EntryMethod, MasterRow } from '../lib/types.js';

/**
 * Backfills the `Entry Method` column for existing rows. Infers the method
 * from the orderId pattern — robust to the user having already swapped Source
 * away from "Image" on photo-uploaded rows.
 *
 * Patterns:
 *   IMG-YYYYMMDD-xxxxxx          → photo  (from /addgear)
 *   A\d{8,}                      → email  (REI online)
 *   S\d+-T\d+                    → email  (REI in-store eReceipt)
 *   \d{3}-\d{7}-\d{7}            → email  (Amazon)
 *   anything else                → import (historical CSV)
 *
 * Usage:
 *   npm run backfill-entry-method            # dry run by default
 *   npm run backfill-entry-method -- --write # actually write
 */

const IMG_RE = /^IMG-\d{8}-[a-f0-9]{6,}$/;
const REI_ONLINE_RE = /^A\d{8,}$/;
const REI_STORE_RE = /^S\d+-T\d+$/;
const AMAZON_RE = /^\d{3}-\d{7}-\d{7}$/;

export function inferEntryMethod(orderId: string): EntryMethod {
  const id = orderId.trim();
  if (IMG_RE.test(id)) return 'photo';
  if (REI_ONLINE_RE.test(id)) return 'email';
  if (REI_STORE_RE.test(id)) return 'email';
  if (AMAZON_RE.test(id)) return 'email';
  return 'import';
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  const rows = await readMasterRows(sheets, spreadsheetId);
  console.log(`Read ${rows.length} rows from "All Purchases".`);

  const counts: Record<EntryMethod, number> = {
    email: 0, photo: 0, manual: 0, import: 0,
  };
  const updates: Array<{ rowIndex: number; fields: Partial<MasterRow> }> = [];

  rows.forEach((r, i) => {
    const inferred = inferEntryMethod(r.orderId);
    counts[inferred]++;
    // Skip rows that already match — keeps the script idempotent and the
    // batchUpdate payload small on re-runs.
    if (r.entryMethod === inferred) return;
    updates.push({
      rowIndex: i + 2, // +1 for 1-based, +1 to skip header row
      fields: { entryMethod: inferred },
    });
  });

  console.log('Inferred counts:');
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(8)} ${v}`);
  }
  console.log(`Need to write: ${updates.length} rows.`);

  if (updates.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  if (!write) {
    console.log('\nDry run — no changes written. Re-run with --write to apply.');
    return;
  }

  await updateRowFields(sheets, spreadsheetId, updates);
  console.log(`Wrote ${updates.length} updates.`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
