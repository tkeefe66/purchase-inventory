#!/usr/bin/env tsx
/**
 * One-shot: repair the 5 sheet rows that have empty Image because of the
 * pre-fix buildRowValues bug. Re-parses each row's original Gmail message,
 * pulls imageUrl from the email, and writes it to the sheet.
 *
 * No "Include Photo?" gate, no Sonnet, no cost. Idempotent (skips rows
 * already filled). Safe to delete after one successful run.
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { createGmailClient } from '../lib/gmail.js';
import { extractHtmlBody } from '../lib/gmail-html.js';
import { parseReiEmail, parseReiReceiptEmail } from '../lib/parsers/rei.js';
import {
  createSheetsClient,
  readMasterRows,
  updateRowFields,
  type RowFieldsUpdate,
} from '../lib/sheets.js';
import type { MasterRow } from '../lib/types.js';

const TARGETS: Array<{ orderId: string; itemName: string }> = [
  { orderId: 'A400237017', itemName: "SAOLA Cannon Canvas 2.0 Shoes - Men's" },
  { orderId: 'A400237017', itemName: "SAOLA Ezo Shoes - Men's" },
  { orderId: 'A399877955', itemName: "Caddis Rapid Shelter - 10' x 10'" },
  { orderId: 'A399877955', itemName: "Caddis Rapid Shelter Wall - 10' x 10'" },
  { orderId: 'S18-T6158', itemName: 'Compressible Pillow Cinch' },
];

async function fetchEmailHtmls(
  gmail: ReturnType<typeof createGmailClient>,
  orderId: string,
): Promise<string[]> {
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `${orderId} in:anywhere`,
    includeSpamTrash: true,
    maxResults: 10,
  });
  const out: string[] = [];
  for (const m of list.data.messages ?? []) {
    if (!m.id) continue;
    const resp = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' });
    const html = extractHtmlBody(resp.data);
    if (html) out.push(html);
  }
  return out;
}

function findImageUrl(html: string, itemName: string): string | null {
  const online = parseReiEmail(html);
  const order = online ?? parseReiReceiptEmail(html);
  if (!order) return null;
  const match = order.items.find((i) => i.itemName === itemName) ?? order.items[0];
  return match?.imageUrl ?? null;
}

function findImageUrlAcrossEmails(htmls: string[], itemName: string): string | null {
  for (const html of htmls) {
    const url = findImageUrl(html, itemName);
    if (url) return url;
  }
  return null;
}

async function main(): Promise<void> {
  const env = {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
  };
  const sheets = createSheetsClient(env);
  const gmail = createGmailClient(env);

  const rows = await readMasterRows(sheets, env.spreadsheetId);
  const updates: RowFieldsUpdate[] = [];

  for (const target of TARGETS) {
    const idx = rows.findIndex(
      (r: MasterRow) => r.orderId === target.orderId && r.itemName === target.itemName,
    );
    if (idx === -1) {
      console.warn(`  [miss] ${target.orderId} "${target.itemName}" — row not found`);
      continue;
    }
    const row = rows[idx]!;
    if (row.image) {
      console.log(`  [skip] ${target.orderId} "${target.itemName}" — already has image`);
      continue;
    }

    const htmls = await fetchEmailHtmls(gmail, target.orderId);
    if (htmls.length === 0) {
      console.warn(`  [miss] ${target.orderId} — Gmail message not found`);
      continue;
    }
    const url = findImageUrlAcrossEmails(htmls, target.itemName);
    if (!url) {
      console.warn(`  [miss] ${target.orderId} "${target.itemName}" — no imageUrl in email`);
      continue;
    }

    const rowIndex = idx + 2; // 1-based; header is row 1
    updates.push({ rowIndex, fields: { image: url } });
    console.log(`  [ok]   ${target.orderId} "${target.itemName}" → ${url}`);
  }

  if (updates.length === 0) {
    console.log('\nNothing to write.');
    return;
  }
  await updateRowFields(sheets, env.spreadsheetId, updates);
  console.log(`\n✓ Wrote ${updates.length} Image URL(s) to the sheet.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
