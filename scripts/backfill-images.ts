#!/usr/bin/env tsx
/**
 * One-shot backfill for the Image column on existing "All Purchases" rows.
 *
 * Phases per row (in order):
 *   1. Skip if Image is already populated (idempotent).
 *   2. Email re-parse: for Amazon/REI rows with an orderId, find the original
 *      email via Gmail (includeSpamTrash: true), re-run the parser, download
 *      the extracted imageUrl.
 *   3. AI lookup: for anything still missing after phase 2, call resolveImage
 *      (Sonnet + web_search) with parsedImageUrl: undefined.
 *
 * Cost estimate is printed before any spend. `-y` / `--yes` bypasses confirm.
 *
 * Usage:
 *   npm run backfill-images              # interactive confirm
 *   npm run backfill-images -- --yes     # skip confirm
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createInterface } from 'node:readline/promises';
import { google, type gmail_v1 } from 'googleapis';
import { createGmailClient } from '../lib/gmail.js';
import { extractHtmlBody } from '../lib/gmail-html.js';
import { parseReiEmail, parseReiReceiptEmail } from '../lib/parsers/rei.js';
import { parseAmazonShipmentEmail, parseAmazonOrderEmail } from '../lib/parsers/amazon.js';
import { downloadAndSave } from '../lib/integrations/image-storage.js';
import { resolveImage } from '../lib/integrations/resolve-image.js';
import {
  createSheetsClient,
  readMasterRows,
  updateRowFields,
  type RowFieldsUpdate,
} from '../lib/sheets.js';
import type { MasterRow } from '../lib/types.js';

const COST_PER_LOOKUP_USD = 0.03;
const BATCH_SIZE = 20;

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
    .map(([k]) => k!);
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

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return answer.trim().toLowerCase().startsWith('y');
  } finally {
    rl.close();
  }
}

/**
 * Search Gmail (including Trash/Spam) for an email matching the given orderId,
 * then return the HTML body of the first match that has one.
 */
async function findEmailByOrderId(
  gmail: gmail_v1.Gmail,
  orderId: string,
): Promise<string | null> {
  // includeSpamTrash: true is critical — many historical order emails live in
  // Trash from years of inbox cleanup. Default Gmail search excludes Trash/Spam.
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `${orderId} in:anywhere`,
    includeSpamTrash: true,
    maxResults: 5,
  });
  const ids = (list.data.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
  for (const id of ids) {
    const resp = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const html = extractHtmlBody(resp.data);
    if (html) return html;
  }
  return null;
}

/**
 * Try to find the image URL for a row by re-parsing its original email.
 * Returns the URL string if found, null otherwise.
 */
async function tryEmailReparse(
  gmail: gmail_v1.Gmail,
  row: MasterRow,
  anthropic: Anthropic,
): Promise<string | null> {
  if (!row.orderId) return null;
  const html = await findEmailByOrderId(gmail, row.orderId);
  if (!html) return null;

  let imageUrl: string | undefined;
  if (row.source === 'REI') {
    const online = parseReiEmail(html);
    const order = online ?? parseReiReceiptEmail(html);
    if (!order) return null;
    const match = order.items.find((i) => i.itemName === row.itemName) ?? order.items[0];
    imageUrl = match?.imageUrl;
  } else if (row.source === 'Amazon') {
    const shipOrders = parseAmazonShipmentEmail(html);
    const orders = shipOrders ?? (await parseAmazonOrderEmail(anthropic, html));
    if (!orders) return null;
    const allItems = orders.flatMap((o) => o.items);
    const match = allItems.find((i) => i.itemName === row.itemName) ?? allItems[0];
    imageUrl = match?.imageUrl;
  }

  return imageUrl ?? null;
}

async function flushBatch(
  sheets: ReturnType<typeof createSheetsClient>,
  spreadsheetId: string,
  pending: RowFieldsUpdate[],
): Promise<void> {
  if (pending.length === 0) return;
  await updateRowFields(sheets, spreadsheetId, pending.splice(0));
}

async function main(): Promise<void> {
  const env = readEnv();

  const sheets = createSheetsClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });

  console.log('Reading sheet...');
  const rows = await readMasterRows(sheets, env.spreadsheetId);

  const missing = rows.filter((r) => !r.image);
  const fromEmail = missing.filter(
    (r) => (r.source === 'Amazon' || r.source === 'REI') && r.orderId,
  );
  const needsLookupCount = missing.length - fromEmail.length;
  const estimatedUsd = needsLookupCount * COST_PER_LOOKUP_USD;

  console.log('Backfill image plan:');
  console.log(`  Rows total:          ${rows.length}`);
  console.log(`  Already have image:  ${rows.length - missing.length}`);
  console.log(`  Email re-parse pool: ${fromEmail.length}`);
  console.log(`  AI lookup pool:      ${needsLookupCount} (est. max)`);
  console.log(`  Estimated max cost:  ~$${estimatedUsd.toFixed(2)} (Sonnet + web_search)`);

  const skipConfirm = process.argv.includes('--yes') || process.argv.includes('-y');
  if (!skipConfirm) {
    const proceed = await confirm('Proceed?');
    if (!proceed) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  const anthropic = new Anthropic({ apiKey: env.anthropicKey });
  const gmail = createGmailClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });

  // -------------------------------------------------------------------
  // Phase 1: Email re-parse (Amazon + REI rows with an orderId)
  // -------------------------------------------------------------------
  console.log('\nPhase 1: email re-parse...');
  let emailSuccess = 0;
  let emailFail = 0;
  const emailUpdates: RowFieldsUpdate[] = [];

  // Track which rows got updated (by their index in rows[]) so phase 2 skips them.
  const updatedIndices = new Set<number>();

  for (let i = 0; i < fromEmail.length; i++) {
    const row = fromEmail[i]!;
    const rowIndex = rows.indexOf(row) + 2; // 1-based; header is row 1
    try {
      const url = await tryEmailReparse(gmail, row, anthropic);
      if (!url) {
        emailFail++;
        continue;
      }
      const itemId = `${row.orderId}|${row.productUrl || row.itemName}`;
      const saved = await downloadAndSave(itemId, url);
      if (!saved.ok) {
        emailFail++;
        console.warn(`  [skip] ${row.orderId} "${row.itemName}": download failed (${saved.error})`);
        continue;
      }
      emailUpdates.push({ rowIndex, fields: { image: saved.path } });
      updatedIndices.add(rows.indexOf(row));
      emailSuccess++;

      if (emailUpdates.length >= BATCH_SIZE) {
        await flushBatch(sheets, env.spreadsheetId, emailUpdates);
        console.log(`  email phase: ${emailSuccess} ok / ${emailFail} fail so far`);
      }
    } catch (err) {
      emailFail++;
      console.warn(
        `  [skip] ${row.orderId} "${row.itemName}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (emailUpdates.length > 0) await flushBatch(sheets, env.spreadsheetId, emailUpdates);
  console.log(`Email phase done: ${emailSuccess} updated, ${emailFail} not found / failed`);

  // -------------------------------------------------------------------
  // Phase 2: AI lookup (everything still missing)
  // -------------------------------------------------------------------
  console.log('\nPhase 2: AI lookup...');

  // Include:
  // - non-Amazon/REI rows that were in the missing list
  // - Amazon/REI rows that were in fromEmail but NOT successfully updated in phase 1
  const stillMissing = rows.filter((r, i) => {
    if (r.image) return false;                // already has image
    if (updatedIndices.has(i)) return false;  // just populated in phase 1
    return true;
  });

  let lookupSuccess = 0;
  let lookupFail = 0;
  const lookupUpdates: RowFieldsUpdate[] = [];

  for (const row of stillMissing) {
    const rowIndex = rows.indexOf(row) + 2;
    const itemId = `${row.orderId || `row-${rowIndex}`}|${row.productUrl || row.itemName}`;
    try {
      const path = await resolveImage({
        itemId,
        brand: row.brand,
        itemName: row.itemName,
        productUrl: row.productUrl,
        parsedImageUrl: undefined, // skip straight to AI lookup
        anthropic,
      });
      if (!path) {
        lookupFail++;
        continue;
      }
      lookupUpdates.push({ rowIndex, fields: { image: path } });
      lookupSuccess++;

      if (lookupUpdates.length >= BATCH_SIZE) {
        await flushBatch(sheets, env.spreadsheetId, lookupUpdates);
        console.log(`  lookup phase: ${lookupSuccess} ok / ${lookupFail} fail so far`);
      }
    } catch (err) {
      lookupFail++;
      console.warn(
        `  [skip] "${row.itemName}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (lookupUpdates.length > 0) await flushBatch(sheets, env.spreadsheetId, lookupUpdates);
  console.log(`Lookup phase done: ${lookupSuccess} updated, ${lookupFail} failed`);

  const total = emailSuccess + lookupSuccess;
  console.log(`\nBackfill complete. Total: ${total} image(s) attached.`);
}

main().catch((err: unknown) => {
  console.error(
    '✗ backfill-images failed:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(1);
});
