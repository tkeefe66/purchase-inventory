# Outdoor Agent Inventory Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read-side inventory layer for the Phase 2 outdoor agent — an in-memory snapshot of active outdoor items, refreshed on a 15-min timer with a content-hash check, serialized into a compact prompt-cacheable format, with `/stats` instrumentation.

**Architecture:** Full-context retrieval. The bot maintains a single in-memory `MasterRow[]` snapshot of the sheet, refreshed every 15 min. A SHA-256 content hash of the sorted serialization detects real changes vs. no-op refreshes; only real changes invalidate the Anthropic prompt cache. The agent receives the entire active outdoor inventory as a compact text block in its system prompt every conversation. No retrieval tools in v1 — the agent reads, filters, and reasons over the whole list.

**Tech Stack:** TypeScript (strict), Node.js 20, vitest, googleapis (existing `lib/sheets.ts`), node:crypto for SHA-256, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-02-outdoor-agent-inventory-retrieval-design.md`

**Out of scope (do not implement here):** Telegram bot listener (Task 2.1), router (Task 2.2), agent itself (Task 2.4), slash commands (Task 2.5). This plan produces standalone, unit-tested modules that those tasks consume.

**Dependency:** Phase 1 soak completes cleanly (target 2026-05-08). Do not start implementation before then.

---

## File map

**New files:**
- `domains/outdoor/types.ts` — `OutdoorItem` (narrowed `MasterRow` for active outdoor rows) + `itemId()` stable hash generator
- `domains/outdoor/serialize.ts` — `serializeCompact(items): { text, hash }` pure function
- `domains/outdoor/inventory.ts` — thin query helpers: `filterToActiveOutdoor`, `getById`, `findByFuzzyName`, `applyStatusChange`
- `apps/bot/inventoryCache.ts` — long-lived snapshot + 15-min refresh + hash check + `applyLocalChange` + `forceRefresh`
- `apps/bot/stats.ts` — counters (per-query, per-refresh, per-session) + `formatStats()` for `/stats` Telegram output

**Test files:**
- `tests/domains/outdoor/serialize.test.ts`
- `tests/domains/outdoor/inventory.test.ts`
- `tests/apps/bot/inventoryCache.test.ts`
- `tests/apps/bot/stats.test.ts`
- `tests/fixtures/outdoor-items.ts` — shared canned `MasterRow[]` for tests

**Modified files:** none. `lib/sheets.ts:readMasterRows()` is reused as-is.

---

## Task 1: Outdoor item type + stable item ID

**Files:**
- Create: `domains/outdoor/types.ts`
- Create: `tests/fixtures/outdoor-items.ts`
- Create: `tests/domains/outdoor/types.test.ts`

The agent needs a stable, short ID per row so its tool calls (`get_product_url(item_id)`, `update_status(item_id, new_status)`) survive sheet refreshes. We hash the row's natural key fields (year + brand + itemName + color + size + orderId) and take the first 6 base36 chars. Stable across refreshes; effectively unique at our scale (36⁶ ≈ 2 billion).

- [ ] **Step 1.1: Create test fixtures with realistic outdoor rows**

```typescript
// tests/fixtures/outdoor-items.ts
import type { MasterRow } from '../../lib/types.js';

export const FIXTURE_THERMAREST: MasterRow = {
  year: '2026',
  date: '2026-04-28',
  category: 'Camping Gear',
  subCategory: 'Sleep System',
  brand: 'Therm-a-Rest',
  itemName: 'Z Lite Sol Sleeping Pad',
  color: 'Limon',
  size: 'Reg',
  qty: 1,
  price: 49.95,
  source: 'Amazon',
  orderId: '113-8158227-8962610',
  status: 'active',
  domain: 'Outdoor',
  productUrl: 'https://example.com/thermarest',
  type: 'Gear',
  reasoning: 'Sleeping pad for backpacking',
  notes: '',
};

export const FIXTURE_SALOMON: MasterRow = {
  year: '2026',
  date: '2026-04-29',
  category: 'Hiking Gear',
  subCategory: 'Footwear',
  brand: 'Salomon',
  itemName: 'X Ultra 5 Mid GORE-TEX Hiking Boots',
  color: 'Black/Asphalt/Castlerock',
  size: '9',
  qty: 1,
  price: 190,
  source: 'REI',
  orderId: '',
  status: 'active',
  domain: 'Outdoor',
  productUrl: 'https://www.rei.com/search?q=salomon',
  type: 'Gear',
  reasoning: '',
  notes: '',
};

export const FIXTURE_NO_BRAND: MasterRow = {
  year: '2026',
  date: '2026-04-30',
  category: 'Camping Gear',
  subCategory: 'Camp Accessories',
  brand: '',
  itemName: '12 Pack Tent Stake with Hammer',
  color: '',
  size: '',
  qty: 1,
  price: 19.99,
  source: 'Amazon',
  orderId: '113-2080859-2183404',
  status: 'active',
  domain: 'Outdoor',
  productUrl: 'https://example.com/stakes',
  type: 'Gear',
  reasoning: '',
  notes: '',
};

export const FIXTURE_RETIRED: MasterRow = {
  ...FIXTURE_THERMAREST,
  itemName: 'Old Backpack',
  status: 'retired',
  orderId: 'OLD-001',
};

export const FIXTURE_PHOTO: MasterRow = {
  ...FIXTURE_THERMAREST,
  category: 'Camera Lenses',
  subCategory: '',
  brand: 'Sigma',
  itemName: 'SIGMA 18-50mm F2.8',
  color: '',
  size: '',
  domain: 'Photography',
  orderId: 'PHOTO-001',
};

export const FIXTURE_ALL: MasterRow[] = [
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
  FIXTURE_RETIRED,
  FIXTURE_PHOTO,
];
```

- [ ] **Step 1.2: Write the failing tests for `itemId()`**

```typescript
// tests/domains/outdoor/types.test.ts
import { describe, test, expect } from 'vitest';
import { itemId, type OutdoorItem } from '../../../domains/outdoor/types.js';
import { FIXTURE_THERMAREST, FIXTURE_SALOMON } from '../../fixtures/outdoor-items.js';

describe('itemId', () => {
  test('returns 6-character base36 string', () => {
    const id = itemId(FIXTURE_THERMAREST);
    expect(id).toMatch(/^[0-9a-z]{6}$/);
  });

  test('is stable across calls with same input', () => {
    const id1 = itemId(FIXTURE_THERMAREST);
    const id2 = itemId(FIXTURE_THERMAREST);
    expect(id1).toBe(id2);
  });

  test('differs across distinct rows', () => {
    expect(itemId(FIXTURE_THERMAREST)).not.toBe(itemId(FIXTURE_SALOMON));
  });

  test('is identical when only ignored fields differ', () => {
    const variant: OutdoorItem = {
      ...FIXTURE_THERMAREST,
      reasoning: 'something different',
      notes: 'a new note',
      productUrl: 'https://different-url.example.com',
    };
    expect(itemId(variant)).toBe(itemId(FIXTURE_THERMAREST));
  });

  test('changes when natural-key fields change', () => {
    const variant: OutdoorItem = { ...FIXTURE_THERMAREST, color: 'Blue' };
    expect(itemId(variant)).not.toBe(itemId(FIXTURE_THERMAREST));
  });
});
```

- [ ] **Step 1.3: Run the tests — expect failure (module missing)**

```bash
npx vitest run tests/domains/outdoor/types.test.ts
```

Expected: FAIL with `Cannot find module '../../../domains/outdoor/types.js'`.

- [ ] **Step 1.4: Implement `domains/outdoor/types.ts`**

```typescript
// domains/outdoor/types.ts
import { createHash } from 'node:crypto';
import type { MasterRow } from '../../lib/types.js';

/**
 * A MasterRow narrowed to active outdoor items. Same shape as MasterRow;
 * a phantom-typed alias keeps the agent's data flow visibly distinct from
 * raw sheet rows.
 */
export type OutdoorItem = MasterRow & { readonly __outdoor: unique symbol };

/**
 * Stable 6-char base36 id derived from natural-key fields only.
 * Survives sheet refreshes and ignores cosmetic fields (reasoning, notes,
 * productUrl) so an admin edit to those does not change the agent's
 * reference to the item.
 */
export function itemId(row: Pick<MasterRow, 'year' | 'brand' | 'itemName' | 'color' | 'size' | 'orderId'>): string {
  const naturalKey = [row.year, row.brand, row.itemName, row.color, row.size, row.orderId].join('|');
  const hex = createHash('sha256').update(naturalKey).digest('hex');
  // 6 base36 chars from the first 32 bits of the hash.
  const n = parseInt(hex.slice(0, 8), 16);
  return n.toString(36).padStart(6, '0').slice(-6);
}
```

- [ ] **Step 1.5: Run tests — expect pass**

```bash
npx vitest run tests/domains/outdoor/types.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add domains/outdoor/types.ts tests/fixtures/outdoor-items.ts tests/domains/outdoor/types.test.ts
git commit -m "feat: OutdoorItem type + stable itemId hash (Phase 2, Task 2.3 part 1/5)"
```

---

## Task 2: Compact serialization

**Files:**
- Create: `domains/outdoor/serialize.ts`
- Create: `tests/domains/outdoor/serialize.test.ts`

Pure function that turns `MasterRow[]` into a compact text block + content hash. Drops non-active and non-Outdoor rows. Sorts deterministically so the hash is stable across no-op refreshes.

- [ ] **Step 2.1: Write the failing tests**

```typescript
// tests/domains/outdoor/serialize.test.ts
import { describe, test, expect } from 'vitest';
import { serializeCompact } from '../../../domains/outdoor/serialize.js';
import {
  FIXTURE_ALL,
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
} from '../../fixtures/outdoor-items.js';

describe('serializeCompact', () => {
  test('renders header with active-only note and total row count', () => {
    const out = serializeCompact([FIXTURE_THERMAREST]);
    expect(out.text).toContain('=== ACTIVE OUTDOOR INVENTORY ===');
    expect(out.text).toContain('Total rows: 1');
    expect(out.text).toContain('Only items with status=active are shown');
  });

  test('filters out non-Outdoor rows', () => {
    const out = serializeCompact(FIXTURE_ALL);
    expect(out.text).not.toContain('Sigma');
  });

  test('filters out non-active rows', () => {
    const out = serializeCompact(FIXTURE_ALL);
    expect(out.text).not.toContain('Old Backpack');
  });

  test('renders a row with brand, color, and size', () => {
    const out = serializeCompact([FIXTURE_THERMAREST]);
    expect(out.text).toContain(
      '| 2026 | Therm-a-Rest Z Lite Sol Sleeping Pad (Limon, Reg) | $49.95 [Camping Gear/Sleep System]',
    );
  });

  test('renders a row without a brand (no leading space)', () => {
    const out = serializeCompact([FIXTURE_NO_BRAND]);
    expect(out.text).toContain(
      '| 2026 | 12 Pack Tent Stake with Hammer | $19.99 [Camping Gear/Camp Accessories]',
    );
  });

  test('omits color/size parens when both blank', () => {
    const out = serializeCompact([FIXTURE_NO_BRAND]);
    expect(out.text).not.toMatch(/12 Pack Tent Stake with Hammer\s*\(/);
  });

  test('renders only category when sub-category is blank', () => {
    const onlyCat = { ...FIXTURE_NO_BRAND, subCategory: '' };
    const out = serializeCompact([onlyCat]);
    expect(out.text).toContain('[Camping Gear]');
    expect(out.text).not.toContain('[Camping Gear/]');
  });

  test('prefixes each row with its 6-char itemId in brackets', () => {
    const out = serializeCompact([FIXTURE_THERMAREST]);
    expect(out.text).toMatch(/\n\[[0-9a-z]{6}\] \| 2026 \| Therm-a-Rest/);
  });

  test('sorts rows by category, then year desc, then itemName for hash stability', () => {
    const a = serializeCompact([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    const b = serializeCompact([FIXTURE_SALOMON, FIXTURE_THERMAREST]);
    expect(a.text).toBe(b.text);
    expect(a.hash).toBe(b.hash);
  });

  test('returns a 64-char hex SHA-256 hash', () => {
    const out = serializeCompact([FIXTURE_THERMAREST]);
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('produces a different hash when row data changes', () => {
    const a = serializeCompact([FIXTURE_THERMAREST]);
    const variant = { ...FIXTURE_THERMAREST, price: 59.95 };
    const b = serializeCompact([variant]);
    expect(a.hash).not.toBe(b.hash);
  });

  test('produces the same hash when only ignored fields change', () => {
    const a = serializeCompact([FIXTURE_THERMAREST]);
    const variant = { ...FIXTURE_THERMAREST, reasoning: 'changed' };
    const b = serializeCompact([variant]);
    expect(a.hash).toBe(b.hash);
  });

  test('handles empty input gracefully', () => {
    const out = serializeCompact([]);
    expect(out.text).toContain('Total rows: 0');
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2.2: Run tests — expect failure**

```bash
npx vitest run tests/domains/outdoor/serialize.test.ts
```

Expected: FAIL with `Cannot find module '../../../domains/outdoor/serialize.js'`.

- [ ] **Step 2.3: Implement `domains/outdoor/serialize.ts`**

```typescript
// domains/outdoor/serialize.ts
import { createHash } from 'node:crypto';
import type { MasterRow } from '../../lib/types.js';
import { itemId } from './types.js';

const HEADER = `=== ACTIVE OUTDOOR INVENTORY ===
Format: [id] | Year | [Brand] Item (Color, Size) | $price [Category/Sub-Category]
Note: Only items with status=active are shown. Non-active items (retired/returned/lost/broken/sold/donated) are out of view in this conversation.`;

export interface CompactView {
  text: string;
  hash: string;
}

export function serializeCompact(rows: readonly MasterRow[]): CompactView {
  const filtered = rows.filter((r) => r.domain === 'Outdoor' && r.status === 'active');
  const sorted = [...filtered].sort(compareForStableHash);
  const lines = sorted.map(formatRow);
  const body = lines.join('\n');
  const text = `${HEADER}\nTotal rows: ${sorted.length}\n\n${body}`;
  const hash = createHash('sha256').update(text).digest('hex');
  return { text, hash };
}

function compareForStableHash(a: MasterRow, b: MasterRow): number {
  const cat = a.category.localeCompare(b.category);
  if (cat !== 0) return cat;
  const yr = b.year.localeCompare(a.year); // desc
  if (yr !== 0) return yr;
  return a.itemName.localeCompare(b.itemName);
}

function formatRow(row: MasterRow): string {
  const id = itemId(row);
  const brandPart = row.brand ? `${row.brand} ` : '';
  const colorSize = formatColorSize(row.color, row.size);
  const cat = row.subCategory ? `${row.category}/${row.subCategory}` : row.category;
  const price = formatPrice(row.price);
  return `[${id}] | ${row.year} | ${brandPart}${row.itemName}${colorSize} | $${price} [${cat}]`;
}

function formatColorSize(color: string, size: string): string {
  if (!color && !size) return '';
  if (color && size) return ` (${color}, ${size})`;
  return ` (${color || size})`;
}

function formatPrice(n: number): string {
  // Drop trailing zeros for whole-dollar amounts; keep 2 decimals otherwise.
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}
```

- [ ] **Step 2.4: Run tests — expect pass**

```bash
npx vitest run tests/domains/outdoor/serialize.test.ts
```

Expected: 13 tests pass.

- [ ] **Step 2.5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2.6: Commit**

```bash
git add domains/outdoor/serialize.ts tests/domains/outdoor/serialize.test.ts
git commit -m "feat: compact outdoor inventory serializer with stable hash (Phase 2, Task 2.3 part 2/5)"
```

---

## Task 3: Inventory thin query helpers

**Files:**
- Create: `domains/outdoor/inventory.ts`
- Create: `tests/domains/outdoor/inventory.test.ts`

Used by slash commands (`/lost <item>`, etc., built in Task 2.5) and by the agent's `update_status` tool. Pure functions over a `MasterRow[]` snapshot — no Sheets calls; the cache layer (Task 4) owns IO.

- [ ] **Step 3.1: Write the failing tests**

```typescript
// tests/domains/outdoor/inventory.test.ts
import { describe, test, expect } from 'vitest';
import {
  filterToActiveOutdoor,
  getById,
  findByFuzzyName,
} from '../../../domains/outdoor/inventory.js';
import { itemId } from '../../../domains/outdoor/types.js';
import {
  FIXTURE_ALL,
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
  FIXTURE_RETIRED,
  FIXTURE_PHOTO,
} from '../../fixtures/outdoor-items.js';

describe('filterToActiveOutdoor', () => {
  test('keeps only active outdoor rows', () => {
    const out = filterToActiveOutdoor(FIXTURE_ALL);
    expect(out).toHaveLength(3);
    expect(out).toEqual(expect.arrayContaining([FIXTURE_THERMAREST, FIXTURE_SALOMON, FIXTURE_NO_BRAND]));
    expect(out).not.toContain(FIXTURE_RETIRED);
    expect(out).not.toContain(FIXTURE_PHOTO);
  });
});

describe('getById', () => {
  test('returns the row matching the id', () => {
    const id = itemId(FIXTURE_THERMAREST);
    expect(getById(FIXTURE_ALL, id)).toBe(FIXTURE_THERMAREST);
  });

  test('returns null when id has no match', () => {
    expect(getById(FIXTURE_ALL, '000000')).toBeNull();
  });
});

describe('findByFuzzyName', () => {
  test('case-insensitive substring match on itemName', () => {
    const matches = findByFuzzyName(FIXTURE_ALL, 'salomon');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe(FIXTURE_SALOMON);
  });

  test('matches against brand as well as itemName', () => {
    const matches = findByFuzzyName(FIXTURE_ALL, 'therm');
    expect(matches).toEqual([FIXTURE_THERMAREST]);
  });

  test('returns empty array when no match', () => {
    expect(findByFuzzyName(FIXTURE_ALL, 'nonexistent xyzzy')).toEqual([]);
  });

  test('only searches active outdoor rows', () => {
    const matches = findByFuzzyName(FIXTURE_ALL, 'old backpack');
    expect(matches).toEqual([]);
  });

  test('returns multiple matches when ambiguous', () => {
    const dup = { ...FIXTURE_THERMAREST, color: 'Blue', orderId: 'DUP-001' };
    const matches = findByFuzzyName([FIXTURE_THERMAREST, dup], 'sleeping');
    expect(matches).toHaveLength(2);
  });
});
```

- [ ] **Step 3.2: Run tests — expect failure**

```bash
npx vitest run tests/domains/outdoor/inventory.test.ts
```

Expected: FAIL with `Cannot find module '../../../domains/outdoor/inventory.js'`.

- [ ] **Step 3.3: Implement `domains/outdoor/inventory.ts`**

```typescript
// domains/outdoor/inventory.ts
import type { MasterRow } from '../../lib/types.js';
import { itemId } from './types.js';

export function filterToActiveOutdoor(rows: readonly MasterRow[]): MasterRow[] {
  return rows.filter((r) => r.domain === 'Outdoor' && r.status === 'active');
}

export function getById(rows: readonly MasterRow[], id: string): MasterRow | null {
  return filterToActiveOutdoor(rows).find((r) => itemId(r) === id) ?? null;
}

export function findByFuzzyName(rows: readonly MasterRow[], query: string): MasterRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return filterToActiveOutdoor(rows).filter((r) => {
    const haystack = `${r.brand} ${r.itemName}`.toLowerCase();
    return haystack.includes(q);
  });
}
```

- [ ] **Step 3.4: Run tests — expect pass**

```bash
npx vitest run tests/domains/outdoor/inventory.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add domains/outdoor/inventory.ts tests/domains/outdoor/inventory.test.ts
git commit -m "feat: outdoor inventory thin query helpers (Phase 2, Task 2.3 part 3/5)"
```

---

## Task 4: Inventory cache (snapshot + 15-min refresh + hash check)

**Files:**
- Create: `apps/bot/inventoryCache.ts`
- Create: `tests/apps/bot/inventoryCache.test.ts`

The long-lived in-memory snapshot. Tested with a fake fetcher (no real Sheets calls). Refresh timer is exposed as a manual `refresh()` for testing; production wiring (`setInterval`) lives in a separate `start()` method.

- [ ] **Step 4.1: Write the failing tests**

```typescript
// tests/apps/bot/inventoryCache.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import type { MasterRow } from '../../../lib/types.js';
import {
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
} from '../../fixtures/outdoor-items.js';

function makeFetcher(rowsByCall: MasterRow[][]): { fetch: () => Promise<MasterRow[]>; calls: number } {
  let i = 0;
  const state = {
    fetch: async (): Promise<MasterRow[]> => {
      const next = rowsByCall[Math.min(i, rowsByCall.length - 1)] ?? [];
      i += 1;
      state.calls = i;
      return next;
    },
    calls: 0,
  };
  return state;
}

describe('InventoryCache', () => {
  test('initial refresh populates snapshot and compact view', async () => {
    const fetcher = makeFetcher([[FIXTURE_THERMAREST, FIXTURE_SALOMON]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    expect(cache.getSnapshot()).toHaveLength(2);
    const view = cache.getCompactView();
    expect(view.text).toContain('Therm-a-Rest');
    expect(view.text).toContain('Salomon');
  });

  test('hash unchanged across no-op refreshes', async () => {
    const fetcher = makeFetcher([
      [FIXTURE_THERMAREST, FIXTURE_SALOMON],
      [FIXTURE_THERMAREST, FIXTURE_SALOMON],
    ]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    const hashBefore = cache.getCompactView().hash;
    await cache.refresh();
    const hashAfter = cache.getCompactView().hash;
    expect(hashAfter).toBe(hashBefore);
    expect(cache.lastRefreshChangedHash).toBe(false);
  });

  test('hash changes when row data changes', async () => {
    const variant: MasterRow = { ...FIXTURE_THERMAREST, price: 59.95 };
    const fetcher = makeFetcher([[FIXTURE_THERMAREST], [variant]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    const hashBefore = cache.getCompactView().hash;
    await cache.refresh();
    expect(cache.getCompactView().hash).not.toBe(hashBefore);
    expect(cache.lastRefreshChangedHash).toBe(true);
  });

  test('compact view is memoized when hash unchanged', async () => {
    const fetcher = makeFetcher([[FIXTURE_THERMAREST]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    const view1 = cache.getCompactView();
    const view2 = cache.getCompactView();
    expect(view1).toBe(view2); // referential equality — same object
  });

  test('applyLocalChange updates snapshot and invalidates hash', async () => {
    const fetcher = makeFetcher([[FIXTURE_THERMAREST]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    const hashBefore = cache.getCompactView().hash;
    cache.applyLocalChange(FIXTURE_SALOMON);
    expect(cache.getSnapshot()).toContainEqual(FIXTURE_SALOMON);
    expect(cache.getCompactView().hash).not.toBe(hashBefore);
  });

  test('applyLocalChange replaces an existing row with the same itemId', async () => {
    const updated: MasterRow = { ...FIXTURE_THERMAREST, status: 'retired' };
    const fetcher = makeFetcher([[FIXTURE_THERMAREST]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    cache.applyLocalChange(updated);
    expect(cache.getSnapshot()).toHaveLength(1);
    // 'retired' filtered out of compact view
    expect(cache.getCompactView().text).not.toContain('Therm-a-Rest');
  });

  test('forceRefresh re-runs the fetcher', async () => {
    const fetcher = makeFetcher([[FIXTURE_THERMAREST]]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    expect(fetcher.calls).toBe(1);
    await cache.forceRefresh();
    expect(fetcher.calls).toBe(2);
  });

  test('refresh failure preserves the previous snapshot', async () => {
    const fetcher = {
      calls: 0,
      fetch: vi.fn(),
    };
    fetcher.fetch.mockResolvedValueOnce([FIXTURE_THERMAREST]);
    fetcher.fetch.mockRejectedValueOnce(new Error('Sheets API down'));

    const cache = new InventoryCache(fetcher.fetch);
    await cache.refresh();
    expect(cache.getSnapshot()).toHaveLength(1);

    await expect(cache.refresh()).rejects.toThrow('Sheets API down');
    expect(cache.getSnapshot()).toHaveLength(1); // preserved
  });

  test('start() schedules periodic refresh and stop() cancels it', async () => {
    vi.useFakeTimers();
    const fetcher = makeFetcher([
      [FIXTURE_THERMAREST],
      [FIXTURE_THERMAREST],
      [FIXTURE_THERMAREST, FIXTURE_NO_BRAND],
    ]);
    const cache = new InventoryCache(fetcher.fetch);
    await cache.start({ refreshIntervalMs: 1000 });
    expect(fetcher.calls).toBe(1); // initial

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.calls).toBe(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.calls).toBe(3);

    cache.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetcher.calls).toBe(3); // no further calls after stop
    vi.useRealTimers();
  });
});
```

- [ ] **Step 4.2: Run tests — expect failure**

```bash
npx vitest run tests/apps/bot/inventoryCache.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 4.3: Implement `apps/bot/inventoryCache.ts`**

```typescript
// apps/bot/inventoryCache.ts
import type { MasterRow } from '../../lib/types.js';
import { serializeCompact, type CompactView } from '../../domains/outdoor/serialize.js';
import { itemId } from '../../domains/outdoor/types.js';

export type Fetcher = () => Promise<MasterRow[]>;

export interface StartOptions {
  refreshIntervalMs: number;
}

export class InventoryCache {
  private snapshot: MasterRow[] = [];
  private cachedView: CompactView | null = null;
  private timer: NodeJS.Timeout | null = null;
  public lastRefreshChangedHash = false;
  public lastRefreshedAt: Date | null = null;

  constructor(private readonly fetcher: Fetcher) {}

  async start(opts: StartOptions): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((err) => {
        console.error('[inventoryCache] refresh failed:', err);
      });
    }, opts.refreshIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refresh(): Promise<void> {
    const next = await this.fetcher(); // throw on failure; caller decides
    const candidate = serializeCompact(next);
    const prevHash = this.cachedView?.hash ?? null;
    this.snapshot = next;
    if (prevHash === candidate.hash) {
      this.lastRefreshChangedHash = false;
    } else {
      this.cachedView = candidate;
      this.lastRefreshChangedHash = true;
    }
    this.lastRefreshedAt = new Date();
  }

  async forceRefresh(): Promise<void> {
    return this.refresh();
  }

  getSnapshot(): readonly MasterRow[] {
    return this.snapshot;
  }

  getCompactView(): CompactView {
    if (!this.cachedView) {
      this.cachedView = serializeCompact(this.snapshot);
    }
    return this.cachedView;
  }

  applyLocalChange(updated: MasterRow): void {
    const id = itemId(updated);
    const next = [...this.snapshot];
    const existingIdx = next.findIndex((r) => itemId(r) === id);
    if (existingIdx >= 0) {
      next[existingIdx] = updated;
    } else {
      next.push(updated);
    }
    this.snapshot = next;
    this.cachedView = serializeCompact(next);
    this.lastRefreshChangedHash = true;
  }
}
```

- [ ] **Step 4.4: Run tests — expect pass**

```bash
npx vitest run tests/apps/bot/inventoryCache.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/bot/inventoryCache.ts tests/apps/bot/inventoryCache.test.ts
git commit -m "feat: inventoryCache with hash-stable refresh + applyLocalChange (Phase 2, Task 2.3 part 4/5)"
```

---

## Task 5: Stats counters + `/stats` formatter

**Files:**
- Create: `apps/bot/stats.ts`
- Create: `tests/apps/bot/stats.test.ts`

Counts queries / cache hits / refreshes; estimates monthly cost; renders the `/stats` Telegram message and the threshold checklist. Pure data + a formatter — no Telegram wiring (that lives in Task 2.5).

- [ ] **Step 5.1: Write the failing tests**

```typescript
// tests/apps/bot/stats.test.ts
import { describe, test, expect, beforeEach } from 'vitest';
import { Stats, formatStats, evaluateThresholds, estimateMonthlyCost } from '../../../apps/bot/stats.js';

describe('Stats counter', () => {
  test('records per-query metrics', () => {
    const s = new Stats();
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 1500, totalResponseMs: 2200 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 4500, totalResponseMs: 5800 });
    expect(s.totalQueries).toBe(2);
    expect(s.cacheHits).toBe(1);
    expect(s.coldWrites).toBe(1);
  });

  test('records refreshes and tracks last refresh', () => {
    const s = new Stats();
    s.recordRefresh({ rowCount: 412, durationMs: 240, hashChanged: false });
    s.recordRefresh({ rowCount: 414, durationMs: 260, hashChanged: true });
    expect(s.totalRefreshes).toBe(2);
    expect(s.refreshesWithChange).toBe(1);
    expect(s.lastRowCount).toBe(414);
  });
});

describe('Stats.coldFirstTokenP50Ms', () => {
  test('only samples cold-cache queries, ignoring warm-cache ones', () => {
    const s = new Stats();
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 100, totalResponseMs: 500 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 4000, totalResponseMs: 5000 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 200, totalResponseMs: 700 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 5000, totalResponseMs: 6500 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 6000, totalResponseMs: 7800 });
    // Cold samples: [4000, 5000, 6000] → sorted → median = 5000
    expect(s.coldFirstTokenP50Ms()).toBe(5000);
  });

  test('returns 0 when no cold queries recorded', () => {
    const s = new Stats();
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 100, totalResponseMs: 500 });
    expect(s.coldFirstTokenP50Ms()).toBe(0);
  });
});

describe('estimateMonthlyCost', () => {
  test('extrapolates 7-day cold/warm counts to 30 days', () => {
    // 28 cold writes + 142 warm reads in 7 days at 12K tokens
    const cost = estimateMonthlyCost({
      coldWrites7d: 28,
      warmReads7d: 142,
      avgSystemPromptTokens: 12000,
    });
    // (28/7)*30 = 120 cold writes -> 120 * 12000 * $3.75/MTok = $5.40
    // (142/7)*30 ≈ 608 warm reads -> 608 * 12000 * $0.30/MTok ≈ $2.19
    // total ≈ $7.59
    expect(cost).toBeGreaterThan(7);
    expect(cost).toBeLessThan(9);
  });

  test('returns 0 for no activity', () => {
    expect(estimateMonthlyCost({ coldWrites7d: 0, warmReads7d: 0, avgSystemPromptTokens: 0 })).toBe(0);
  });
});

describe('evaluateThresholds', () => {
  test('returns 0/4 hit at small inventory', () => {
    const r = evaluateThresholds({
      activeOutdoorRows: 400,
      monthlyCostUsd: 5,
      coldFirstTokenP50Ms: 4500,
      freeContextTokens: 188000,
    });
    expect(r.hitCount).toBe(0);
    expect(r.flips).toBe(false);
  });

  test('triggers flip when 2+ thresholds hit', () => {
    const r = evaluateThresholds({
      activeOutdoorRows: 2500, // hit
      monthlyCostUsd: 35,      // hit
      coldFirstTokenP50Ms: 4500,
      freeContextTokens: 188000,
    });
    expect(r.hitCount).toBe(2);
    expect(r.flips).toBe(true);
  });

  test('lists which thresholds hit', () => {
    const r = evaluateThresholds({
      activeOutdoorRows: 2500,
      monthlyCostUsd: 5,
      coldFirstTokenP50Ms: 9000, // hit
      freeContextTokens: 188000,
    });
    expect(r.hits).toEqual(['inventory_size', 'cold_latency']);
  });
});

describe('formatStats', () => {
  test('renders a human-readable summary', () => {
    const s = new Stats();
    s.recordRefresh({ rowCount: 412, durationMs: 240, hashChanged: false });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 1500, totalResponseMs: 2200 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 4500, totalResponseMs: 5800 });

    const out = formatStats(s, { activeOutdoorRows: 287, freeContextTokens: 188000 });

    expect(out).toContain('Inventory: 412 rows (Outdoor active: 287)');
    expect(out).toContain('Last refresh:');
    expect(out).toContain('Last 7d:');
    expect(out).toContain('Threshold status: 0/4 hit');
  });
});
```

- [ ] **Step 5.2: Run tests — expect failure**

```bash
npx vitest run tests/apps/bot/stats.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 5.3: Implement `apps/bot/stats.ts`**

```typescript
// apps/bot/stats.ts

export interface QueryMetrics {
  systemPromptTokens: number;
  cacheHit: boolean;
  firstTokenMs: number;
  totalResponseMs: number;
}

export interface RefreshMetrics {
  rowCount: number;
  durationMs: number;
  hashChanged: boolean;
}

export class Stats {
  totalQueries = 0;
  cacheHits = 0;
  coldWrites = 0;
  totalRefreshes = 0;
  refreshesWithChange = 0;
  lastRowCount = 0;
  lastRefreshAt: Date | null = null;
  private coldFirstTokenMsSamples: number[] = [];
  private systemPromptTokensSamples: number[] = [];
  private queryTimestamps: Date[] = []; // for 7-day rolling
  private coldWriteTimestamps: Date[] = [];
  private warmReadTimestamps: Date[] = [];

  recordQuery(m: QueryMetrics): void {
    this.totalQueries += 1;
    if (m.cacheHit) {
      this.cacheHits += 1;
      this.warmReadTimestamps.push(new Date());
    } else {
      this.coldWrites += 1;
      this.coldWriteTimestamps.push(new Date());
      this.coldFirstTokenMsSamples.push(m.firstTokenMs);
    }
    this.systemPromptTokensSamples.push(m.systemPromptTokens);
    this.queryTimestamps.push(new Date());
    this.prune();
  }

  recordRefresh(m: RefreshMetrics): void {
    this.totalRefreshes += 1;
    if (m.hashChanged) this.refreshesWithChange += 1;
    this.lastRowCount = m.rowCount;
    this.lastRefreshAt = new Date();
  }

  coldWrites7d(): number {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.coldWriteTimestamps.filter((d) => d.getTime() >= cutoff).length;
  }

  warmReads7d(): number {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.warmReadTimestamps.filter((d) => d.getTime() >= cutoff).length;
  }

  avgSystemPromptTokens(): number {
    const arr = this.systemPromptTokensSamples;
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }

  coldFirstTokenP50Ms(): number {
    if (this.coldFirstTokenMsSamples.length === 0) return 0;
    const sorted = [...this.coldFirstTokenMsSamples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }

  private prune(): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.queryTimestamps = this.queryTimestamps.filter((d) => d.getTime() >= cutoff);
    this.coldWriteTimestamps = this.coldWriteTimestamps.filter((d) => d.getTime() >= cutoff);
    this.warmReadTimestamps = this.warmReadTimestamps.filter((d) => d.getTime() >= cutoff);
    // Cap raw sample arrays so memory doesn't grow unbounded.
    const cap = 1000;
    if (this.coldFirstTokenMsSamples.length > cap) this.coldFirstTokenMsSamples = this.coldFirstTokenMsSamples.slice(-cap);
    if (this.systemPromptTokensSamples.length > cap) this.systemPromptTokensSamples = this.systemPromptTokensSamples.slice(-cap);
  }
}

// Anthropic Sonnet 4.6 prompt-cache pricing per million tokens.
const PRICE_CACHE_WRITE_5MIN_USD_PER_MTOK = 3.75;
const PRICE_CACHE_READ_USD_PER_MTOK = 0.30;

export function estimateMonthlyCost(input: {
  coldWrites7d: number;
  warmReads7d: number;
  avgSystemPromptTokens: number;
}): number {
  const monthlyCold = (input.coldWrites7d / 7) * 30;
  const monthlyWarm = (input.warmReads7d / 7) * 30;
  const tokensM = input.avgSystemPromptTokens / 1_000_000;
  const coldCost = monthlyCold * tokensM * PRICE_CACHE_WRITE_5MIN_USD_PER_MTOK;
  const warmCost = monthlyWarm * tokensM * PRICE_CACHE_READ_USD_PER_MTOK;
  return Math.round((coldCost + warmCost) * 100) / 100;
}

export interface ThresholdInput {
  activeOutdoorRows: number;
  monthlyCostUsd: number;
  coldFirstTokenP50Ms: number;
  freeContextTokens: number;
}

export interface ThresholdResult {
  hits: string[];
  hitCount: number;
  flips: boolean;
}

export function evaluateThresholds(input: ThresholdInput): ThresholdResult {
  const hits: string[] = [];
  if (input.activeOutdoorRows >= 2000) hits.push('inventory_size');
  if (input.monthlyCostUsd > 30) hits.push('monthly_cost');
  if (input.coldFirstTokenP50Ms > 8000) hits.push('cold_latency');
  if (input.freeContextTokens < 40000) hits.push('context_budget');
  return { hits, hitCount: hits.length, flips: hits.length >= 2 };
}

export function formatStats(
  s: Stats,
  ctx: { activeOutdoorRows: number; freeContextTokens: number },
): string {
  const cost = estimateMonthlyCost({
    coldWrites7d: s.coldWrites7d(),
    warmReads7d: s.warmReads7d(),
    avgSystemPromptTokens: s.avgSystemPromptTokens(),
  });
  const thresh = evaluateThresholds({
    activeOutdoorRows: ctx.activeOutdoorRows,
    monthlyCostUsd: cost,
    coldFirstTokenP50Ms: s.coldFirstTokenP50Ms(),
    freeContextTokens: ctx.freeContextTokens,
  });
  const lastRefresh = s.lastRefreshAt
    ? `${ageMinutes(s.lastRefreshAt)} min ago`
    : 'never';
  const tokenStr = (s.avgSystemPromptTokens() / 1000).toFixed(1) + 'K';

  return [
    `Inventory: ${s.lastRowCount} rows (Outdoor active: ${ctx.activeOutdoorRows})`,
    `System prompt: ${tokenStr} tokens (avg)`,
    `Last refresh: ${lastRefresh}`,
    `Last 7d: ${s.coldWrites7d()} cold writes, ${s.warmReads7d()} warm reads`,
    `Est monthly cost: $${cost.toFixed(2)}`,
    `Threshold status: ${thresh.hitCount}/4 hit${thresh.hits.length ? ` (${thresh.hits.join(', ')})` : ''}`,
  ].join('\n');
}

function ageMinutes(d: Date): number {
  return Math.round((Date.now() - d.getTime()) / 60000);
}
```

- [ ] **Step 5.4: Run tests — expect pass**

```bash
npx vitest run tests/apps/bot/stats.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5.5: Run full test suite + typecheck before final commit**

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean; all tests pass (existing + new).

- [ ] **Step 5.6: Commit**

```bash
git add apps/bot/stats.ts tests/apps/bot/stats.test.ts
git commit -m "feat: stats counters + threshold evaluator + /stats formatter (Phase 2, Task 2.3 part 5/5)"
```

---

## Task 6: End-to-end smoke against the real sheet

**Files:**
- Create: `scripts/smoke-cache.ts`

A one-shot script (kept in the repo, not run automatically) that wires `lib/sheets.ts` → `InventoryCache` → `serializeCompact` against the real Google Sheet. Sanity-checks token counts, row counts, hash stability, and prints the would-be `/stats` output. Run manually by Tom after the soak passes, before Task 2.4 (agent) starts.

- [ ] **Step 6.1: Implement `scripts/smoke-cache.ts`**

```typescript
// scripts/smoke-cache.ts
import 'dotenv/config';
import { createSheetsClient, readMasterRows } from '../lib/sheets.js';
import { InventoryCache } from '../apps/bot/inventoryCache.js';
import { Stats, formatStats } from '../apps/bot/stats.js';
import { filterToActiveOutdoor } from '../domains/outdoor/inventory.js';

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId) {
    console.error('Missing GOOGLE_* env vars in .env');
    process.exit(1);
  }

  const sheets = createSheetsClient({ clientId, clientSecret, refreshToken });
  const fetcher = () => readMasterRows(sheets, spreadsheetId);

  const cache = new InventoryCache(fetcher);
  const stats = new Stats();

  const t0 = Date.now();
  await cache.refresh();
  const t1 = Date.now();
  stats.recordRefresh({
    rowCount: cache.getSnapshot().length,
    durationMs: t1 - t0,
    hashChanged: cache.lastRefreshChangedHash,
  });

  const view = cache.getCompactView();
  const activeOutdoor = filterToActiveOutdoor(cache.getSnapshot());

  // Rough char-to-token estimate: 1 token ≈ 4 chars.
  const approxTokens = Math.ceil(view.text.length / 4);

  console.log(`\n=== Smoke results ===`);
  console.log(`Total rows in sheet: ${cache.getSnapshot().length}`);
  console.log(`Active outdoor rows: ${activeOutdoor.length}`);
  console.log(`Compact view length: ${view.text.length} chars (~${approxTokens} tokens)`);
  console.log(`Hash: ${view.hash}`);
  console.log(`Refresh duration: ${t1 - t0}ms`);

  // Verify hash stability with a no-op refresh.
  await cache.refresh();
  console.log(`\n2nd refresh hashChanged: ${cache.lastRefreshChangedHash} (expected: false)`);

  console.log(`\n=== Sample rendered rows (first 3) ===`);
  console.log(view.text.split('\n').slice(0, 8).join('\n'));

  console.log(`\n=== /stats output (with synthetic query data) ===`);
  stats.recordQuery({ systemPromptTokens: approxTokens, cacheHit: false, firstTokenMs: 4200, totalResponseMs: 5500 });
  stats.recordQuery({ systemPromptTokens: approxTokens, cacheHit: true, firstTokenMs: 1300, totalResponseMs: 1900 });
  console.log(formatStats(stats, {
    activeOutdoorRows: activeOutdoor.length,
    freeContextTokens: 200_000 - approxTokens,
  }));
}

main().catch((err: unknown) => {
  console.error('Smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 6.2: Add npm script in `package.json`**

Modify the `"scripts"` block in `package.json` to add (insert after the existing `"cron:dry"` line):

```json
    "smoke-cache": "tsx scripts/smoke-cache.ts",
```

- [ ] **Step 6.3: Run the smoke script**

```bash
npm run smoke-cache
```

Expected output (sample numbers will differ):
```
=== Smoke results ===
Total rows in sheet: 412
Active outdoor rows: 287
Compact view length: ~9800 chars (~2450 tokens)
Hash: 3a7f9b...
Refresh duration: 540ms

2nd refresh hashChanged: false (expected: false)

=== Sample rendered rows (first 3) ===
=== ACTIVE OUTDOOR INVENTORY ===
Format: [id] | Year | [Brand] Item (Color, Size) | $price [Category/Sub-Category]
...
```

If `2nd refresh hashChanged` is `true` on a clean sheet, the hash function or sort order has a determinism bug — debug before proceeding.

- [ ] **Step 6.4: Commit**

```bash
git add scripts/smoke-cache.ts package.json
git commit -m "feat: smoke-cache script for end-to-end inventory layer verification (Phase 2, Task 2.3)"
```

---

## Final verification

- [ ] **Step F.1: Run full test suite + typecheck + lint**

```bash
npm run typecheck && npx vitest run && npm run lint
```

Expected: all green.

- [ ] **Step F.2: Verify acceptance criteria from spec § Acceptance**

Manually confirm each:
1. ✅ `npm run smoke-cache` completes in < 2s for current size (build compact serialization step)
2. ⏸ `/stats` Telegram command — wired in Task 2.5 (out of scope here; `formatStats()` unit-tested instead)
3. ⏸ Agent answers A/B/C/D queries — Task 2.4 + 2.6 acceptance test (out of scope here)
4. ✅ Refresh timer fires, hash check identifies no-op vs. real change (covered by `inventoryCache.test.ts` + smoke script)
5. ⏸ `/refresh` Telegram command — wired in Task 2.5; `forceRefresh()` unit-tested
6. ✅ Sheets API outage → bot serves from stale snapshot (covered by `inventoryCache.test.ts:refresh failure preserves the previous snapshot`)
7. ⏸ Cold-cache and warm-cache costs match estimates within 2x — measurable only after Task 2.4 wires Anthropic SDK + bot is running

Items marked ⏸ are explicitly deferred to downstream tasks and are noted here for traceability.

---

## Self-review notes (writer's checklist)

**Spec coverage:** Each spec section maps to a task —
- Components diagram → Task 1, 2, 3, 4, 5 file paths
- Data flow (refresh) → Task 4 implementation + tests
- Compact serialization rules → Task 2 implementation + tests (header copy, row format, brand/color/size handling, sort order)
- Caching layers (in-process + memoization + content hash) → Task 4
- Cost / latency profile → Task 5 `estimateMonthlyCost`
- Instrumentation per spec § Instrumentation → Task 5 (`Stats` class + `formatStats` covers all listed fields)
- Soft threshold checklist → Task 5 `evaluateThresholds`
- Acceptance criteria → Task 6 (smoke) + Final verification step

**Type consistency:** `MasterRow`, `OutdoorItem`, `CompactView`, `Fetcher`, `Stats`, `ThresholdInput`, `ThresholdResult` are all defined in exactly one place and referenced by the same name everywhere. The `itemId()` signature matches between `types.ts`, `serialize.ts`, `inventory.ts`, and `inventoryCache.ts`.

**Placeholder scan:** No "TBD" / "implement later" — every step has either real code or a real command.

**Decisions deferred to Task 2.4 (agent) and Task 2.5 (slash commands):**
- How `applyStatusChange` writes to the sheet (Task 2.5 — it's the slash-command handler that does the Sheets append, then calls `cache.applyLocalChange`)
- Anthropic SDK wiring + `cache_control` placement (Task 2.4)
- Conversation lifetime / 30-min idle reset logic (Task 2.4)
- Telegram message handler for `/stats` and `/refresh` (Task 2.5 — calls `formatStats(stats, ctx)` and `cache.forceRefresh()` respectively)
