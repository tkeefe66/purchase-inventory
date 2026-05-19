import type Anthropic from '@anthropic-ai/sdk';
import { appendMaintenanceAck } from '../../lib/sheets.js';
import type { SheetsClient, UpdateStatusInput } from '../../lib/sheets.js';
import type { MasterRow, Status } from '../../lib/types.js';
import type { InventoryCache } from './inventoryCache.js';
import type { Stats } from './stats.js';
import type { PendingActionStore } from '../../lib/pendingActions.js';
import { formatStats } from './stats.js';
import { filterToActiveOutdoor, findByFuzzyName, getById } from '../../domains/outdoor/inventory.js';
import { itemId } from '../../lib/itemId.js';
import { parseCommand } from './commands/parse.js';
import type { LogDraft } from './commands/log.js';
import { startAddgear, continueAddgear, type AddgearDeps } from './commands/addgear.js';
import { AddgearStateStore } from '../../lib/addgearState.js';
import { formatLogPreview } from './preview.js';
import type { PipelineResult } from '../cron/pipeline.js';
import { handleCampingCommand, type CampingDeps } from './commands/camping.js';
import { handlePhotographyCommand, type PhotographyDeps } from './commands/photography.js';
import type { StickyModeStore, DomainMode } from '../../lib/stickyMode.js';

const STATUS_CHANGE_COMMANDS: Record<string, Status> = {
  lost: 'lost', sold: 'sold', donated: 'donated', retired: 'retired', broken: 'broken',
};

export interface HandlerDeps {
  cache: InventoryCache;
  stats: Stats;
  pendingActions: PendingActionStore;
  sheets: SheetsClient;
  spreadsheetId: string;
  anthropic: Anthropic;
  updateRowStatus: (sheets: SheetsClient, spreadsheetId: string, input: UpdateStatusInput) => Promise<void>;
  appendMasterRow: (sheets: SheetsClient, spreadsheetId: string, row: MasterRow) => Promise<{ rowIndex: number }>;
  extractLogDraft: (anthropic: Anthropic, userText: string, todayIso: string) => Promise<LogDraft | null>;
  today: () => string;
  addgearState: AddgearStateStore;
  startAddgear: typeof startAddgear;
  continueAddgear: typeof continueAddgear;
  addgearInner: Omit<AddgearDeps, 'addgearState' | 'pendingActions' | 'today'>;
  /** On-demand inbox scan triggered by `/scan`. Same code path as the
   *  scheduled cron; suppresses the pipeline's own Telegram digest so the
   *  bot returns one formatted reply instead of two messages. */
  runScan: () => Promise<PipelineResult>;
  camping: CampingDeps;
  /** Per-chat sticky domain mode. Persisted across bot restarts. */
  stickyMode: StickyModeStore;
  /** Domain agent invocations. Used by per-message slash overrides
   *  (`/photo <body>`, `/outdoor <body>`). The router also calls these
   *  for the sticky-mode fallback, but via routerDeps; the dispatchCommand
   *  copies here exist so override-form commands can reach the agents too. */
  handleOutdoorAgentMessage: (chatId: string, text: string) => Promise<string>;
  handlePhotographyAgentMessage: (chatId: string, text: string) => Promise<string>;
  /** Photography curriculum + assignment sheet I/O — powers /skills /track
   *  /next /active /skip /plan /learn. */
  photography: PhotographyDeps;
}

export async function dispatchCommand(chatId: string, text: string, deps: HandlerDeps): Promise<string | null> {
  const parsed = parseCommand(text);
  if (!parsed) return null;
  const { name, args } = parsed;
  if (STATUS_CHANGE_COMMANDS[name]) return handleStatusChange(STATUS_CHANGE_COMMANDS[name]!, args, deps);
  if (name === 'log') return handleLog(chatId, args, deps);
  if (name === 'addgear') return `Send a photo of the gear with the caption "/addgear [optional notes]". A photo is required.`;
  if (name === 'confirm') return handleConfirm(chatId, deps);
  if (name === 'cancel') return handleCancel(chatId, deps);
  if (name === 'stats') return handleStats(deps);
  if (name === 'refresh') return handleRefresh(deps);
  if (name === 'scan') return handleScan(deps);
  if (name === 'help') return handleHelp(deps);
  if (name === 'ack-maintenance') return handleAckMaintenance(args, deps);
  if (
    name === 'watch' || name === 'unwatch' || name === 'watchlist' || name === 'regions'
    || name === 'plan-trip' || name === 'trips' || name === 'cancel-trip' || name === 'campsites'
  ) {
    return handleCampingCommand({ name, args }, deps.camping, chatId);
  }
  if (name === 'photo' || name === 'outdoor') return handleDomainCommand(chatId, name, args, deps);
  if (name === 'who') return handleWho(chatId, deps);
  if (
    name === 'skills' || name === 'track' || name === 'next'
    || name === 'active' || name === 'skip' || name === 'plan'
    || name === 'learn' || name === 'start'
  ) {
    return handlePhotographyCommand({ name, args }, deps.photography);
  }
  return null;
}

async function handleDomainCommand(
  chatId: string,
  domain: 'photo' | 'outdoor',
  args: string,
  deps: HandlerDeps,
): Promise<string> {
  const mode: DomainMode = domain === 'photo' ? 'photography' : 'outdoor';
  // With a body, this is a per-message override — route the body to that
  // domain's agent without touching sticky mode.
  if (args) {
    return mode === 'photography'
      ? deps.handlePhotographyAgentMessage(chatId, args)
      : deps.handleOutdoorAgentMessage(chatId, args);
  }
  // Bare form sets sticky mode.
  await deps.stickyMode.set(chatId, mode);
  return mode === 'photography' ? `📸 Photography mode.` : `🏕 Outdoor mode.`;
}

function handleWho(chatId: string, deps: HandlerDeps): string {
  const mode = deps.stickyMode.get(chatId);
  return mode === 'photography'
    ? `Current mode: 📸 Photography. Switch with \`/outdoor\`.`
    : `Current mode: 🏕 Outdoor. Switch with \`/photo\`.`;
}

const ID_RE = /^[0-9a-z]{6}$/;

async function handleStatusChange(newStatus: Status, args: string, deps: HandlerDeps): Promise<string> {
  if (!args) return `Usage: /<lost|sold|donated|retired|broken> <item name or 6-char id>`;
  const snapshot = deps.cache.getSnapshot();
  let target: MasterRow | null;
  if (ID_RE.test(args)) {
    target = getById(snapshot, args);
    if (!target) return `No item with id [${args}].`;
  } else {
    const matches = findByFuzzyName(snapshot, args);
    if (matches.length === 0) return `Couldn't find an active item matching "${args}". Try a different name or use the 6-char id.`;
    if (matches.length > 1) {
      const list = matches.slice(0, 8).map((r) => `  [${itemId(r)}] ${r.brand} ${r.itemName}`).join('\n');
      return `Multiple matches for "${args}":\n${list}\nReply with the id, e.g. \`/${newStatus} ${itemId(matches[0]!)}\`.`;
    }
    target = matches[0]!;
  }
  const rowPosition = snapshot.findIndex((r) => itemId(r) === itemId(target!));
  await deps.updateRowStatus(deps.sheets, deps.spreadsheetId, {
    rowIndex: rowPosition + 2,
    newStatus,
  });
  deps.cache.applyLocalChange({ ...target, status: newStatus });
  return `Marked ${target.brand} ${target.itemName} as ${newStatus}.`;
}

async function handleLog(chatId: string, args: string, deps: HandlerDeps): Promise<string> {
  if (!args) return `Usage: /log <free-form purchase description>`;
  const today = deps.today();
  const draft = await deps.extractLogDraft(deps.anthropic, args, today);
  if (!draft) return `Couldn't extract purchase fields from "${args}". Try including the item name, brand, price, and source.`;
  const row: MasterRow = {
    year: draft.date.slice(0, 4),
    date: draft.date,
    category: draft.category,
    subCategory: draft.subCategory,
    brand: draft.brand,
    itemName: draft.itemName,
    color: draft.color,
    size: draft.size,
    qty: 1,
    price: draft.price,
    source: draft.source,
    orderId: '',
    status: 'active',
    domain: 'Outdoor',
    productUrl: '',
    type: draft.type,
    reasoning: '',
    notes: '',
  };
  deps.pendingActions.set(chatId, { type: 'log-append', row });
  return [
    formatLogPreview(row),
    ``,
    `Reply /confirm to write or /cancel to discard.`,
  ].join('\n');
}

async function handleConfirm(chatId: string, deps: HandlerDeps): Promise<string> {
  const pending = deps.pendingActions.pop(chatId);
  if (!pending) return `Nothing to confirm.`;
  // /confirm is only meaningful for log-append actions (set by /log or /addgear).
  // Other pending kinds (camping selections) shouldn't be confirmed via this command.
  if (pending.type !== 'log-append') return `Nothing to confirm.`;
  await deps.appendMasterRow(deps.sheets, deps.spreadsheetId, pending.row);
  deps.cache.applyLocalChange(pending.row);
  deps.addgearState.clear(chatId);
  return `Logged: ${pending.row.brand} ${pending.row.itemName} — $${pending.row.price}.`;
}

async function handleCancel(chatId: string, deps: HandlerDeps): Promise<string> {
  const hadPending = deps.pendingActions.peek(chatId);
  const hadAddgear = deps.addgearState.peek(chatId);
  if (!hadPending && !hadAddgear) return `Nothing to cancel.`;
  deps.pendingActions.clear(chatId);
  deps.addgearState.clear(chatId);
  return `Cancelled.`;
}

async function handleAckMaintenance(args: string, deps: HandlerDeps): Promise<string> {
  if (!args) return `Usage: /ack-maintenance <6-char item id> [notes]`;
  const tokens = args.trim().split(/\s+/);
  const id = tokens[0] ?? '';
  if (!ID_RE.test(id)) return `Invalid item id "${id}". Expected 6 lowercase chars/digits (see ids in the monthly nudge message).`;
  const notes = tokens.slice(1).join(' ');
  // Look up the item in the cache for a nicer confirmation message.
  const snapshot = deps.cache.getSnapshot();
  const item = getById(snapshot, id);
  await appendMaintenanceAck(deps.sheets, deps.spreadsheetId, {
    itemId: id,
    ackedAt: new Date().toISOString(),
    notes: notes || 'via /ack-maintenance',
  });
  const label = item ? `${item.brand} ${item.itemName}` : id;
  return `Acked ${label} — silenced from maintenance nudges for 12 months.`;
}

function handleStats(deps: HandlerDeps): string {
  const activeOutdoor = filterToActiveOutdoor(deps.cache.getSnapshot()).length;
  const compactText = deps.cache.getCompactView().text;
  const approxTokens = Math.ceil(compactText.length / 4);
  return formatStats(deps.stats, {
    activeOutdoorRows: activeOutdoor,
    freeContextTokens: 200_000 - approxTokens,
  });
}

function handleHelp(deps: HandlerDeps): string {
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${deps.spreadsheetId}/edit`;
  return [
    `*Outdoor inventory bot — commands*`,
    ``,
    `*Capture*`,
    `/addgear <caption> — send a photo of gear you own. Caption can include date and price, e.g. "12/21/23 $135.15". Bot extracts brand/name/color/size from the photo, looks up a product URL, and asks for any missing info.`,
    `/log <description> — free-form text for in-store / cash purchases without a receipt.`,
    ``,
    `*Status changes*`,
    `/retired <name or 6-char id> — mark as no longer in active rotation`,
    `/lost | /sold | /donated | /broken <name or id> — corresponding status`,
    ``,
    `*Confirm flow*`,
    `/confirm — write the pending row (after /log or /addgear preview)`,
    `/cancel — discard the pending row`,
    ``,
    `*Status*`,
    `/scan — force the bot to scan your email for new purchases right now (don't wait for the 6am/6pm cron)`,
    `/stats — agent + cache statistics`,
    `/refresh — force-reload inventory from the sheet`,
    `/ack-maintenance <6-char id> [notes] — silence an item from the monthly maintenance nudge for 12 months`,
    `/help — this message`,
    ``,
    `*Camping*`,
    `/watchlist — see facilities you're being nudged about`,
    `/regions — list curated regions`,
    `/watch <name|region|parent> — un-mute facilities`,
    `/unwatch <name|region|parent> — mute facilities (bulk)`,
    `/plan-trip <facility> <YYYY-MM-DD> — register a trip; bot fires 7-day + release-moment alerts`,
    `/trips — list planned trips`,
    `/cancel-trip <id|facility> — stop nudges for a trip`,
    ``,
    `*Sheet:* [open in Google Sheets](${sheetUrl})`,
    ``,
    `Or just chat — outdoor questions go to the agent.`,
  ].join('\n');
}

async function handleRefresh(deps: HandlerDeps): Promise<string> {
  const t0 = Date.now();
  await deps.cache.forceRefresh();
  const dt = Date.now() - t0;
  const snap = deps.cache.getSnapshot();
  const activeOutdoor = filterToActiveOutdoor(snap).length;
  deps.stats.recordRefresh({
    rowCount: snap.length,
    durationMs: dt,
    hashChanged: deps.cache.lastRefreshChangedHash,
  });
  return `Refreshed in ${dt}ms — ${snap.length} total rows, ${activeOutdoor} active outdoor.`;
}

async function handleScan(deps: HandlerDeps): Promise<string> {
  const t0 = Date.now();
  let result: PipelineResult;
  try {
    result = await deps.runScan();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Scan failed: ${msg}`;
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Refresh the local cache if anything was written so subsequent agent
  // queries see the new items without waiting for the 15-min cache TTL.
  if (result.itemsAdded > 0 || result.returnsApplied > 0) {
    try { await deps.cache.forceRefresh(); } catch { /* non-fatal */ }
  }

  const lines: string[] = [`Inbox scan complete (${elapsed}s).`];
  if (result.itemsAdded > 0) {
    lines.push(`✅ ${result.itemsAdded} new item${result.itemsAdded === 1 ? '' : 's'}`);
    const bySource = Object.entries(result.itemsBySource).map(([k, v]) => `${k}: ${v}`).join(', ');
    if (bySource) lines.push(`   ${bySource}`);
  } else {
    lines.push(`📭 No new items`);
  }
  if (result.returnsApplied > 0) {
    lines.push(`↩️ ${result.returnsApplied} row${result.returnsApplied === 1 ? '' : 's'} marked returned`);
  }
  if (result.returnsUnmatched > 0) {
    lines.push(`⚠️ ${result.returnsUnmatched} return(s) couldn't be matched to a row`);
  }
  lines.push(
    `${result.messagesScanned} email${result.messagesScanned === 1 ? '' : 's'} scanned`
    + `, ${result.skippedNonReceipts} skipped`
    + `, ${result.duplicatesIgnored} duplicates filtered`,
  );
  if (result.errors.length > 0) {
    lines.push(`❌ ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} — check the cron logs.`);
  }
  return lines.join('\n');
}

export async function handlePhoto(
  chatId: string,
  photoFileId: string,
  caption: string,
  deps: HandlerDeps,
): Promise<string | null> {
  if (!/^\/addgear\b/i.test(caption.trim())) return null;
  return deps.startAddgear(chatId, photoFileId, caption, {
    ...deps.addgearInner,
    addgearState: deps.addgearState,
    pendingActions: deps.pendingActions,
    today: deps.today,
  });
}

export async function handleAddgearContinuation(
  chatId: string,
  text: string,
  deps: HandlerDeps,
): Promise<string | null> {
  if (!deps.addgearState.peek(chatId)) return null;
  return deps.continueAddgear(chatId, text, {
    ...deps.addgearInner,
    addgearState: deps.addgearState,
    pendingActions: deps.pendingActions,
    today: deps.today,
  });
}
