import Anthropic from '@anthropic-ai/sdk';
import { formatInTimeZone } from 'date-fns-tz';
import { createClassifier } from '../../lib/classifier.js';
import { dedupItems } from '../../lib/dedup.js';
import {
  applyLabel,
  createGmailClient,
  ensureLabel,
  extractHtmlBody,
  getHeader,
  getMessage,
  listMessages,
  type GmailClient,
} from '../../lib/gmail.js';
import { parseAmazonEmail } from '../../lib/parsers/amazon.js';
import { parseReiEmail } from '../../lib/parsers/rei.js';
import type { ParsedOrder } from '../../lib/parsers/types.js';
import { routeItem } from '../../lib/router.js';
import {
  appendRows,
  buildVocab,
  createSheetsClient,
  readDedupKeys,
} from '../../lib/sheets.js';
import { sendMessage } from '../../lib/telegram.js';
import type { MasterRow, Source } from '../../lib/types.js';

const PROCESSED_LABEL = process.env.PROCESSED_LABEL ?? 'inventory-processed';

const REI_SENDER = 'rei@notices.rei.com';
const AMAZON_ORDER_SENDER = 'auto-confirm@amazon.com';
const AMAZON_SHIPMENT_SENDER = 'shipment-tracking@amazon.com';

export interface PipelineOptions {
  dryRun: boolean;
  reprocessSince: string | undefined;
  maxMessages: number | undefined;
  /** Only process emails received on/after this YYYY-MM-DD date. */
  ingestAfterDate: string | undefined;
  spreadsheetId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  anthropicKey: string;
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
}

export interface PipelineResult {
  startedAt: string;
  endedAt: string;
  messagesScanned: number;
  itemsAdded: number;
  itemsBySource: Record<string, number>;
  itemsByDomain: Record<string, number>;
  skippedNonReceipts: number;
  duplicatesIgnored: number;
  labelsApplied: number;
  errors: Array<{ messageId: string; subject: string; error: string }>;
  dryRun: boolean;
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const startedAt = new Date().toISOString();
  const result: PipelineResult = {
    startedAt,
    endedAt: '',
    messagesScanned: 0,
    itemsAdded: 0,
    itemsBySource: {},
    itemsByDomain: {},
    skippedNonReceipts: 0,
    duplicatesIgnored: 0,
    labelsApplied: 0,
    errors: [],
    dryRun: !!opts.dryRun,
  };

  const gmail = createGmailClient({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    refreshToken: opts.refreshToken,
  });
  const sheets = createSheetsClient({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    refreshToken: opts.refreshToken,
  });
  const anthropic = new Anthropic({ apiKey: opts.anthropicKey });

  log('Building vocab from All Purchases...');
  const vocab = await buildVocab(sheets, opts.spreadsheetId);
  log(`✓ ${vocab.categories.length} categories, ${vocab.brands.length} brands`);

  const classify = createClassifier({ vocab, anthropic });

  log('Reading existing dedup keys...');
  const existingKeys = await readDedupKeys(sheets, opts.spreadsheetId);
  log(`✓ ${existingKeys.size} existing keys`);

  const labelId = await ensureLabel(gmail, PROCESSED_LABEL);

  const query = buildQuery(opts);
  log(`Query: ${query}`);
  const messageIds = await listMessages(gmail, {
    query,
    maxResults: opts.maxMessages ?? 100,
  });
  log(`Found ${messageIds.length} messages to process`);

  const newRows: MasterRow[] = [];
  const messagesToLabel: string[] = [];

  for (const msgId of messageIds) {
    result.messagesScanned++;
    try {
      const rows = await processMessage(gmail, msgId, classify);
      if (rows === 'non-receipt') {
        result.skippedNonReceipts++;
        messagesToLabel.push(msgId);
        continue;
      }
      newRows.push(...rows);
      messagesToLabel.push(msgId);
    } catch (err) {
      const subject = await safeGetSubject(gmail, msgId);
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ messageId: msgId, subject, error: errMsg });
      log(`  ✗ ${msgId} (${subject}): ${errMsg}`);
    }
  }

  // Dedup against existing sheet
  const beforeDedup = newRows.length;
  const deduped = dedupItems(
    newRows.map((r) => ({
      orderId: r.orderId,
      itemName: r.itemName,
      color: r.color,
      size: r.size,
      _row: r,
    })),
    existingKeys,
  ).map((d) => (d as unknown as { _row: MasterRow })._row);
  result.duplicatesIgnored = beforeDedup - deduped.length;

  // Tally for digest
  for (const r of deduped) {
    result.itemsBySource[r.source] = (result.itemsBySource[r.source] ?? 0) + 1;
    result.itemsByDomain[r.domain] = (result.itemsByDomain[r.domain] ?? 0) + 1;
  }
  result.itemsAdded = deduped.length;

  // Apply writes
  if (deduped.length > 0 && !opts.dryRun) {
    log(`Appending ${deduped.length} rows to sheet...`);
    await appendRows(sheets, opts.spreadsheetId, deduped);
    log(`✓ Rows appended`);
  } else if (deduped.length > 0) {
    log(`[DRY RUN] Would append ${deduped.length} rows`);
  }

  if (messagesToLabel.length > 0 && !opts.dryRun) {
    log(`Labeling ${messagesToLabel.length} messages as "${PROCESSED_LABEL}"...`);
    for (const msgId of messagesToLabel) {
      try {
        await applyLabel(gmail, msgId, labelId);
        result.labelsApplied++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.errors.push({ messageId: msgId, subject: '(label apply)', error: errMsg });
      }
    }
    log(`✓ ${result.labelsApplied} labels applied`);
  } else if (messagesToLabel.length > 0) {
    log(`[DRY RUN] Would label ${messagesToLabel.length} messages`);
  }

  result.endedAt = new Date().toISOString();

  // Telegram digest
  if (opts.telegramBotToken && opts.telegramChatId) {
    try {
      await sendMessage(
        { botToken: opts.telegramBotToken },
        {
          chat_id: opts.telegramChatId,
          text: formatDigest(result),
          disable_notification: result.errors.length === 0 && result.itemsAdded === 0,
        },
      );
    } catch (err) {
      log(`✗ Telegram digest failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
}

async function processMessage(
  gmail: GmailClient,
  msgId: string,
  classify: ReturnType<typeof createClassifier>,
): Promise<MasterRow[] | 'non-receipt'> {
  const msg = await getMessage(gmail, msgId);
  const subject = getHeader(msg, 'Subject') ?? '(no subject)';
  const from = (getHeader(msg, 'From') ?? '').toLowerCase();
  const dateHeader = getHeader(msg, 'Date') ?? '';
  const emailDate = new Date(dateHeader);
  if (Number.isNaN(emailDate.getTime())) {
    throw new Error(`Could not parse Date header: "${dateHeader}"`);
  }
  const html = extractHtmlBody(msg);
  if (!html) {
    log(`  [skip] ${msgId} no HTML body — "${subject.slice(0, 50)}"`);
    return 'non-receipt';
  }

  const source = pickSource(from);
  if (!source) {
    log(`  [skip] ${msgId} unrecognized sender "${from}"`);
    return 'non-receipt';
  }

  const parsedOrders = parseEmail(source, html);
  if (!parsedOrders || parsedOrders.length === 0) {
    log(`  [skip] ${msgId} ${source} non-receipt — "${subject.slice(0, 50)}"`);
    return 'non-receipt';
  }

  log(`  [ok] ${msgId} ${source} — ${parsedOrders.length} order(s), ${countItems(parsedOrders)} item(s)`);
  const rows: MasterRow[] = [];
  for (const order of parsedOrders) {
    for (const item of order.items) {
      const row = await routeItem(
        { parsedOrder: order, parsedItem: item, emailDate },
        classify,
      );
      rows.push(row);
    }
  }
  return rows;
}

function pickSource(from: string): Source | null {
  if (from.includes(REI_SENDER)) return 'REI';
  if (from.includes(AMAZON_ORDER_SENDER) || from.includes(AMAZON_SHIPMENT_SENDER)) return 'Amazon';
  return null;
}

function parseEmail(source: Source, html: string): ParsedOrder[] | null {
  if (source === 'REI') {
    const r = parseReiEmail(html);
    return r ? [r] : null;
  }
  if (source === 'Amazon') {
    return parseAmazonEmail(html);
  }
  return null;
}

function countItems(orders: ParsedOrder[]): number {
  return orders.reduce((sum, o) => sum + o.items.length, 0);
}

function buildQuery(opts: PipelineOptions): string {
  const senders = `from:(${REI_SENDER} OR ${AMAZON_ORDER_SENDER} OR ${AMAZON_SHIPMENT_SENDER})`;
  if (opts.reprocessSince) {
    // Reprocess mode: bypass label filter, scoped by --since.
    return `${senders} after:${gmailDate(opts.reprocessSince)}`;
  }
  const afterPart = opts.ingestAfterDate
    ? ` after:${gmailDate(opts.ingestAfterDate)}`
    : ' newer_than:30d';
  return `${senders} -label:${PROCESSED_LABEL}${afterPart}`;
}

function gmailDate(dateString: string): string {
  // Gmail accepts YYYY/MM/DD or YYYY-MM-DD; normalize to slashes for consistency.
  return dateString.replace(/-/g, '/');
}

async function safeGetSubject(gmail: GmailClient, msgId: string): Promise<string> {
  try {
    const m = await getMessage(gmail, msgId);
    return getHeader(m, 'Subject') ?? '(no subject)';
  } catch {
    return '(failed to fetch subject)';
  }
}

function formatDigest(r: PipelineResult): string {
  const tz = process.env.TZ ?? 'America/Denver';
  const when = formatInTimeZone(new Date(r.startedAt), tz, 'EEE MMM d, h:mm a zzz');
  const lines: string[] = [];
  lines.push(`Inventory cron @ ${when}${r.dryRun ? ' [DRY RUN]' : ''}`);

  if (r.itemsAdded > 0) {
    lines.push(`✅ ${r.itemsAdded} new item${r.itemsAdded === 1 ? '' : 's'}`);
    const bySource = Object.entries(r.itemsBySource).map(([k, v]) => `${k}: ${v}`).join(', ');
    if (bySource) lines.push(`   ${bySource}`);
    const byDomain = Object.entries(r.itemsByDomain)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (byDomain) lines.push(`   Domains: ${byDomain}`);
  } else {
    lines.push(`📭 No new items`);
  }

  lines.push(
    `${r.messagesScanned} email${r.messagesScanned === 1 ? '' : 's'} scanned, ${r.skippedNonReceipts} skipped (non-receipts), ${r.duplicatesIgnored} duplicates filtered`,
  );

  if (r.errors.length > 0) {
    lines.push(`❌ ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}:`);
    for (const e of r.errors.slice(0, 5)) {
      lines.push(`   • ${e.subject.slice(0, 50)} — ${e.error.slice(0, 100)}`);
    }
    if (r.errors.length > 5) lines.push(`   …and ${r.errors.length - 5} more`);
  }

  return lines.join('\n');
}

function log(msg: string): void {
  console.log(msg);
}
