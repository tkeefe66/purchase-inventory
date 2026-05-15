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
}

export async function dispatchCommand(chatId: string, text: string, deps: HandlerDeps): Promise<string | null> {
  const parsed = parseCommand(text);
  if (!parsed) return null;
  const { name, args } = parsed;
  if (STATUS_CHANGE_COMMANDS[name]) return handleStatusChange(STATUS_CHANGE_COMMANDS[name]!, args, deps);
  if (name === 'log') return handleLog(chatId, args, deps);
  if (name === 'confirm') return handleConfirm(chatId, deps);
  if (name === 'cancel') return handleCancel(chatId, deps);
  if (name === 'stats') return handleStats(deps);
  if (name === 'refresh') return handleRefresh(deps);
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
    `About to log:`,
    `  ${row.brand} ${row.itemName} (${row.color || '—'}, ${row.size || '—'})`,
    `  $${row.price}, ${row.source}, ${row.date}, [${row.category}/${row.subCategory}]`,
    `Reply /confirm to write or /cancel to discard.`,
  ].join('\n');
}

async function handleConfirm(chatId: string, deps: HandlerDeps): Promise<string> {
  const pending = deps.pendingActions.pop(chatId);
  if (!pending) return `Nothing to confirm.`;
  await deps.appendMasterRow(deps.sheets, deps.spreadsheetId, pending.row);
  deps.cache.applyLocalChange(pending.row);
  return `Logged: ${pending.row.brand} ${pending.row.itemName} — $${pending.row.price}.`;
}

async function handleCancel(chatId: string, deps: HandlerDeps): Promise<string> {
  const pending = deps.pendingActions.peek(chatId);
  if (!pending) return `Nothing to cancel.`;
  deps.pendingActions.clear(chatId);
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
