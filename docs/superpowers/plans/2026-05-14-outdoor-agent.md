# Outdoor Agent (Task 2.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the outdoor-agent module — a Claude Sonnet 4.6 chat agent that reads Tom's active outdoor inventory from the system prompt (via `InventoryCache`, built in Task 2.3), uses two tools (`get_product_url`, `update_status`), maintains a 30-minute conversation window per chat, and emits cost/latency metrics into the existing `Stats` class.

**Architecture:** Single `OutdoorAgent` class in `domains/outdoor/agent.ts` owns the tool-call loop. The system prompt is a static intro + the compact inventory text (with `cache_control: ephemeral`) + a REI-preference line + tool-use instructions. Tools are pure functions in `domains/outdoor/tools.ts` closing over the cache + sheets client. Conversation state lives in `lib/conversations.ts` as an in-memory map keyed by chat ID with a 30-min idle TTL. No Telegram wiring here — that's Task 2.1/2.2/2.5. A CLI smoke script (`scripts/smoke-agent.ts`) lets us exercise the agent end-to-end without the bot listener.

**Tech Stack:** TypeScript (strict), Node 20, vitest, `@anthropic-ai/sdk` (already installed; used by `lib/classifier.ts` with the same `cache_control` pattern), googleapis (existing `lib/sheets.ts`).

**Spec / decisions referenced:**
- `docs/PLAN.md` § Phase 2 Task 2.4
- `DECISIONS.md` 2026-05-14 entry (REI preference encoded in agent prompt)
- `docs/superpowers/specs/2026-05-02-outdoor-agent-inventory-retrieval-design.md` (cost / latency framing, 30-min idle reset)

**Out of scope (deferred to other tasks):**
- Telegram bot listener (Task 2.1)
- Bot router (Task 2.2)
- Slash commands `/log`, `/lost`, `/sold`, etc. (Task 2.5) — those commands share `update_status` handler logic with this task; we'll build the shared logic here and Task 2.5 calls it.
- The acceptance test (Task 2.6)
- Streaming responses (nice-to-have for Telegram typing indicator; non-streaming is fine for v1)

---

## File map

**New files:**
- `domains/outdoor/agent.ts` — `OutdoorAgent` class + `buildSystemPrompt()`
- `domains/outdoor/tools.ts` — tool definitions + `createTools(deps)` factory returning handlers
- `lib/conversations.ts` — `ConversationStore` with 30-min idle TTL
- `scripts/smoke-agent.ts` — CLI to test the agent end-to-end against real API + sheet

**Modified files:**
- `lib/sheets.ts` — add `updateRowStatus()` helper
- `domains/outdoor/types.ts` — drop unused `OutdoorItem` phantom alias (final-review item #1)
- `package.json` — add `"smoke-agent": "tsx scripts/smoke-agent.ts"` script

**New test files:**
- `tests/domains/outdoor/tools.test.ts`
- `tests/domains/outdoor/agent.test.ts`
- `tests/lib/conversations.test.ts`
- `tests/sheets.test.ts` — extend existing file with `updateRowStatus` tests

---

## Task 1: Drop unused `OutdoorItem` phantom alias

The phantom-typed `OutdoorItem` alias exported from `domains/outdoor/types.ts` is currently unused everywhere in the codebase. Final-reviewer flagged it as scaffolding-without-use. We decide to remove it now; if a future task needs branded outdoor rows, the brand can be reintroduced with actual consumers.

**Files:**
- Modify: `domains/outdoor/types.ts`
- Modify: `tests/domains/outdoor/types.test.ts` — remove the import + drop nothing else (the test file already types its `variant` declarations as `MasterRow`, so no test logic changes)

- [ ] **Step 1.1: Edit `domains/outdoor/types.ts` — remove the `OutdoorItem` export**

The file currently looks like:
```typescript
import { createHash } from 'node:crypto';
import type { MasterRow } from '../../lib/types.js';

export type OutdoorItem = MasterRow & { readonly __outdoor: unique symbol };

export function itemId(row: Pick<MasterRow, 'year' | 'brand' | 'itemName' | 'color' | 'size' | 'orderId'>): string {
  // ...
}
```

Remove only the `OutdoorItem` type alias and the JSDoc above it (if any). Keep `itemId()` untouched.

- [ ] **Step 1.2: Verify no other file imports `OutdoorItem`**

```bash
grep -rn "OutdoorItem" --include="*.ts" .
```
Expected: zero hits.

- [ ] **Step 1.3: Run typecheck + tests**

```bash
npm run typecheck && npx vitest run
```
Expected: clean. All existing tests still pass (the type alias was used only as a type annotation in the test file, and that was already changed to `MasterRow` during Task 2.3.1's fix-up).

- [ ] **Step 1.4: Commit**

```bash
git add domains/outdoor/types.ts
git commit -m "refactor: drop unused OutdoorItem phantom alias (Phase 2, Task 2.4 part 1/7)"
```

---

## Task 2: Sheet row-status update helper

The `update_status` tool (Task 3) and Task 2.5 slash commands both need to flip a row's Status column to a new value. Add a small idempotent helper in `lib/sheets.ts`.

**Files:**
- Modify: `lib/sheets.ts` — add `updateRowStatus()` near `appendRows()`
- Modify: `tests/sheets.test.ts` — add tests

The sheet schema has column `M` = `Status` (canonical). Code reads/writes by **header name** via `buildHeaderMap` — do the same here for column-order resilience.

- [ ] **Step 2.1: Open `lib/sheets.ts` and read the existing patterns**

```bash
sed -n '1,50p' lib/sheets.ts
sed -n '100,170p' lib/sheets.ts
```

Confirm the shape of `buildHeaderMap`, `readMasterRows`, and `appendRows`. Match their conventions.

- [ ] **Step 2.2: Add failing tests in `tests/sheets.test.ts`**

Append (do not replace) the existing test file with a new `describe` block:

```typescript
describe('updateRowStatus', () => {
  test('writes the new status to the Status column of the specified row', async () => {
    const writes: { range: string; values: string[][] }[] = [];
    const fakeSheets = makeFakeSheets({
      headerRow: ['Year', 'Brand', 'Item Name', 'Status'],
      // any rows; we don't read them here
      rows: [['2026', 'Black Diamond', 'Couloir Harness', 'active']],
      onUpdate: (range, values) => writes.push({ range, values }),
    });

    await updateRowStatus(fakeSheets as unknown as SheetsClient, 'SHEET_ID', {
      rowIndex: 2, // 1-based sheet row including header at row 1; row 2 is the first data row
      newStatus: 'lost',
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].range).toBe(`'All Purchases'!D2`); // 'Status' is col index 3 (zero-based) → col letter D
    expect(writes[0].values).toEqual([['lost']]);
  });

  test('rejects an invalid status string', async () => {
    const fakeSheets = makeFakeSheets({
      headerRow: ['Year', 'Status'],
      rows: [],
      onUpdate: () => undefined,
    });
    await expect(
      // @ts-expect-error — testing runtime rejection of bad value
      updateRowStatus(fakeSheets as unknown as SheetsClient, 'SHEET_ID', { rowIndex: 2, newStatus: 'gone-fishing' }),
    ).rejects.toThrow(/invalid status/i);
  });

  test('throws when Status column is missing from the header row', async () => {
    const fakeSheets = makeFakeSheets({
      headerRow: ['Year', 'Brand', 'Item Name'], // no Status
      rows: [],
      onUpdate: () => undefined,
    });
    await expect(
      updateRowStatus(fakeSheets as unknown as SheetsClient, 'SHEET_ID', { rowIndex: 2, newStatus: 'lost' }),
    ).rejects.toThrow(/Status column/i);
  });
});
```

Reuse the test file's existing `makeFakeSheets` helper. If it doesn't already support `onUpdate`, extend it minimally:
- Look at the existing fake — it likely supports `onAppend`. Add `onUpdate: (range: string, values: string[][]) => void` and have the fake intercept `spreadsheets.values.update` calls the same way it intercepts append.

- [ ] **Step 2.3: Run tests — expect failure**

```bash
npx vitest run tests/sheets.test.ts -t updateRowStatus
```

Expected: FAIL with `Cannot find function 'updateRowStatus'` (or import error).

- [ ] **Step 2.4: Implement `updateRowStatus` in `lib/sheets.ts`**

Add near the existing exports (suggested location: right after `appendRows`):

```typescript
import type { ItemStatus } from './types.js';

const VALID_STATUSES: readonly ItemStatus[] = [
  'active',
  'retired',
  'returned',
  'lost',
  'broken',
  'sold',
  'donated',
  'excluded',
];

export interface UpdateStatusInput {
  rowIndex: number;
  newStatus: ItemStatus;
}

export async function updateRowStatus(
  sheets: SheetsClient,
  spreadsheetId: string,
  input: UpdateStatusInput,
): Promise<void> {
  if (!VALID_STATUSES.includes(input.newStatus)) {
    throw new Error(`Invalid status: ${input.newStatus}. Expected one of ${VALID_STATUSES.join(', ')}.`);
  }
  const headerResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'All Purchases'!1:1`,
  });
  const headerRow = (headerResp.data.values?.[0] ?? []) as (string | null | undefined)[];
  const map = buildHeaderMap(headerRow);
  const statusCol = map.get('Status');
  if (statusCol === undefined) {
    throw new Error(`Status column not found in 'All Purchases' header row`);
  }
  const range = `'All Purchases'!${colLetter(statusCol)}${input.rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [[input.newStatus]] },
  });
}
```

Adjust the import line — if `ItemStatus` isn't yet exported from `lib/types.js`, check the existing exports first. If `ItemStatus` is exported as a union literal type, use it directly; if not, find the equivalent type (it may be called `Status` or be inlined in `MasterRow.status`). Use the existing name; do not rename or duplicate the type.

- [ ] **Step 2.5: Run tests — expect pass**

```bash
npx vitest run tests/sheets.test.ts && npm run typecheck
```

Expected: all tests pass (existing + 3 new). Typecheck clean.

- [ ] **Step 2.6: Commit**

```bash
git add lib/sheets.ts tests/sheets.test.ts
git commit -m "feat: lib/sheets.updateRowStatus helper (Phase 2, Task 2.4 part 2/7)"
```

---

## Task 3: Conversation store with 30-min idle TTL

A small per-chat-ID conversation buffer. Stores the message history Anthropic needs; expires entries after 30 min of inactivity so the next user message starts a fresh conversation (and a fresh cache window).

**Files:**
- Create: `lib/conversations.ts`
- Create: `tests/lib/conversations.test.ts`

- [ ] **Step 3.1: Write the failing tests**

Create `tests/lib/conversations.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationStore, type ChatMessage } from '../../lib/conversations.js';

describe('ConversationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns empty history for a brand-new chat', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    expect(store.get('chat-1')).toEqual([]);
  });

  test('appends and returns user + assistant messages in order', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-1', { role: 'user', content: 'hi' });
    store.append('chat-1', { role: 'assistant', content: 'hello!' });
    const msgs = store.get('chat-1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hi' });
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: 'hello!' });
  });

  test('isolates conversations by chat id', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-A', { role: 'user', content: 'A message' });
    store.append('chat-B', { role: 'user', content: 'B message' });
    expect(store.get('chat-A')).toHaveLength(1);
    expect(store.get('chat-B')).toHaveLength(1);
    expect(store.get('chat-A')[0]).toMatchObject({ content: 'A message' });
  });

  test('expires a conversation after the idle TTL', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-1', { role: 'user', content: 'before idle' });

    vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes

    expect(store.get('chat-1')).toEqual([]); // expired → fresh
    store.append('chat-1', { role: 'user', content: 'after idle' });
    expect(store.get('chat-1')).toHaveLength(1); // only the new message
  });

  test('refreshes the TTL on each append', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-1', { role: 'user', content: 'msg-1' });

    vi.advanceTimersByTime(20 * 60 * 1000); // 20 min
    store.append('chat-1', { role: 'assistant', content: 'reply' });
    vi.advanceTimersByTime(20 * 60 * 1000); // 20 more min (40 total, but only 20 since last append)

    // Still alive: should have both messages
    expect(store.get('chat-1')).toHaveLength(2);
  });

  test('clear(id) drops just that conversation', () => {
    const store = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
    store.append('chat-1', { role: 'user', content: 'a' });
    store.append('chat-2', { role: 'user', content: 'b' });
    store.clear('chat-1');
    expect(store.get('chat-1')).toEqual([]);
    expect(store.get('chat-2')).toHaveLength(1);
  });
});
```

- [ ] **Step 3.2: Run tests — expect failure**

```bash
npx vitest run tests/lib/conversations.test.ts
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3.3: Implement `lib/conversations.ts`**

```typescript
export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface Entry {
  messages: ChatMessage[];
  lastActivity: number;
}

export interface ConversationStoreOptions {
  idleTtlMs: number;
}

export class ConversationStore {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly opts: ConversationStoreOptions) {}

  get(chatId: string): ChatMessage[] {
    const entry = this.store.get(chatId);
    if (!entry) return [];
    if (this.isExpired(entry)) {
      this.store.delete(chatId);
      return [];
    }
    return entry.messages;
  }

  append(chatId: string, msg: ChatMessage): void {
    const existing = this.store.get(chatId);
    if (existing && !this.isExpired(existing)) {
      existing.messages.push(msg);
      existing.lastActivity = Date.now();
    } else {
      this.store.set(chatId, { messages: [msg], lastActivity: Date.now() });
    }
  }

  clear(chatId: string): void {
    this.store.delete(chatId);
  }

  private isExpired(entry: Entry): boolean {
    return Date.now() - entry.lastActivity > this.opts.idleTtlMs;
  }
}
```

- [ ] **Step 3.4: Run tests — expect pass**

```bash
npx vitest run tests/lib/conversations.test.ts && npm run typecheck
```

Expected: 6 tests pass, typecheck clean.

- [ ] **Step 3.5: Commit**

```bash
git add lib/conversations.ts tests/lib/conversations.test.ts
git commit -m "feat: ConversationStore with 30-min idle TTL (Phase 2, Task 2.4 part 3/7)"
```

---

## Task 4: Tool definitions + handlers

Two tools the agent calls into. Pure (well, `update_status` writes) factories closing over the inventory cache and sheets client. The schemas are what we hand to the Anthropic API; the handlers run when the agent emits a `tool_use` block.

**Files:**
- Create: `domains/outdoor/tools.ts`
- Create: `tests/domains/outdoor/tools.test.ts`

The handlers need:
- The `InventoryCache` (to call `getSnapshot()` and `applyLocalChange()`)
- A `SheetsClient` + spreadsheet ID (for `updateRowStatus`)
- A `findRowIndex(snapshot, itemId)` helper — we have to know which sheet row corresponds to an itemId to call `updateRowStatus`. The simplest approach: the sheet row index = position of the row in the snapshot + 2 (1 for header, 1 for 1-based indexing). This is fragile if rows can move; the cache snapshot must be the same order as the sheet read for this to work. **Verify by reading `lib/sheets.ts:readMasterRows`** — it should preserve sheet order.

If `readMasterRows` does NOT preserve order, this task should report BLOCKED with a description of what was found; we'll either fix readMasterRows to expose row indices or change the tool design to grep by natural key.

- [ ] **Step 4.1: Read `lib/sheets.ts:readMasterRows` to confirm row-order preservation**

```bash
sed -n '100,160p' lib/sheets.ts
```

Confirm rows are returned in sheet order (no sorting, no filtering). If it filters out rows, the row-index calculation is invalid; report BLOCKED with details.

If it does preserve order: continue to Step 4.2. Note explicitly in your commit message later that this assumption is being made.

- [ ] **Step 4.2: Write failing tests**

Create `tests/domains/outdoor/tools.test.ts`:

```typescript
import { describe, test, expect, vi } from 'vitest';
import { createTools, TOOL_SCHEMAS, type ToolDeps } from '../../../domains/outdoor/tools.js';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import { itemId } from '../../../domains/outdoor/types.js';
import type { MasterRow } from '../../../lib/types.js';
import {
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
} from '../../fixtures/outdoor-items.js';

function makeDeps(rows: MasterRow[]): { deps: ToolDeps; cache: InventoryCache; updateCalls: { rowIndex: number; newStatus: string }[] } {
  const updateCalls: { rowIndex: number; newStatus: string }[] = [];
  const fakeSheets = {} as ToolDeps['sheets'];
  const fakeUpdate = vi.fn(async (_s: unknown, _id: string, input: { rowIndex: number; newStatus: string }) => {
    updateCalls.push(input);
  });
  const cache = new InventoryCache(async () => rows);
  return {
    cache,
    updateCalls,
    deps: {
      cache,
      sheets: fakeSheets,
      spreadsheetId: 'TEST_SHEET_ID',
      updateRowStatus: fakeUpdate as unknown as ToolDeps['updateRowStatus'],
    },
  };
}

describe('TOOL_SCHEMAS', () => {
  test('exports two tools: get_product_url and update_status', () => {
    const names = TOOL_SCHEMAS.map((s) => s.name);
    expect(names).toContain('get_product_url');
    expect(names).toContain('update_status');
    expect(TOOL_SCHEMAS).toHaveLength(2);
  });

  test('update_status schema constrains new_status to the valid enum', () => {
    const t = TOOL_SCHEMAS.find((s) => s.name === 'update_status')!;
    const statusProp = (t.input_schema.properties as Record<string, { enum?: string[] }>).new_status;
    expect(statusProp.enum).toEqual(
      expect.arrayContaining(['active', 'retired', 'returned', 'lost', 'broken', 'sold', 'donated', 'excluded']),
    );
  });
});

describe('get_product_url handler', () => {
  test('returns the product URL for a known item id', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_product_url({ item_id: itemId(FIXTURE_THERMAREST) });
    expect(result.ok).toBe(true);
    expect(result.product_url).toBe(FIXTURE_THERMAREST.productUrl);
  });

  test('returns ok=false when the id is unknown', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_product_url({ item_id: '000000' });
    expect(result.ok).toBe(false);
    expect(result.product_url).toBeNull();
  });
});

describe('update_status handler', () => {
  test('writes the new status to the sheet and updates the cache', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    await cache.refresh();
    const tools = createTools(deps);
    const tid = itemId(FIXTURE_THERMAREST);
    const result = await tools.update_status({ item_id: tid, new_status: 'retired' });

    expect(result.ok).toBe(true);
    expect(updateCalls).toHaveLength(1);
    // sheet row index = snapshot position + 2 (header + 1-based)
    expect(updateCalls[0].rowIndex).toBe(2);
    expect(updateCalls[0].newStatus).toBe('retired');

    // Cache reflects the change; retired rows are filtered out of the compact view
    expect(cache.getCompactView().text).not.toContain('Therm-a-Rest');
  });

  test('returns ok=false for unknown item id; does not touch the sheet', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.update_status({ item_id: 'xxxxxx', new_status: 'retired' });
    expect(result.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  test('rejects an invalid status value before touching the sheet', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.update_status({
      item_id: itemId(FIXTURE_THERMAREST),
      // @ts-expect-error — testing runtime rejection
      new_status: 'gone-fishing',
    });
    expect(result.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 4.3: Run tests — expect failure**

```bash
npx vitest run tests/domains/outdoor/tools.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 4.4: Implement `domains/outdoor/tools.ts`**

```typescript
import type { SheetsClient } from '../../lib/sheets.js';
import type { ItemStatus, MasterRow } from '../../lib/types.js';
import type { InventoryCache } from '../../apps/bot/inventoryCache.js';
import { itemId } from './types.js';

export interface ToolDeps {
  cache: InventoryCache;
  sheets: SheetsClient;
  spreadsheetId: string;
  // Injected so tests can stub it without monkey-patching the lib/sheets module.
  updateRowStatus: (
    sheets: SheetsClient,
    spreadsheetId: string,
    input: { rowIndex: number; newStatus: ItemStatus },
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
  new_status: ItemStatus;
}

export interface UpdateStatusResult {
  ok: boolean;
  message: string;
}

export interface ToolHandlers {
  get_product_url: (input: GetProductUrlInput) => Promise<GetProductUrlResult>;
  update_status: (input: UpdateStatusInput) => Promise<UpdateStatusResult>;
}

const VALID_STATUSES: readonly ItemStatus[] = [
  'active', 'retired', 'returned', 'lost', 'broken', 'sold', 'donated', 'excluded',
];

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

export function createTools(deps: ToolDeps): ToolHandlers {
  return {
    async get_product_url(input: GetProductUrlInput): Promise<GetProductUrlResult> {
      const row = findRow(deps.cache.getSnapshot(), input.item_id);
      if (!row) return { ok: false, product_url: null };
      return { ok: true, product_url: row.productUrl };
    },

    async update_status(input: UpdateStatusInput): Promise<UpdateStatusResult> {
      if (!VALID_STATUSES.includes(input.new_status)) {
        return { ok: false, message: `Invalid status: ${input.new_status}` };
      }
      const snapshot = deps.cache.getSnapshot();
      const rowPosition = findRowIndex(snapshot, input.item_id);
      if (rowPosition < 0) {
        return { ok: false, message: `Unknown item_id: ${input.item_id}` };
      }
      // Sheet row index = position + 2 (1 for header, 1 for 1-based).
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
```

- [ ] **Step 4.5: Run tests — expect pass**

```bash
npx vitest run tests/domains/outdoor/tools.test.ts && npm run typecheck
```

Expected: 7 tests pass, typecheck clean.

- [ ] **Step 4.6: Commit**

```bash
git add domains/outdoor/tools.ts tests/domains/outdoor/tools.test.ts
git commit -m "feat: outdoor agent tools (get_product_url, update_status) (Phase 2, Task 2.4 part 4/7)"
```

---

## Task 5: System prompt builder

Pure function: takes the compact view text + (optional) custom intro override → returns the system-prompt content array (in Anthropic SDK shape) with `cache_control` on the inventory block.

Why split this out: testing the prompt-text wiring without invoking the API.

**Files:**
- Create: `domains/outdoor/agent.ts` (initial — just `buildSystemPrompt`)
- Create: `tests/domains/outdoor/agent.test.ts` (initial — just system-prompt tests)

- [ ] **Step 5.1: Write failing tests**

Create `tests/domains/outdoor/agent.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { buildSystemPrompt } from '../../../domains/outdoor/agent.js';

const SAMPLE_COMPACT_VIEW = `=== ACTIVE OUTDOOR INVENTORY ===
Format: ...
Total rows: 2

[a1b2c3] | 2026 | Therm-a-Rest Z Lite Sol Sleeping Pad | $49.95 [Camping Gear/Sleep System]
[d4e5f6] | 2026 | Salomon X Ultra 5 Mid GORE-TEX Hiking Boots | $190 [Hiking Gear/Footwear]`;

describe('buildSystemPrompt', () => {
  test('includes the agent persona', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toMatch(/personal outdoor companion/i);
    expect(allText).toMatch(/hiking|backpacking|mountain biking|climbing|skiing|paddling|surfing/i);
  });

  test('includes the compact inventory text verbatim', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toContain(SAMPLE_COMPACT_VIEW);
  });

  test('includes the REI preference instruction', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toMatch(/prefer REI/i);
    expect(allText).toMatch(/co-op member/i);
  });

  test('describes when to use get_product_url and update_status', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toContain('get_product_url');
    expect(allText).toContain('update_status');
  });

  test('marks the inventory block with cache_control: ephemeral', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const cached = blocks.filter((b) => b.cache_control?.type === 'ephemeral');
    expect(cached).toHaveLength(1);
    expect(cached[0]!.text).toContain(SAMPLE_COMPACT_VIEW);
  });

  test('returns blocks in a stable, deterministic order', () => {
    const a = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const b = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 5.2: Run tests — expect failure**

```bash
npx vitest run tests/domains/outdoor/agent.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 5.3: Implement `buildSystemPrompt` in `domains/outdoor/agent.ts`**

```typescript
export interface SystemPromptInput {
  compactViewText: string;
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const PERSONA = `You are Tom's personal outdoor companion — a knowledgeable guru across hiking, backpacking, mountain biking, climbing, skiing/snowboarding, paddling, surfing, trail running, and other outdoor activities. Tom's complete active outdoor inventory is included below in compact form — read it directly to answer questions about what he owns. Items he has retired, returned, lost, sold, donated, broken, or excluded are not shown; if asked about those, say you don't have that view in this conversation.

Help him with: gear questions, trip planning, picking up new activities, training advice, where-to-go suggestions, technique pointers, and buying decisions. When he's considering a purchase, scan the inventory first to avoid recommending duplicates and to understand his existing setup.

Be concise. Ask clarifying questions before recommending — don't assume. When you don't know something specific (current prices, recent product releases, current trail or surf conditions), say so. Never invent facts.`;

const REI_PREFERENCE = `When recommending purchases, prefer REI when both retailers carry an item — Tom is a co-op member and that's his default store. Mention the dividend or return-policy advantage in close calls.`;

const TOOL_GUIDANCE = `You have two tools available:

- get_product_url(item_id) — when the user asks for a link to a specific item, or when you want to point them at a product page. The item_id is the 6-character id shown in brackets at the start of each inventory row.

- update_status(item_id, new_status) — when the user tells you they lost, sold, donated, retired, returned, or broke an item, or wants to mark it excluded. Possible new_status values: active, retired, returned, lost, broken, sold, donated, excluded. After calling this tool, confirm to the user what changed.

Use tools sparingly: only call when needed. Do not call get_product_url unprompted.`;

export function buildSystemPrompt(input: SystemPromptInput): SystemBlock[] {
  return [
    { type: 'text', text: PERSONA },
    {
      type: 'text',
      text: input.compactViewText,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: REI_PREFERENCE },
    { type: 'text', text: TOOL_GUIDANCE },
  ];
}
```

- [ ] **Step 5.4: Run tests — expect pass**

```bash
npx vitest run tests/domains/outdoor/agent.test.ts && npm run typecheck
```

Expected: 6 tests pass, typecheck clean.

- [ ] **Step 5.5: Commit**

```bash
git add domains/outdoor/agent.ts tests/domains/outdoor/agent.test.ts
git commit -m "feat: buildSystemPrompt for outdoor agent (Phase 2, Task 2.4 part 5/7)"
```

---

## Task 6: Agent orchestrator with tool-call loop

The class that ties it all together. Owns the message-API call, the tool-execution loop, conversation state, and stats recording. Tested with a mocked Anthropic client.

**Files:**
- Modify: `domains/outdoor/agent.ts` — add `OutdoorAgent` class
- Modify: `tests/domains/outdoor/agent.test.ts` — add orchestrator tests

The tool-call loop:
1. Call `messages.create` with `system`, `messages`, `tools`
2. If response contains `tool_use` blocks: execute each, append `tool_result` blocks as a user message, loop back to step 1
3. If response is all text (`end_turn`): collect text → return
4. Hard cap iterations at 8 to avoid runaway loops

Stats recording: `usage.cache_read_input_tokens > 0` = warm; else cold. `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` = the rough system+message size, take `cache_creation_input_tokens + cache_read_input_tokens` as the cacheable system-prompt token count.

Latency: time the first `messages.create` call (firstTokenMs ≈ first call's elapsed; totalResponseMs = sum of all calls in the loop).

- [ ] **Step 6.1: Write failing tests (append to `tests/domains/outdoor/agent.test.ts`)**

Add a new `describe('OutdoorAgent.handleMessage')` block at the end of the file. Reuse the imports/fixtures style from Task 4:

```typescript
import { OutdoorAgent } from '../../../domains/outdoor/agent.js';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import { ConversationStore } from '../../../lib/conversations.js';
import { Stats } from '../../../apps/bot/stats.js';
import { itemId } from '../../../domains/outdoor/types.js';
import {
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
} from '../../fixtures/outdoor-items.js';
import { vi } from 'vitest';

function makeFakeAnthropic(scriptedResponses: Array<{ content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>; stop_reason: 'end_turn' | 'tool_use'; usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number } }>) {
  let i = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const r = scriptedResponses[Math.min(i, scriptedResponses.length - 1)]!;
        i += 1;
        return r;
      }),
    },
  };
}

function makeAgent(rows: any[]) {
  const cache = new InventoryCache(async () => rows);
  const conversations = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
  const stats = new Stats();
  return { cache, conversations, stats };
}

describe('OutdoorAgent.handleMessage', () => {
  test('returns the assistant text for a no-tool response', async () => {
    const { cache, conversations, stats } = makeAgent([FIXTURE_THERMAREST]);
    await cache.refresh();
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'Hi Tom!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 4 },
      },
    ]);
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    const out = await agent.handleMessage('chat-1', 'hello');
    expect(out).toBe('Hi Tom!');
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(stats.totalQueries).toBe(1);
    expect(stats.cacheHits).toBe(1);
  });

  test('executes a tool call and feeds the result back to the model', async () => {
    const { cache, conversations, stats } = makeAgent([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tid = itemId(FIXTURE_THERMAREST);
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'get_product_url', input: { item_id: tid } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, cache_creation_input_tokens: 2400, cache_read_input_tokens: 0, output_tokens: 12 },
      },
      {
        content: [{ type: 'text', text: 'Here it is: https://example.com/thermarest' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 10 },
      },
    ]);
    const updateRowStatus = vi.fn();
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: updateRowStatus as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    const out = await agent.handleMessage('chat-1', 'give me the link');
    expect(out).toBe('Here it is: https://example.com/thermarest');
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
    // The second call's messages should include a tool_result block with the URL
    const secondCallArgs = (anthropic.messages.create as any).mock.calls[1][0];
    const lastUserContent = secondCallArgs.messages.at(-1).content;
    expect(JSON.stringify(lastUserContent)).toContain('https://example.com/thermarest');
  });

  test('records cold vs. warm cache correctly via Stats', async () => {
    const { cache, conversations, stats } = makeAgent([FIXTURE_THERMAREST]);
    await cache.refresh();
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'reply 1' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_creation_input_tokens: 2400, cache_read_input_tokens: 0, output_tokens: 4 },
      },
    ]);
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    await agent.handleMessage('chat-1', 'hi');
    expect(stats.coldWrites).toBe(1);
    expect(stats.cacheHits).toBe(0);
  });

  test('appends user + assistant messages to the conversation store', async () => {
    const { cache, conversations, stats } = makeAgent([FIXTURE_THERMAREST]);
    await cache.refresh();
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'sure' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 1 },
      },
    ]);
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    await agent.handleMessage('chat-1', 'are you there?');
    const history = conversations.get('chat-1');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user', content: 'are you there?' });
    expect(history[1]).toMatchObject({ role: 'assistant', content: 'sure' });
  });

  test('caps the tool-call loop at 8 iterations and throws if exceeded', async () => {
    const { cache, conversations, stats } = makeAgent([FIXTURE_THERMAREST]);
    await cache.refresh();
    // Always returns a tool_use; the loop should hit the cap and throw.
    const tid = itemId(FIXTURE_THERMAREST);
    const looping = {
      content: [{ type: 'tool_use' as const, id: 'tu_1', name: 'get_product_url', input: { item_id: tid } }],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 8 },
    };
    const anthropic = makeFakeAnthropic(Array.from({ length: 12 }, () => looping));
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    await expect(agent.handleMessage('chat-1', 'hi')).rejects.toThrow(/tool-call loop/i);
  });
});
```

- [ ] **Step 6.2: Run tests — expect failure**

```bash
npx vitest run tests/domains/outdoor/agent.test.ts
```

Expected: 5 new tests FAIL (OutdoorAgent module/class missing). The 6 buildSystemPrompt tests should still pass.

- [ ] **Step 6.3: Implement `OutdoorAgent` in `domains/outdoor/agent.ts`**

Append to `domains/outdoor/agent.ts` (do not delete `buildSystemPrompt`):

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { InventoryCache } from '../../apps/bot/inventoryCache.js';
import type { SheetsClient } from '../../lib/sheets.js';
import type { ItemStatus } from '../../lib/types.js';
import { ConversationStore } from '../../lib/conversations.js';
import { Stats } from '../../apps/bot/stats.js';
import { createTools, TOOL_SCHEMAS, type ToolHandlers } from './tools.js';

const SONNET_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const MAX_TOOL_LOOPS = 8;

export interface OutdoorAgentOptions {
  cache: InventoryCache;
  conversations: ConversationStore;
  stats: Stats;
  anthropic: Anthropic;
  sheets: SheetsClient;
  spreadsheetId: string;
  updateRowStatus: (
    sheets: SheetsClient,
    spreadsheetId: string,
    input: { rowIndex: number; newStatus: ItemStatus },
  ) => Promise<void>;
}

type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown };

export class OutdoorAgent {
  private readonly tools: ToolHandlers;

  constructor(private readonly opts: OutdoorAgentOptions) {
    this.tools = createTools({
      cache: opts.cache,
      sheets: opts.sheets,
      spreadsheetId: opts.spreadsheetId,
      updateRowStatus: opts.updateRowStatus,
    });
  }

  async handleMessage(chatId: string, userText: string): Promise<string> {
    const system = buildSystemPrompt({ compactViewText: this.opts.cache.getCompactView().text });
    const history = this.opts.conversations.get(chatId);
    const messages: AnthropicMessage[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ];

    let assistantText = '';
    let firstTokenMs = 0;
    const t0 = Date.now();
    let wasCacheHit = false;
    let totalSystemTokens = 0;

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
      const callStart = Date.now();
      const resp = await this.opts.anthropic.messages.create({
        model: SONNET_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: messages as Anthropic.Messages.MessageParam[],
        tools: TOOL_SCHEMAS as unknown as Anthropic.Messages.Tool[],
      });
      if (loop === 0) {
        firstTokenMs = Date.now() - callStart;
        wasCacheHit = (resp.usage.cache_read_input_tokens ?? 0) > 0;
        totalSystemTokens = (resp.usage.cache_creation_input_tokens ?? 0) + (resp.usage.cache_read_input_tokens ?? 0);
      }

      if (resp.stop_reason === 'tool_use') {
        const toolUseBlocks = resp.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
        // Append the assistant's tool_use response
        messages.push({ role: 'assistant', content: resp.content });
        // Execute each tool, collect tool_result blocks
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
        for (const block of toolUseBlocks) {
          const result = await this.dispatchTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // End turn — collect text and break
      assistantText = resp.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      break;
    }

    if (!assistantText) {
      throw new Error('Agent tool-call loop exceeded max iterations without producing a text response');
    }

    const totalResponseMs = Date.now() - t0;
    this.opts.stats.recordQuery({
      systemPromptTokens: totalSystemTokens,
      cacheHit: wasCacheHit,
      firstTokenMs,
      totalResponseMs,
    });

    this.opts.conversations.append(chatId, { role: 'user', content: userText });
    this.opts.conversations.append(chatId, { role: 'assistant', content: assistantText });

    return assistantText;
  }

  private async dispatchTool(name: string, input: unknown): Promise<unknown> {
    if (name === 'get_product_url') {
      return this.tools.get_product_url(input as { item_id: string });
    }
    if (name === 'update_status') {
      return this.tools.update_status(input as { item_id: string; new_status: ItemStatus });
    }
    return { ok: false, message: `Unknown tool: ${name}` };
  }
}
```

- [ ] **Step 6.4: Run tests — expect pass**

```bash
npx vitest run tests/domains/outdoor/agent.test.ts && npm run typecheck
```

Expected: 11 tests pass total (6 buildSystemPrompt + 5 OutdoorAgent), typecheck clean.

- [ ] **Step 6.5: Run full test suite to make sure nothing regressed**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6.6: Commit**

```bash
git add domains/outdoor/agent.ts tests/domains/outdoor/agent.test.ts
git commit -m "feat: OutdoorAgent orchestrator with tool-call loop (Phase 2, Task 2.4 part 6/7)"
```

---

## Task 7: CLI smoke script for end-to-end agent verification

A one-shot script Tom runs to send a single message to the real agent against the real sheet + real Anthropic API. Prints the response + the `formatStats()` line so cache cost / latency are visible.

**Files:**
- Create: `scripts/smoke-agent.ts`
- Modify: `package.json` — add `"smoke-agent": "tsx scripts/smoke-agent.ts"`

- [ ] **Step 7.1: Implement `scripts/smoke-agent.ts`**

```typescript
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createSheetsClient, readMasterRows, updateRowStatus } from '../lib/sheets.js';
import { InventoryCache } from '../apps/bot/inventoryCache.js';
import { Stats, formatStats } from '../apps/bot/stats.js';
import { ConversationStore } from '../lib/conversations.js';
import { filterToActiveOutdoor } from '../domains/outdoor/inventory.js';
import { OutdoorAgent } from '../domains/outdoor/agent.js';

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId || !anthropicKey) {
    console.error('Missing required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SHEET_ID, ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const message = process.argv.slice(2).join(' ') || 'What sleeping pads do I own?';
  console.log(`\nQuery: "${message}"\n`);

  const sheets = createSheetsClient({ clientId, clientSecret, refreshToken });
  const cache = new InventoryCache(() => readMasterRows(sheets, spreadsheetId));
  await cache.refresh();
  const activeOutdoor = filterToActiveOutdoor(cache.getSnapshot());
  console.log(`Loaded ${activeOutdoor.length} active outdoor rows (${cache.getCompactView().text.length} chars in compact view)`);

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  const stats = new Stats();
  const conversations = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });

  const agent = new OutdoorAgent({
    cache,
    conversations,
    stats,
    anthropic,
    sheets,
    spreadsheetId,
    updateRowStatus,
  });

  console.log('\n=== Agent reply ===\n');
  const reply = await agent.handleMessage('smoke-test', message);
  console.log(reply);

  const approxTokens = Math.ceil(cache.getCompactView().text.length / 4);
  console.log('\n=== /stats output ===\n');
  console.log(formatStats(stats, {
    activeOutdoorRows: activeOutdoor.length,
    freeContextTokens: 200_000 - approxTokens,
  }));
}

main().catch((err: unknown) => {
  console.error('Smoke failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
```

- [ ] **Step 7.2: Add npm script in `package.json`**

Open `package.json`. In the `"scripts"` block, add (preserving JSON validity — comma in the right places):

```json
    "smoke-agent": "tsx scripts/smoke-agent.ts",
```

A good place is right after `"smoke-cache"`.

- [ ] **Step 7.3: Typecheck (do NOT run the script — it costs real Anthropic credits)**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 7.4: Commit**

```bash
git add scripts/smoke-agent.ts package.json
git commit -m "feat: smoke-agent CLI for end-to-end agent verification (Phase 2, Task 2.4 part 7/7)"
```

---

## Final verification

- [ ] **Step F.1: Full suite + typecheck + lint**

```bash
npm run typecheck && npx vitest run && npm run lint
```

Expected: all green (lint may still have pre-existing errors in `scripts/dedup-existing.ts` and `scripts/migrate-to-master.ts` from Phase 1 — those are not in this task's diff and can be ignored).

- [ ] **Step F.2: Run the smoke script manually (Tom)**

This step is for Tom, not the implementer subagent — it costs real money and needs a real `ANTHROPIC_API_KEY`.

```bash
npm run smoke-agent -- 'Do I have a sleeping bag rated below 20°F?'
```

Expected:
- Agent prints a response that references actual items from the inventory
- `/stats` output shows 1 cold write (the first message of a fresh conversation)
- Run a second time with a different question within 5 minutes: should show 1 warm read instead

If responses are weak, garbled, or hallucinated, debug before declaring Phase 2.4 done.

- [ ] **Step F.3: Acceptance criteria from PLAN.md § Phase 2 Task 2.6**

Items handled by this task:
- ✅ Agent answers gear questions correctly using inventory in context
- ✅ Agent's REI preference instruction is in the system prompt
- ✅ `get_product_url` and `update_status` tools are wired
- ⏸ Slash commands `/log`, `/lost`, etc. — Task 2.5
- ⏸ `/stats` Telegram command — Task 2.5 (the `formatStats` rendering is already callable here)
- ⏸ Telegram listener + chat routing — Tasks 2.1 + 2.2

Items deferred to Task 2.6 (final acceptance test):
- The 5-question manual eval suite
- Edge cases (fuzzy match, unknown item id, /retired flow with multi-match disambiguation)

---

## Self-review notes

**Spec coverage (against PLAN.md § Phase 2 Task 2.4):**
- ✅ System prompt structure (persona + inventory + REI pref + tool guidance) — Task 5
- ✅ `cache_control: ephemeral` on the inventory block — Task 5
- ✅ Tools: `get_product_url`, `update_status` — Task 4
- ✅ Sonnet 4.6 model — Task 6
- ✅ 30-min idle conversation reset — Task 3
- ✅ Stats wiring (cache hit detection, token counting, latency) — Task 6
- ✅ REI preference per DECISIONS.md 2026-05-14 — Task 5
- ✅ Phantom-type decision resolved — Task 1

**Things deliberately deferred:**
- Telegram wiring (Tasks 2.1/2.2/2.5)
- Slash command handlers (Task 2.5 — though they will reuse `update_status` tool logic from this task)
- Streaming responses (not in Phase 2; nice-to-have for Telegram typing indicator later)
- Web search tool (Phase 2.5)

**Cross-references:**
- `apps/bot/inventoryCache.ts` (Task 2.3) — read via `cache.getCompactView()` + `cache.getSnapshot()` + `cache.applyLocalChange()`
- `apps/bot/stats.ts` (Task 2.3) — `Stats.recordQuery()` called in agent orchestrator
- `lib/classifier.ts` — reference pattern for Anthropic SDK + `cache_control` usage
- `lib/sheets.ts` — extended with `updateRowStatus`

**Type consistency check:**
- `MasterRow`, `ItemStatus`, `SheetsClient` — all from `lib/types.js` and `lib/sheets.js`, no duplication
- `InventoryCache`, `CompactView` — from `apps/bot/inventoryCache.ts` and `domains/outdoor/serialize.ts`
- `Stats`, `formatStats` — from `apps/bot/stats.ts`
- `ChatMessage`, `ChatRole` — from `lib/conversations.ts` (new)
- `ToolDeps`, `ToolHandlers`, `TOOL_SCHEMAS` — from `domains/outdoor/tools.ts` (new)
- `OutdoorAgent`, `OutdoorAgentOptions`, `buildSystemPrompt`, `SystemBlock` — from `domains/outdoor/agent.ts` (new)

**Placeholder scan:** no TBDs, no "implement appropriate error handling," no "similar to Task N" — every step shows the code or the exact command.
