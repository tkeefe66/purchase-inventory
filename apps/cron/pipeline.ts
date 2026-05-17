import Anthropic from '@anthropic-ai/sdk';
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
import { parseAmazonShipmentEmail, parseAmazonOrderEmail } from '../../lib/parsers/amazon.js';
import { parseAmazonReturnEmail, type ReturnAction } from '../../lib/parsers/amazon-return.js';
import { parseReiEmail, parseReiReceiptEmail } from '../../lib/parsers/rei.js';
import type { ParsedOrder } from '../../lib/parsers/types.js';
import { extractProductId } from '../../lib/productId.js';
import { routeItem } from '../../lib/router.js';
import {
  appendRows,
  buildVocab,
  createSheetsClient,
  readDedupKeys,
  readMasterRows,
  updateRowStatus,
} from '../../lib/sheets.js';
import {
  KNOWN_SENDERS,
  pickRole,
  pickSource,
} from '../../lib/sources.js';
import type { MasterRow, Source } from '../../lib/types.js';

const PROCESSED_LABEL = process.env.PROCESSED_LABEL ?? 'inventory-processed';

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
  /** Number of rows flipped to Status='returned' from return@amazon.com emails. */
  returnsApplied: number;
  /** Items the return parser identified but couldn't match to an existing row. */
  returnsUnmatched: number;
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
    returnsApplied: 0,
    returnsUnmatched: 0,
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
  log(`✓ ${existingKeys.fullKeys.size} existing rows indexed (${existingKeys.blankOrderContentKeys.size} historical no-Order-ID content keys)`);

  const labelId = await ensureLabel(gmail, PROCESSED_LABEL);

  const query = buildQuery(opts);
  log(`Query: ${query}`);
  const messageIds = await listMessages(gmail, {
    query,
    maxResults: opts.maxMessages ?? 100,
  });
  log(`Found ${messageIds.length} messages to process`);

  const newRows: MasterRow[] = [];
  const returnActions: ReturnAction[] = [];
  const messagesToLabel: string[] = [];

  for (const msgId of messageIds) {
    result.messagesScanned++;
    try {
      const msg = await getMessage(gmail, msgId);
      const from = (getHeader(msg, 'From') ?? '').toLowerCase();
      const role = pickRole(from);

      if (role === 'amazon-return') {
        const subject = getHeader(msg, 'Subject') ?? '(no subject)';
        const html = extractHtmlBody(msg);
        if (!html) {
          log(`  [skip] ${msgId} return — no HTML body — "${subject.slice(0, 50)}"`);
          messagesToLabel.push(msgId);
          continue;
        }
        const action = await parseAmazonReturnEmail(anthropic, html);
        if (action) {
          returnActions.push(action);
          log(`  [ok] ${msgId} return — order ${action.orderId}, ${action.items.length} item(s)`);
        } else {
          log(`  [skip] ${msgId} return — couldn't extract order/items — "${subject.slice(0, 50)}"`);
        }
        messagesToLabel.push(msgId);
        continue;
      }

      const rows = await processOrderOrShipmentMessage(msg, classify, anthropic);
      if (rows === 'non-receipt') {
        // Per DECISIONS.md (2026-04-30, "Non-receipt emails"): do NOT label
        // unparsed emails. Leaving them un-labeled means a future parser
        // (e.g., new sender format, REI in-store eReceipt) can pick them up
        // on the next scan instead of being silently buried.
        result.skippedNonReceipts++;
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

  // Dedup against existing sheet (key = orderId + brand + name + color + size)
  const beforeDedup = newRows.length;
  const deduped = dedupItems(
    newRows.map((r) => ({
      orderId: r.orderId,
      brand: r.brand,
      itemName: r.itemName,
      color: r.color,
      size: r.size,
      productUrl: r.productUrl,
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

  // Apply return actions — flip matching rows to Status='returned'. We re-read
  // the sheet so newly-appended rows from this run are also matchable.
  if (returnActions.length > 0) {
    const currentRows = await readMasterRows(sheets, opts.spreadsheetId);
    for (const action of returnActions) {
      for (const item of action.items) {
        const rowIdx = findRowForReturn(currentRows, action.orderId, item);
        if (rowIdx === -1) {
          log(`  [warn] no row matches return: order ${action.orderId}, item "${item.itemName.slice(0, 60)}"`);
          result.returnsUnmatched++;
          continue;
        }
        const target = currentRows[rowIdx]!;
        if (target.status === 'returned') {
          log(`  [skip] row ${rowIdx + 2} already returned: ${target.brand} ${target.itemName.slice(0, 50)}`);
          continue;
        }
        if (!opts.dryRun) {
          await updateRowStatus(sheets, opts.spreadsheetId, {
            rowIndex: rowIdx + 2,
            newStatus: 'returned',
          });
          log(`  ✓ marked row ${rowIdx + 2} returned: ${target.brand} ${target.itemName.slice(0, 50)}`);
        } else {
          log(`  [DRY RUN] would mark row ${rowIdx + 2} returned: ${target.brand} ${target.itemName.slice(0, 50)}`);
        }
        result.returnsApplied++;
      }
    }
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

  return result;
}

async function processOrderOrShipmentMessage(
  msg: Awaited<ReturnType<typeof getMessage>>,
  classify: ReturnType<typeof createClassifier>,
  anthropic: Anthropic,
): Promise<MasterRow[] | 'non-receipt'> {
  const msgId = msg.id ?? '(no-id)';
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

  const parsedOrders = await parseEmail(source, html, anthropic);
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

async function parseEmail(
  source: Source,
  html: string,
  anthropic: Anthropic,
): Promise<ParsedOrder[] | null> {
  if (source === 'REI') {
    // Online-order parser is the fast path. Falls through to the in-store
    // eReceipt parser if the email doesn't carry an `A`-prefixed order ID.
    const online = parseReiEmail(html);
    if (online) return [online];
    const receipt = parseReiReceiptEmail(html);
    return receipt ? [receipt] : null;
  }
  if (source === 'Amazon') {
    // Shipment-tracking is the fast path (cheerio, no LLM). Falls through to
    // the Haiku-based order-confirm parser if this isn't a shipment email.
    const shipment = parseAmazonShipmentEmail(html);
    if (shipment) return shipment;
    return await parseAmazonOrderEmail(anthropic, html);
  }
  return null;
}

function countItems(orders: ParsedOrder[]): number {
  return orders.reduce((sum, o) => sum + o.items.length, 0);
}

export function buildQuery(opts: PipelineOptions): string {
  const senders = `from:(${KNOWN_SENDERS.map((s) => s.email).join(' OR ')})`;
  if (opts.reprocessSince) {
    // Reprocess mode: bypass label filter, scoped by --since.
    return `${senders} in:anywhere after:${gmailDate(opts.reprocessSince)}`;
  }
  const afterPart = opts.ingestAfterDate
    ? ` after:${gmailDate(opts.ingestAfterDate)}`
    : ' newer_than:30d';
  return `${senders} in:anywhere -label:${PROCESSED_LABEL}${afterPart}`;
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

function log(msg: string): void {
  console.log(msg);
}

/**
 * Match a return-email item against an existing sheet row. Strong preference
 * for (orderId, productId) — that's robust to item-name drift. Falls back to
 * (orderId, fuzzy name token overlap) when the return email doesn't carry a
 * product URL. Returns the array index (0-based) or -1.
 */
function findRowForReturn(
  rows: readonly MasterRow[],
  orderId: string,
  item: { itemName: string; productUrl: string },
): number {
  const targetPid = extractProductId(item.productUrl);
  if (targetPid) {
    const exact = rows.findIndex(
      (r) => r.orderId === orderId && extractProductId(r.productUrl) === targetPid,
    );
    if (exact !== -1) return exact;
  }
  // Fallback: same order, fuzzy name overlap (>= 2 distinctive shared tokens).
  const targetTokens = nameTokens(item.itemName);
  if (targetTokens.size === 0) return -1;
  let bestIdx = -1;
  let bestOverlap = 0;
  rows.forEach((r, i) => {
    if (r.orderId !== orderId) return;
    const rowTokens = nameTokens(r.itemName);
    let overlap = 0;
    for (const t of targetTokens) if (rowTokens.has(t)) overlap++;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestIdx = i;
    }
  });
  return bestOverlap >= 2 ? bestIdx : -1;
}

const COMMON_TOKENS = new Set(['the', 'and', 'for', 'with', 'a', 'an', 'of', 'in', 'to', 'on']);

function nameTokens(name: string): Set<string> {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !COMMON_TOKENS.has(t));
  return new Set(tokens);
}
