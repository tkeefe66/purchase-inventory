import 'dotenv/config';
import {
  buildVocab,
  createSheetsClient,
  readDedupKeys,
  readMasterRows,
} from '../lib/sheets.js';

async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  console.log('Reading master rows...');
  const rows = await readMasterRows(sheets, spreadsheetId);
  console.log(`✓ ${rows.length} rows`);
  if (rows[0]) {
    const r = rows[0];
    console.log(
      `  First row: "${r.itemName.slice(0, 50)}" (${r.source}, ${r.domain}/${r.type}, $${r.price})`,
    );
  }

  console.log('\nBuilding dedup keys...');
  const keys = await readDedupKeys(sheets, spreadsheetId);
  console.log(`✓ ${keys.fullKeys.size} full keys, ${keys.blankOrderContentKeys.size} historical content keys`);

  console.log('\nBuilding vocab...');
  const vocab = await buildVocab(sheets, spreadsheetId);
  console.log(
    `✓ ${vocab.categories.length} categories, ${Object.values(vocab.subCategoriesByCategory).flat().length} sub-categories, ${vocab.brands.length} brands`,
  );
  console.log(`  Sample categories: ${vocab.categories.slice(0, 8).join(', ')}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
