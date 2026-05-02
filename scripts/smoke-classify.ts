import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClassifier } from '../lib/classifier.js';
import { parseAmazonEmail } from '../lib/parsers/amazon.js';
import { parseReiEmail } from '../lib/parsers/rei.js';
import { routeItem } from '../lib/router.js';
import { buildVocab, createSheetsClient } from '../lib/sheets.js';

async function main(): Promise<void> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  console.log('Building vocab from All Purchases...');
  const vocab = await buildVocab(sheets, process.env.GOOGLE_SHEET_ID!);
  console.log(`✓ ${vocab.categories.length} categories, ${vocab.brands.length} brands`);

  const classify = createClassifier({ vocab, anthropic });

  // Test 1: Amazon shipment-tracking — Sony Alpha camera
  console.log('\n--- Amazon (Sony Alpha a6700 shipment) ---');
  const amazonHtml = readFileSync(
    resolve('tests/fixtures/amazon/19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html'),
    'utf-8',
  );
  const amazonParsed = parseAmazonEmail(amazonHtml);
  if (amazonParsed && amazonParsed[0]?.items[0]) {
    const order = amazonParsed[0];
    const item = order.items[0];
    const masterRow = await routeItem(
      { parsedOrder: order, parsedItem: item, emailDate: new Date('2026-04-29T20:54:29Z') },
      classify,
    );
    printMasterRow(masterRow);
  }

  // Test 2: REI order confirmation — Salomon boots
  console.log('\n--- REI (Salomon X Ultra 5 boots) ---');
  const reiHtml = readFileSync(
    resolve("tests/fixtures/rei/19dd9b2a7d11aca2__Thanks_for_your_order!_(A398129839).html"),
    'utf-8',
  );
  const reiParsed = parseReiEmail(reiHtml);
  if (reiParsed && reiParsed.items[0]) {
    const order = reiParsed;
    const item = order.items[0];
    const masterRow = await routeItem(
      { parsedOrder: order, parsedItem: item, emailDate: new Date('2026-04-29T14:44:17Z') },
      classify,
    );
    printMasterRow(masterRow);
  }
}

function printMasterRow(r: { [k: string]: unknown }): void {
  console.log(`  Date:        ${r['date']} (Year=${r['year']})`);
  console.log(`  Item:        ${r['itemName']}`);
  console.log(`  Source:      ${r['source']}, Order ${r['orderId']}`);
  console.log(`  Domain/Type: ${r['domain']} / ${r['type']}`);
  console.log(`  Category:    ${r['category']} → ${r['subCategory']}`);
  console.log(`  Brand:       ${r['brand']}`);
  console.log(`  Price/Qty:   $${r['price']} × ${r['qty']}`);
  console.log(`  Status:      ${r['status']}`);
  console.log(`  Color/Size:  ${r['color']} / ${r['size']}`);
  console.log(`  Reasoning:   ${r['reasoning']}`);
}

main().catch((err: unknown) => {
  console.error('✗ Smoke test failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
