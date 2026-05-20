import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PREFS,
  STORAGE_KEY,
  loadColumnPrefs,
  saveColumnPrefs,
  COLUMN_DEFS,
  type ColumnId,
  type ColumnPrefs,
} from '../../../app/lib/columns.js';

// jsdom-style localStorage shim — vitest runs in node by default.
class MemStore {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

beforeEach(() => {
  // Reset localStorage for each test
  (globalThis as { localStorage?: Storage }).localStorage = new MemStore() as unknown as Storage;
});

const ALL_IDS: ColumnId[] = [
  'date', 'category', 'itemName', 'brand', 'price', 'status',
  'subCategory', 'domain', 'year', 'color', 'size', 'qty',
  'type', 'source', 'orderId', 'entryMethod',
];

describe('DEFAULT_PREFS', () => {
  it('lists every ColumnId exactly once', () => {
    expect(DEFAULT_PREFS.columns.map((c) => c.id).sort()).toEqual([...ALL_IDS].sort());
  });

  it('has the 6 default-visible columns first, in order', () => {
    const visible = DEFAULT_PREFS.columns.filter((c) => c.visible).map((c) => c.id);
    expect(visible).toEqual(['date', 'category', 'itemName', 'brand', 'price', 'status']);
  });

  it('has the remaining columns default-hidden, in declared order', () => {
    const hidden = DEFAULT_PREFS.columns.filter((c) => !c.visible).map((c) => c.id);
    expect(hidden).toEqual(['subCategory', 'domain', 'year', 'color', 'size', 'qty', 'type', 'source', 'orderId', 'entryMethod']);
  });
});

describe('COLUMN_DEFS', () => {
  it('has an entry for every ColumnId', () => {
    for (const id of ALL_IDS) {
      expect(COLUMN_DEFS[id]).toBeDefined();
      expect(COLUMN_DEFS[id].id).toBe(id);
      expect(COLUMN_DEFS[id].label).toBeTruthy();
    }
  });

  it('marks every column sortable in v1', () => {
    for (const id of ALL_IDS) {
      expect(COLUMN_DEFS[id].sortable).toBe(true);
    }
  });

  it('right-aligns price and qty', () => {
    expect(COLUMN_DEFS.price.align).toBe('right');
    expect(COLUMN_DEFS.qty.align).toBe('right');
  });
});

describe('loadColumnPrefs', () => {
  it('returns DEFAULT_PREFS when localStorage is empty', () => {
    expect(loadColumnPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('returns DEFAULT_PREFS when localStorage has bad JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json{{{');
    expect(loadColumnPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('returns DEFAULT_PREFS when localStorage has unexpected shape', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ wrong: 'shape' }));
    expect(loadColumnPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('returns saved prefs when valid', () => {
    const custom: ColumnPrefs = {
      columns: [
        { id: 'price', visible: true },
        { id: 'itemName', visible: true },
        { id: 'date', visible: false },
        { id: 'category', visible: false },
        { id: 'brand', visible: false },
        { id: 'status', visible: false },
        { id: 'subCategory', visible: false },
        { id: 'domain', visible: false },
        { id: 'year', visible: false },
        { id: 'color', visible: false },
        { id: 'size', visible: false },
        { id: 'qty', visible: false },
        { id: 'type', visible: false },
        { id: 'source', visible: false },
        { id: 'orderId', visible: false },
        { id: 'entryMethod', visible: false },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    expect(loadColumnPrefs()).toEqual(custom);
  });

  it('merges in missing ColumnIds at the end (forward-compat)', () => {
    const partial: ColumnPrefs = {
      columns: [
        { id: 'date', visible: true },
        { id: 'price', visible: true },
        // missing the other 13
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(partial));
    const loaded = loadColumnPrefs();
    expect(loaded.columns.length).toBe(ALL_IDS.length);
    expect(loaded.columns[0]).toEqual({ id: 'date', visible: true });
    expect(loaded.columns[1]).toEqual({ id: 'price', visible: true });
    // remaining ids appear after, hidden
    const remainingIds = loaded.columns.slice(2).map((c) => c.id);
    for (const id of ['category', 'itemName', 'brand', 'status', 'subCategory', 'domain', 'year', 'color', 'size', 'qty', 'type', 'source', 'orderId', 'entryMethod']) {
      expect(remainingIds).toContain(id);
    }
    expect(loaded.columns.slice(2).every((c) => !c.visible)).toBe(true);
  });

  it('drops unknown ColumnIds (defensive)', () => {
    const tainted = {
      columns: [
        { id: 'date', visible: true },
        { id: 'made-up-column', visible: true }, // not a valid ColumnId
        { id: 'price', visible: true },
      ],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tainted));
    const loaded = loadColumnPrefs();
    expect(loaded.columns.find((c) => (c.id as string) === 'made-up-column')).toBeUndefined();
    expect(loaded.columns.find((c) => c.id === 'date')).toBeDefined();
    expect(loaded.columns.find((c) => c.id === 'price')).toBeDefined();
  });
});

describe('saveColumnPrefs', () => {
  it('writes JSON to the expected key', () => {
    saveColumnPrefs(DEFAULT_PREFS);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual(DEFAULT_PREFS);
  });

  it('round-trips through load', () => {
    const custom: ColumnPrefs = {
      columns: DEFAULT_PREFS.columns.map((c) => ({ id: c.id, visible: !c.visible })),
    };
    saveColumnPrefs(custom);
    expect(loadColumnPrefs()).toEqual(custom);
  });
});
