import type Anthropic from '@anthropic-ai/sdk';
import type { SheetsClient, UpdateStatusInput } from '../../lib/sheets.js';
import type { MasterRow, Status } from '../../lib/types.js';
import type { InventoryCache } from './inventoryCache.js';
import type { Stats } from './stats.js';
import type { PendingActionStore } from '../../lib/pendingActions.js';
import { formatStats } from './stats.js';
import { filterToActiveOutdoor, findByFuzzyName, getById } from '../../domains/outdoor/inventory.js';
import { itemId } from '../../domains/outdoor/types.js';
import { parseCommand } from './commands/parse.js';
import type { LogDraft } from './commands/log.js';
import { startAddgear, continueAddgear, type AddgearDeps } from './commands/addgear.js';
import { AddgearStateStore } from '../../lib/addgearState.js';
import { formatLogPreview } from './preview.js';

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
  if (name === 'help') return handleHelp(deps);
  return null;
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
  await deps.appendMasterRow(deps.sheets, deps.spreadsheetId, pending.row);
  deps.cache.applyLocalChange(pending.row);
  // Successful write ends any /addgear flow that pre-parked this row.
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
    `/stats — agent + cache statistics`,
    `/refresh — force-reload inventory from the sheet`,
    `/help — this message`,
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
