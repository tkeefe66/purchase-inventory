import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createClassifier, type ClassifyInput } from '../lib/classifier.js';
import { enrichReiReceiptItems } from '../lib/parsers/rei-receipt-enrich.js';
import {
  buildVocab,
  createSheetsClient,
  readMasterRows,
  updateRowFields,
  type RowFieldsUpdate,
} from '../lib/sheets.js';
import type { ParsedItem } from '../lib/parsers/types.js';
import type { MasterRow } from '../lib/types.js';

interface CliFlags {
  dryRun: boolean;
  pattern: RegExp;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    dryRun: !args.includes('--apply'),
    pattern: /^S\d+-T\d+$/, // default: REI in-store eReceipt rows
  };
  for (const a of args) {
    if (a.startsWith('--pattern=')) {
      flags.pattern = new RegExp(a.slice('--pattern='.length));
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const env = readEnv();

  const sheets = createSheetsClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });
  const anthropic = new Anthropic({ apiKey: env.anthropicKey });

  console.log(`Mode: ${flags.dryRun ? 'DRY RUN (no writes)' : 'APPLY'}`);
  console.log(`Order ID pattern: ${flags.pattern.source}\n`);

  console.log('Reading sheet...');
  const rows = await readMasterRows(sheets, env.spreadsheetId);
  console.log(`  ${rows.length} total rows`);

  // 1-based sheet row index: header is row 1, first data row is row 2.
  const targets = rows
    .map((r, i) => ({ row: r, sheetRow: i + 2 }))
    .filter(({ row }) => flags.pattern.test(row.orderId));

  console.log(`  ${targets.length} rows match the pattern\n`);
  if (targets.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  console.log('Building classifier vocab...');
  const vocab = await buildVocab(sheets, env.spreadsheetId);
  const classify = createClassifier({ vocab, anthropic });

  const itemsToEnrich: ParsedItem[] = targets.map(({ row }) => rowToParsedItem(row));

  console.log(`Enriching ${itemsToEnrich.length} items via Sonnet/Haiku + REI lookups...`);
  const enrichedItems = await enrichReiReceiptItems(itemsToEnrich, anthropic);

  const updates: RowFieldsUpdate[] = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    const before = itemsToEnrich[i]!;
    const after = enrichedItems[i]!;
    const nameChanged = after.itemName !== before.itemName;
    const brandChanged = (after.brand ?? '') !== (before.brand ?? '');

    if (!nameChanged && !brandChanged) {
      console.log(`  [skip] row ${target.sheetRow}: "${before.itemName}" — no enrichment delta`);
      continue;
    }

    // Re-classify with the enriched name + brand so Category/Domain/Type
    // reflect the now-clean inputs.
    const classifyInput: ClassifyInput = { itemName: after.itemName, source: 'REI' };
    const cls = await classify(classifyInput);

    const fields: Partial<MasterRow> = {
      itemName: after.itemName,
      brand: cls.brand || after.brand || target.row.brand,
      category: cls.category,
      subCategory: cls.subCategory,
      domain: cls.domain,
      type: cls.type,
      reasoning: cls.reasoning,
    };
    updates.push({ rowIndex: target.sheetRow, fields });
    console.log(
      `  [enrich] row ${target.sheetRow}: "${before.itemName}" → "${after.itemName}" ` +
        `(${target.row.brand || '(no brand)'} → ${fields.brand || '(no brand)'}, ${cls.domain}/${cls.type})`,
    );
  }

  console.log(`\n${updates.length} row(s) ready to write.`);
  if (flags.dryRun) {
    console.log('DRY RUN — re-run with --apply to write to the sheet.');
    return;
  }

  if (updates.length === 0) {
    console.log('Nothing to write.');
    return;
  }

  console.log('Writing batch update...');
  await updateRowFields(sheets, env.spreadsheetId, updates);
  console.log(`✓ Updated ${updates.length} row(s).`);
}

function rowToParsedItem(row: MasterRow): ParsedItem {
  return {
    itemName: row.itemName,
    brand: row.brand,
    color: row.color,
    size: row.size,
    quantity: row.qty,
    price: row.price,
    productUrl: row.productUrl,
  };
}

function readEnv(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  spreadsheetId: string;
  anthropicKey: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const missing = [
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REFRESH_TOKEN', refreshToken],
    ['GOOGLE_SHEET_ID', spreadsheetId],
    ['ANTHROPIC_API_KEY', anthropicKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.error(`✗ Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    spreadsheetId: spreadsheetId!,
    anthropicKey: anthropicKey!,
  };
}

main().catch((err: unknown) => {
  console.error('✗ enrich-rows failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
