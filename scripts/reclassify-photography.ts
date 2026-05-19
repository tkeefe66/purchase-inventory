#!/usr/bin/env -S tsx
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createClassifier, type Classification } from '../lib/classifier.js';
import {
  buildVocab,
  createSheetsClient,
  readMasterRows,
  updateRowFields,
  type RowFieldsUpdate,
} from '../lib/sheets.js';
import type { MasterRow } from '../lib/types.js';

interface CliFlags {
  dryRun: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  return { dryRun: !args.includes('--apply') };
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

async function main(): Promise<void> {
  const flags = parseFlags();
  const env = readEnv();

  const sheets = createSheetsClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });
  const anthropic = new Anthropic({ apiKey: env.anthropicKey });

  console.log(`Mode: ${flags.dryRun ? 'DRY RUN (no writes)' : 'APPLY'}\n`);

  console.log('Reading sheet...');
  const rows = await readMasterRows(sheets, env.spreadsheetId);
  console.log(`  ${rows.length} total rows`);

  // 1-based sheet row index: header is row 1, first data row is row 2.
  const otherRows = rows
    .map((row, i) => ({ row, rowIndex: i + 2 }))
    .filter(({ row }) => row.domain === 'Other');
  console.log(`  ${otherRows.length} rows with Domain=Other`);

  if (otherRows.length === 0) {
    console.log('Nothing to reclassify.');
    return;
  }

  console.log('\nBuilding classifier vocab + creating classifier...');
  const vocab = await buildVocab(sheets, env.spreadsheetId);
  const classify = createClassifier({ vocab, anthropic });

  console.log(`Reclassifying ${otherRows.length} rows via Haiku...\n`);

  interface Candidate {
    rowIndex: number;
    itemName: string;
    existingBrand: string;
    cls: Classification;
  }

  const candidates: Candidate[] = [];
  let processed = 0;
  for (const { row, rowIndex } of otherRows) {
    const cls = await classify({ itemName: row.itemName, source: row.source });
    if (cls.domain === 'Photography') {
      candidates.push({ rowIndex, itemName: row.itemName, existingBrand: row.brand, cls });
    }
    processed++;
    if (processed % 10 === 0) {
      console.log(`  processed ${processed}/${otherRows.length} (${candidates.length} flagged as Photography so far)`);
    }
  }

  console.log(`\nFound ${candidates.length} rows to reclassify Other → Photography:`);
  for (const c of candidates.slice(0, 20)) {
    console.log(`  row ${c.rowIndex}: ${c.existingBrand} ${c.itemName} → ${c.cls.category} / ${c.cls.subCategory} (${c.cls.type})`);
  }
  if (candidates.length > 20) console.log(`  ... and ${candidates.length - 20} more`);

  if (flags.dryRun) {
    console.log('\nDry-run. Re-run with --apply to write changes.');
    return;
  }

  if (candidates.length === 0) {
    console.log('\nNothing to apply.');
    return;
  }

  console.log(`\nApplying ${candidates.length} updates...`);
  const updates: RowFieldsUpdate[] = candidates.map((c) => {
    const fields: Partial<MasterRow> = {
      domain: 'Photography',
      type: c.cls.type,
      category: c.cls.category,
      subCategory: c.cls.subCategory,
      brand: c.cls.brand || c.existingBrand,
      reasoning: c.cls.reasoning,
    };
    return { rowIndex: c.rowIndex, fields };
  });
  await updateRowFields(sheets, env.spreadsheetId, updates);
  console.log(`✓ Applied ${candidates.length} updates.`);
}

main().catch((err: unknown) => {
  console.error('✗ reclassify-photography failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
