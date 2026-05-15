import type { SheetsClient } from '../../lib/sheets.js';
import { STATUS_VALUES, type MasterRow, type Status } from '../../lib/types.js';
import type { InventoryCache } from '../../apps/bot/inventoryCache.js';
import { itemId } from './types.js';

export interface ToolDeps {
  cache: InventoryCache;
  sheets: SheetsClient;
  spreadsheetId: string;
  updateRowStatus: (
    sheets: SheetsClient,
    spreadsheetId: string,
    input: { rowIndex: number; newStatus: Status },
  ) => Promise<void>;
}

export interface GetProductUrlInput {
  item_id: string;
}

export interface GetProductUrlResult {
  ok: boolean;
  product_url: string | null;
}

export interface UpdateStatusInput {
  item_id: string;
  new_status: Status;
}

export interface UpdateStatusResult {
  ok: boolean;
  message: string;
}

export interface ToolHandlers {
  get_product_url: (input: GetProductUrlInput) => Promise<GetProductUrlResult>;
  update_status: (input: UpdateStatusInput) => Promise<UpdateStatusResult>;
}

export const TOOL_SCHEMAS = [
  {
    name: 'get_product_url',
    description:
      "Look up the product URL for a specific inventory item by its 6-character id (the [id] in front of each row of the inventory in your system prompt). Use this when the user asks for a link, or when you want to point them at the product page.",
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'The 6-char id from the inventory list.' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'update_status',
    description:
      "Update an inventory item's status. Use when Tom tells you he lost, sold, donated, retired, returned, or broke an item, or wants to mark it excluded. This writes to the sheet and immediately removes the item from your active inventory view if the new status is anything other than 'active'.",
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'The 6-char id from the inventory list.' },
        new_status: {
          type: 'string',
          enum: ['active', 'retired', 'returned', 'lost', 'broken', 'sold', 'donated', 'excluded'],
          description: 'The new status.',
        },
      },
      required: ['item_id', 'new_status'],
    },
  },
] as const;

const WEB_SEARCH_ALLOWED_DOMAINS = [
  // Retailers (pricing, stock, returns)
  'rei.com', 'backcountry.com', 'patagonia.com', 'evo.com', 'moosejaw.com',
  'competitivecyclist.com', 'nrs.com', 'jensonusa.com', 'amazon.com',
  'llbean.com', 'cabelas.com', 'basspro.com',
  // Expert reviews (product judgment)
  'outdoorgearlab.com', 'switchbacktravel.com', 'treelinereview.com',
  'gearjunkie.com', 'climbing.com', 'pinkbike.com', 'bikepacking.com',
  // Official / conditions (weather, regulations, trails, snow)
  'weather.gov', 'noaa.gov', 'nps.gov', 'fs.usda.gov', 'blm.gov',
  'recreation.gov', 'avalanche.org', 'alltrails.com', 'mountainproject.com',
  'opensnow.com',
] as const;

export const SERVER_TOOLS = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 3,
    allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS as unknown as string[],
  },
] as const;

export function createTools(deps: ToolDeps): ToolHandlers {
  return {
    async get_product_url(input: GetProductUrlInput): Promise<GetProductUrlResult> {
      const row = findRow(deps.cache.getSnapshot(), input.item_id);
      if (!row) return { ok: false, product_url: null };
      return { ok: true, product_url: row.productUrl };
    },

    async update_status(input: UpdateStatusInput): Promise<UpdateStatusResult> {
      if (!STATUS_VALUES.includes(input.new_status as Status)) {
        return { ok: false, message: `Invalid status: ${input.new_status}` };
      }
      const snapshot = deps.cache.getSnapshot();
      const rowPosition = findRowIndex(snapshot, input.item_id);
      if (rowPosition < 0) {
        return { ok: false, message: `Unknown item_id: ${input.item_id}` };
      }
      const sheetRowIndex = rowPosition + 2;
      await deps.updateRowStatus(deps.sheets, deps.spreadsheetId, {
        rowIndex: sheetRowIndex,
        newStatus: input.new_status,
      });
      const updated: MasterRow = { ...snapshot[rowPosition]!, status: input.new_status };
      deps.cache.applyLocalChange(updated);
      return { ok: true, message: `Marked ${updated.itemName} as ${input.new_status}` };
    },
  };
}

function findRow(snapshot: readonly MasterRow[], id: string): MasterRow | null {
  return snapshot.find((r) => itemId(r) === id) ?? null;
}

function findRowIndex(snapshot: readonly MasterRow[], id: string): number {
  return snapshot.findIndex((r) => itemId(r) === id);
}
