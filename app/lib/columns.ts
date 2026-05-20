import type { MasterRow } from '../../lib/types.js';

export type ColumnId =
  | 'date' | 'category' | 'itemName' | 'brand' | 'price' | 'status'
  | 'subCategory' | 'domain' | 'year' | 'color' | 'size' | 'qty'
  | 'type' | 'source' | 'orderId' | 'entryMethod';

const ALL_COLUMN_IDS: readonly ColumnId[] = [
  'date', 'category', 'itemName', 'brand', 'price', 'status',
  'subCategory', 'domain', 'year', 'color', 'size', 'qty',
  'type', 'source', 'orderId', 'entryMethod',
] as const;

export interface ColumnDef {
  id: ColumnId;
  label: string;
  sortable: boolean;
  align?: 'left' | 'right';
  accessor: (r: MasterRow) => string | number;
}

export const COLUMN_DEFS: Record<ColumnId, ColumnDef> = {
  date:        { id: 'date',        label: 'Date',         sortable: true, accessor: (r) => r.date },
  category:    { id: 'category',    label: 'Category',     sortable: true, accessor: (r) => r.category },
  itemName:    { id: 'itemName',    label: 'Item',         sortable: true, accessor: (r) => r.itemName },
  brand:       { id: 'brand',       label: 'Brand',        sortable: true, accessor: (r) => r.brand },
  price:       { id: 'price',       label: 'Price',        sortable: true, align: 'right', accessor: (r) => r.price },
  status:      { id: 'status',      label: 'Status',       sortable: true, accessor: (r) => r.status },
  subCategory: { id: 'subCategory', label: 'Sub-category', sortable: true, accessor: (r) => r.subCategory },
  domain:      { id: 'domain',      label: 'Domain',       sortable: true, accessor: (r) => r.domain },
  year:        { id: 'year',        label: 'Year',         sortable: true, accessor: (r) => r.year },
  color:       { id: 'color',       label: 'Color',        sortable: true, accessor: (r) => r.color },
  size:        { id: 'size',        label: 'Size',         sortable: true, accessor: (r) => r.size },
  qty:         { id: 'qty',         label: 'Qty',          sortable: true, align: 'right', accessor: (r) => r.qty },
  type:        { id: 'type',        label: 'Type',         sortable: true, accessor: (r) => r.type },
  source:      { id: 'source',      label: 'Source',       sortable: true, accessor: (r) => r.source },
  orderId:     { id: 'orderId',     label: 'Order ID',     sortable: true, accessor: (r) => r.orderId },
  entryMethod: { id: 'entryMethod', label: 'Entry Method', sortable: true, accessor: (r) => r.entryMethod },
};

export interface ColumnPrefs {
  columns: Array<{ id: ColumnId; visible: boolean }>;
}

export const DEFAULT_PREFS: ColumnPrefs = {
  columns: [
    { id: 'date',        visible: true  },
    { id: 'category',    visible: true  },
    { id: 'itemName',    visible: true  },
    { id: 'brand',       visible: true  },
    { id: 'price',       visible: true  },
    { id: 'status',      visible: true  },
    { id: 'subCategory', visible: false },
    { id: 'domain',      visible: false },
    { id: 'year',        visible: false },
    { id: 'color',       visible: false },
    { id: 'size',        visible: false },
    { id: 'qty',         visible: false },
    { id: 'type',        visible: false },
    { id: 'source',      visible: false },
    { id: 'orderId',     visible: false },
    { id: 'entryMethod', visible: false },
  ],
};

export const STORAGE_KEY = 'inventory.columnPrefs.v1';

function isColumnId(x: unknown): x is ColumnId {
  return typeof x === 'string' && (ALL_COLUMN_IDS as readonly string[]).includes(x);
}

function parsePrefs(raw: unknown): ColumnPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const maybe = raw as { columns?: unknown };
  if (!Array.isArray(maybe.columns)) return null;
  const cleaned: Array<{ id: ColumnId; visible: boolean }> = [];
  for (const entry of maybe.columns) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { id?: unknown; visible?: unknown };
    if (!isColumnId(e.id)) continue;
    cleaned.push({ id: e.id, visible: e.visible === true });
  }
  return { columns: cleaned };
}

function mergeMissingIds(prefs: ColumnPrefs): ColumnPrefs {
  const known = new Set(prefs.columns.map((c) => c.id));
  const additions: Array<{ id: ColumnId; visible: boolean }> = [];
  for (const id of ALL_COLUMN_IDS) {
    if (!known.has(id)) additions.push({ id, visible: false });
  }
  return additions.length === 0 ? prefs : { columns: [...prefs.columns, ...additions] };
}

export function loadColumnPrefs(): ColumnPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFS;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_PREFS;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  const parsed = parsePrefs(parsedJson);
  if (!parsed) return DEFAULT_PREFS;
  return mergeMissingIds(parsed);
}

export function saveColumnPrefs(prefs: ColumnPrefs): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full / unavailable — fail silently
  }
}
