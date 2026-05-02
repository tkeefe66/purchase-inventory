import 'dotenv/config';
import { google, sheets_v4 } from 'googleapis';
import { makeContentKey, makeDedupKey } from '../lib/dedup.js';
import { createSheetsClient, readMasterRows } from '../lib/sheets.js';

/**
 * Scans `All Purchases` for duplicate rows under the new dedup key shape
 * (orderId, brand, normalized itemName, color, size — with brand-prefix
 * stripping), groups by key, keeps the OLDEST row in each group, and prints
 * (or removes with --apply) the rest.
 *
 * Use this once to clean up duplicates that snuck in before the parser /
 * dedup were aware of the brand-prefix normalization.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`Mode: ${apply ? 'APPLY (will delete duplicate rows)' : 'DRY RUN (no writes)'}\n`);

  const env = readEnv();
  const sheets = createSheetsClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });

  const rows = await readMasterRows(sheets, env.spreadsheetId);
  console.log(`✓ Read ${rows.length} rows from All Purchases\n`);

  // Group by CONTENT key (brand + normalized item name) — color/size are NOT
  // part of the grouping because manual historical entry vs email-parsed data
  // often have minor formatting variations there. Two rows with the same
  // brand+name are treated as candidate duplicates regardless of color/size.
  const groups = new Map<string, Array<{ row: (typeof rows)[number]; sheetRowIndex1: number }>>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const groupKey = makeContentKey({ brand: r.brand, itemName: r.itemName });
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({ row: r, sheetRowIndex1: i + 2 }); // +2: header is row 1, data starts at 2
  }

  const duplicatesToRemove: Array<{ row: (typeof rows)[number]; sheetRowIndex1: number; reason: string }> = [];
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.row.date.localeCompare(b.row.date));

    const orderIds = new Set(members.map((m) => m.row.orderId.trim()));
    const hasBlank = orderIds.has('');
    const realIds = [...orderIds].filter((x) => x !== '');

    // Case A: at least one member has blank Order ID + at least one has a real
    // Order ID → historical no-Order-ID row shadowed by fresh email. Keep the
    // blank-Order-ID row (the original entry); remove the fresh ones.
    if (hasBlank && realIds.length > 0) {
      const keep = members.find((m) => !m.row.orderId.trim())!;
      for (const m of members) {
        if (m === keep) continue;
        duplicatesToRemove.push({
          row: m.row,
          sheetRowIndex1: m.sheetRowIndex1,
          reason: `Cross-match dup: same brand+name as historical row ${keep.sheetRowIndex1} (kept). Color/size may differ slightly between manual entry and email parse.`,
        });
      }
      continue;
    }

    // Case B: multiple rows share the SAME real Order ID — same shipment counted
    // twice. Look at color/size to confirm they're truly identical (in same order
    // we DO want different colors as distinct rows); only remove if they match.
    if (!hasBlank && realIds.length === 1) {
      // Sub-group by full key (orderId + brand + name + color + size).
      const exactSubgroups = new Map<string, typeof members>();
      for (const m of members) {
        const k = makeDedupKey({
          orderId: m.row.orderId,
          brand: m.row.brand,
          itemName: m.row.itemName,
          color: m.row.color,
          size: m.row.size,
        });
        if (!exactSubgroups.has(k)) exactSubgroups.set(k, []);
        exactSubgroups.get(k)!.push(m);
      }
      for (const sub of exactSubgroups.values()) {
        if (sub.length < 2) continue;
        const keep = sub[0]!;
        for (const m of sub.slice(1)) {
          duplicatesToRemove.push({
            row: m.row,
            sheetRowIndex1: m.sheetRowIndex1,
            reason: `Same Order ID + brand+name+color+size as row ${keep.sheetRowIndex1} (kept).`,
          });
        }
      }
      continue;
    }

    // Case C: multiple real Order IDs → legitimately re-bought same item.
    // Leave alone.
  }

  if (duplicatesToRemove.length === 0) {
    console.log('✓ No duplicate rows found under the new dedup key.');
    return;
  }

  console.log(`Found ${duplicatesToRemove.length} duplicate row(s):\n`);
  for (const d of duplicatesToRemove) {
    console.log(`  Row ${d.sheetRowIndex1}: "${d.row.itemName.slice(0, 60)}"`);
    console.log(`    brand="${d.row.brand}" color="${d.row.color}" size="${d.row.size}" orderId="${d.row.orderId}" date=${d.row.date}`);
    console.log(`    Reason: ${d.reason}`);
  }
  console.log();

  if (!apply) {
    console.log('[DRY RUN] Re-run with `--apply` to delete the rows above.');
    return;
  }

  // Find the All Purchases sheet ID for delete requests.
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: env.spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });
  const tab = (meta.data.sheets ?? []).find((s) => s.properties?.title === 'All Purchases');
  if (!tab?.properties?.sheetId == null) {
    console.error('✗ Could not find sheetId for "All Purchases"');
    process.exit(1);
  }
  const sheetId = tab!.properties!.sheetId!;

  // Delete from highest row index to lowest to avoid index shift.
  const sortedDescending = [...duplicatesToRemove].sort(
    (a, b) => b.sheetRowIndex1 - a.sheetRowIndex1,
  );
  const requests: sheets_v4.Schema$Request[] = sortedDescending.map((d) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: d.sheetRowIndex1 - 1, // API is 0-indexed exclusive end
        endIndex: d.sheetRowIndex1,
      },
    },
  }));

  console.log(`Applying ${requests.length} row deletion(s)...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: env.spreadsheetId,
    requestBody: { requests },
  });
  console.log(`✓ Done. ${requests.length} duplicate rows removed.`);
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
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId) {
    console.error('✗ Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN / GOOGLE_SHEET_ID in .env');
    process.exit(1);
  }
  return { clientId, clientSecret, refreshToken, spreadsheetId };
}

main().catch((err: unknown) => {
  console.error('✗ Failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
