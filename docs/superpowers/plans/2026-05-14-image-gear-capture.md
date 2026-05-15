# Image-Sourced Gear Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Tom add a piece of physical gear to the inventory sheet by sending a photo + `/addgear` caption to the Telegram bot. Vision extracts brand/item/color/size; bot prompts conversationally for missing date/price; fuzzy-dedups against existing rows; user confirms and the row is written with `Source = Image`.

**Architecture:** New Telegram bot intent triggered by a photo whose caption starts with `/addgear`. A mid-flow `AddgearStateStore` tracks "what is the user answering right now?" (date / price / size / dedup-decision). Once all required fields are filled, the flow hands off to the existing `PendingActionStore` + `/confirm` terminal step that the `/log` command already uses — so writes go through one battle-tested path. Source code: `lib/parsers/photo.ts` (vision), `lib/addgearState.ts` (state), `apps/bot/commands/addgear.ts` (handler).

**Tech Stack:** TypeScript 5 strict, vitest, `@anthropic-ai/sdk` (Sonnet 4.6 vision, prompt-cached system), Telegram Bot API (HTTP), googleapis (Sheets), existing project plumbing (`InventoryCache`, `PendingActionStore`).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `lib/types.ts` | Modify | Add `'Image'` to `SOURCE_VALUES` |
| `lib/models.ts` | Modify | Add `VISION_MODEL` constant pointing at Sonnet 4.6 |
| `lib/dedup.ts` | Modify | Add `fuzzyMatchExisting(brand, itemName, rows)` |
| `lib/telegram.ts` | Modify | Add photo types + `getFile()` + `downloadFile()` |
| `lib/addgearState.ts` | Create | State store for the multi-step capture flow |
| `lib/parsers/photo.ts` | Create | Vision extractor: `(imageBytes, caption) → partial fields` |
| `apps/bot/commands/addgear.ts` | Create | Orchestrates the state machine, decides what to ask next |
| `apps/bot/commands/parse.ts` | Modify | Add `'addgear'` to `CommandName` (mostly so `/cancel` can clear addgear state cleanly) |
| `apps/bot/handlers.ts` | Modify | Extend `HandlerDeps`; wire `/cancel` to also clear `addgearState`; add photo entry point |
| `apps/bot/router.ts` | Modify | Add `routePhoto` + intercept text replies while `addgearState` is active |
| `apps/bot/index.ts` | Modify | Extract `msg.photo` + `msg.caption` from updates; instantiate `AddgearStateStore`; route photos vs text |

**Test files:**
- `tests/lib/dedup-fuzzy.test.ts` — unit tests for `fuzzyMatchExisting`
- `tests/lib/addgearState.test.ts` — unit tests for the state store
- `tests/lib/telegram-photo.test.ts` — unit tests for `getFile` + `downloadFile` (mocked `fetch`)
- `tests/parsers/photo.test.ts` — vision-extractor tests (skipped unless `RUN_VISION_TESTS=1`)
- `tests/apps/bot/addgear.test.ts` — state-machine end-to-end with mocked deps

**Conventions to follow:**
- TypeScript strict mode; no `any`
- Vitest, `describe`/`test`/`expect`; use `vi.useFakeTimers()` for TTL tests (see existing `conversations.test.ts`)
- Per-row dedup uses `(Order ID, Brand, Item Name, Color, Size)` — image rows always get a unique synthetic Order ID so they don't collide with each other
- Default to no comments; only document WHY a non-obvious decision was made
- Imports use `.js` extensions (project is ESM-compiled)

---

## Task 1: Schema — add `Image` source value and `VISION_MODEL` constant

**Files:**
- Modify: `lib/types.ts:36`
- Modify: `lib/models.ts:27`
- Test: `tests/sources.test.ts` (extend existing)

- [ ] **Step 1: Read existing `SOURCE_VALUES` test, add a failing assertion for `Image`**

Open `tests/sources.test.ts` and add inside the existing `describe` block (or at the bottom if no existing block):

```typescript
import { SOURCE_VALUES } from '../lib/types.js';

describe('SOURCE_VALUES', () => {
  test('includes Image for photo-captured gear', () => {
    expect(SOURCE_VALUES).toContain('Image');
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/sources.test.ts
```
Expected: FAIL — `expected [ 'REI', 'Amazon', 'Other' ] to contain 'Image'`

- [ ] **Step 3: Add `'Image'` to `SOURCE_VALUES` in `lib/types.ts`**

```typescript
export const SOURCE_VALUES = ['REI', 'Amazon', 'Other', 'Image'] as const;
```

- [ ] **Step 4: Add `VISION_MODEL` constant to `lib/models.ts`**

After the `PARSER_MODEL` line near line 27:

```typescript
/** Model used by lib/parsers/photo.ts for vision extraction from gear photos. */
export const VISION_MODEL: ModelId = MODELS.sonnet;
```

- [ ] **Step 5: Run all tests, confirm green**

```bash
npx vitest run
```
Expected: PASS across all suites.

- [ ] **Step 6: Run typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS with no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts lib/models.ts tests/sources.test.ts
git commit -m "feat(types): add Image source value + VISION_MODEL constant"
```

---

## Task 2: `fuzzyMatchExisting` — dedup helper

**Files:**
- Modify: `lib/dedup.ts` (add new exported function)
- Test: `tests/lib/dedup-fuzzy.test.ts` (create)

This is a pure function — perfect TDD candidate.

- [ ] **Step 1: Write failing test for empty input**

Create `tests/lib/dedup-fuzzy.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { fuzzyMatchExisting } from '../../lib/dedup.js';

describe('fuzzyMatchExisting', () => {
  test('returns no matches when the input list is empty', () => {
    const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails (no such export)**

```bash
npx vitest run tests/lib/dedup-fuzzy.test.ts
```
Expected: FAIL — `fuzzyMatchExisting is not a function`

- [ ] **Step 3: Add minimal `fuzzyMatchExisting` to `lib/dedup.ts`**

At the bottom of `lib/dedup.ts` add:

```typescript
/**
 * Used by /addgear flow to warn before writing a duplicate. Returns the top
 * 3 existing rows with score >= 0.5 ranked by token-overlap (Jaccard).
 *
 * Score is Jaccard over the token set of (normalizedBrand + normalizedItemName).
 * Normalization: lowercase, trim, collapse internal whitespace.
 */
export interface FuzzyMatch {
  rowIndex: number;
  brand: string;
  itemName: string;
  score: number;
}

export interface FuzzyCandidateRow {
  brand: string;
  itemName: string;
}

export function fuzzyMatchExisting(
  brand: string,
  itemName: string,
  rows: readonly FuzzyCandidateRow[],
): FuzzyMatch[] {
  return [];
}
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
npx vitest run tests/lib/dedup-fuzzy.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add failing test for exact match**

Append to the `describe` block:

```typescript
test('returns score 1.0 for an exact match', () => {
  const rows = [{ brand: 'Patagonia', itemName: 'Houdini Jacket' }];
  const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
  expect(result).toHaveLength(1);
  expect(result[0]!.score).toBeCloseTo(1.0, 5);
  expect(result[0]!.rowIndex).toBe(0);
});
```

- [ ] **Step 6: Run test, confirm it fails (returns empty)**

```bash
npx vitest run tests/lib/dedup-fuzzy.test.ts
```
Expected: FAIL — `expected [] to have length 1`

- [ ] **Step 7: Implement scoring**

Replace the body of `fuzzyMatchExisting` in `lib/dedup.ts`:

```typescript
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().trim().split(/\s+/).filter((t) => t.length > 0),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function fuzzyMatchExisting(
  brand: string,
  itemName: string,
  rows: readonly FuzzyCandidateRow[],
): FuzzyMatch[] {
  const target = tokenize(`${brand} ${itemName}`);
  const scored: FuzzyMatch[] = [];
  rows.forEach((row, idx) => {
    const candidate = tokenize(`${row.brand} ${row.itemName}`);
    const score = jaccard(target, candidate);
    if (score >= 0.5) {
      scored.push({ rowIndex: idx, brand: row.brand, itemName: row.itemName, score });
    }
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}
```

- [ ] **Step 8: Run test, confirm it passes**

```bash
npx vitest run tests/lib/dedup-fuzzy.test.ts
```
Expected: PASS.

- [ ] **Step 9: Add remaining cases — case/whitespace tolerance, no match, multi-match cap**

Append to the same `describe` block:

```typescript
test('case-insensitive and whitespace-tolerant', () => {
  const rows = [{ brand: 'PATAGONIA', itemName: '  Houdini  Jacket  ' }];
  const result = fuzzyMatchExisting('patagonia', 'houdini jacket', rows);
  expect(result).toHaveLength(1);
  expect(result[0]!.score).toBeCloseTo(1.0, 5);
});

test('partial overlap above 0.5 threshold is included', () => {
  const rows = [{ brand: 'Patagonia', itemName: 'Houdini Air Jacket' }];
  const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
  expect(result).toHaveLength(1);
  expect(result[0]!.score).toBeGreaterThan(0.5);
  expect(result[0]!.score).toBeLessThan(1.0);
});

test('overlap below 0.5 is excluded', () => {
  const rows = [{ brand: 'Patagonia', itemName: 'Capilene Thermal Weight Crew' }];
  const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
  expect(result).toEqual([]);
});

test('caps results at 3 even when more match', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    brand: 'Patagonia',
    itemName: `Houdini Jacket v${i}`,
  }));
  const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
  expect(result).toHaveLength(3);
});

test('ranks higher scores first', () => {
  const rows = [
    { brand: 'Patagonia', itemName: 'Houdini Air Jacket Mens' },     // partial
    { brand: 'Patagonia', itemName: 'Houdini Jacket' },              // exact
    { brand: 'Patagonia', itemName: 'Houdini Jacket Mens Medium' },  // partial, closer
  ];
  const result = fuzzyMatchExisting('Patagonia', 'Houdini Jacket', rows);
  expect(result[0]!.score).toBeGreaterThanOrEqual(result[1]!.score);
  expect(result[1]!.score).toBeGreaterThanOrEqual(result[2]!.score);
});
```

- [ ] **Step 10: Run all dedup tests, confirm green**

```bash
npx vitest run tests/lib/dedup-fuzzy.test.ts tests/dedup.test.ts
```
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add lib/dedup.ts tests/lib/dedup-fuzzy.test.ts
git commit -m "feat(dedup): fuzzyMatchExisting for /addgear duplicate warnings"
```

---

## Task 3: Telegram photo support — types, `getFile`, `downloadFile`

**Files:**
- Modify: `lib/telegram.ts`
- Test: `tests/lib/telegram-photo.test.ts` (create)

The current `lib/telegram.ts` only handles text. We add photo types and two file-fetch helpers.

- [ ] **Step 1: Write failing test for `getFile`**

Create `tests/lib/telegram-photo.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { getFile, downloadFile, type TelegramConfig } from '../../lib/telegram.js';

const cfg: TelegramConfig = { botToken: 'TEST-TOKEN' };

describe('getFile', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('returns file_path from Telegram getFile response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { file_id: 'F1', file_path: 'photos/file_1.jpg' } }),
        { status: 200 },
      ),
    );
    const result = await getFile(cfg, 'F1');
    expect(result.file_path).toBe('photos/file_1.jpg');
  });

  test('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Request', { status: 400 }));
    await expect(getFile(cfg, 'F1')).rejects.toThrow(/HTTP 400/);
  });
});

describe('downloadFile', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('returns the response body as a Buffer', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]); // JPEG SOI bytes
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes, { status: 200 }));
    const buf = await downloadFile(cfg, 'photos/file_1.jpg');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(3);
    expect(buf[0]).toBe(0xff);
  });

  test('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    await expect(downloadFile(cfg, 'photos/missing.jpg')).rejects.toThrow(/HTTP 404/);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail (no exports)**

```bash
npx vitest run tests/lib/telegram-photo.test.ts
```
Expected: FAIL — module has no `getFile` / `downloadFile`.

- [ ] **Step 3: Extend `lib/telegram.ts` types and add the helpers**

In `lib/telegram.ts`, after the existing `TelegramUpdateMessage` interface, add:

```typescript
export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}
```

Extend `TelegramUpdateMessage` (was lines 13-19) to include photo and caption:

```typescript
export interface TelegramUpdateMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: string; first_name?: string; username?: string };
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
}
```

At the bottom of the file add:

```typescript
export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

export async function getFile(cfg: TelegramConfig, fileId: string): Promise<TelegramFile> {
  const resp = await fetch(
    `${TELEGRAM_API_BASE}/bot${cfg.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram getFile failed (HTTP ${resp.status}): ${body}`);
  }
  const data = (await resp.json()) as { ok: boolean; result: TelegramFile; description?: string };
  if (!data.ok) throw new Error(`Telegram getFile returned ok=false: ${data.description ?? 'unknown'}`);
  if (!data.result.file_path) throw new Error(`Telegram getFile returned no file_path for ${fileId}`);
  return data.result;
}

export async function downloadFile(cfg: TelegramConfig, filePath: string): Promise<Buffer> {
  const resp = await fetch(`${TELEGRAM_API_BASE}/file/bot${cfg.botToken}/${filePath}`);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram downloadFile failed (HTTP ${resp.status}): ${body}`);
  }
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}
```

- [ ] **Step 4: Run tests, confirm green**

```bash
npx vitest run tests/lib/telegram-photo.test.ts tests/lib/telegram.test.ts
```
Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/telegram.ts tests/lib/telegram-photo.test.ts
git commit -m "feat(telegram): photo types + getFile/downloadFile helpers"
```

---

## Task 4: `AddgearStateStore` — multi-step flow state

**Files:**
- Create: `lib/addgearState.ts`
- Test: `tests/lib/addgearState.test.ts`

This mirrors `ConversationStore` and `PendingActionStore` in shape: in-memory `Map<chatId, Entry>` with TTL expiry.

- [ ] **Step 1: Write the failing test for an empty store**

Create `tests/lib/addgearState.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddgearStateStore } from '../../lib/addgearState.js';

describe('AddgearStateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('peek returns null for an unknown chat', () => {
    const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
    expect(store.peek('chat-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, confirm it fails (no module)**

```bash
npx vitest run tests/lib/addgearState.test.ts
```
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `lib/addgearState.ts` with the type and minimal skeleton**

```typescript
import type { MasterRow } from './types.js';
import type { FuzzyMatch } from './dedup.js';

/**
 * Per-chat state for the /addgear capture flow.
 *
 * The flow walks chatId through:
 *   awaiting-date -> awaiting-price -> [awaiting-size] -> [awaiting-dedup] -> awaiting-confirm
 *
 * Each step holds a partial draft; awaiting-confirm holds a complete MasterRow.
 * On terminal success (write succeeds) or user /cancel, the entry is cleared.
 */
export interface PartialDraft {
  brand: string;
  itemName: string;
  color: string;
  size: string;
  date: string;            // '' until filled
  price: number | null;    // null until filled
  imageFileId: string;
  domain: string;
  category: string;
  subCategory: string;
  type: 'Gear' | 'Consumable' | 'Service';
  reasoning: string;
}

export type AddgearStep =
  | { kind: 'awaiting-date'; draft: PartialDraft }
  | { kind: 'awaiting-price'; draft: PartialDraft }
  | { kind: 'awaiting-size'; draft: PartialDraft }
  | { kind: 'awaiting-dedup'; draft: PartialDraft; candidates: FuzzyMatch[] }
  | { kind: 'awaiting-confirm'; row: MasterRow };

interface Entry {
  step: AddgearStep;
  updatedAt: number;
}

export interface AddgearStateStoreOptions {
  ttlMs: number;
}

export class AddgearStateStore {
  private readonly store = new Map<string, Entry>();
  constructor(private readonly opts: AddgearStateStoreOptions) {}

  peek(chatId: string): AddgearStep | null {
    const e = this.store.get(chatId);
    if (!e) return null;
    if (Date.now() - e.updatedAt > this.opts.ttlMs) {
      this.store.delete(chatId);
      return null;
    }
    return e.step;
  }

  set(chatId: string, step: AddgearStep): void {
    this.store.set(chatId, { step, updatedAt: Date.now() });
  }

  clear(chatId: string): void {
    this.store.delete(chatId);
  }
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
npx vitest run tests/lib/addgearState.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add the rest of the tests — set/peek roundtrip, TTL expiry, clear, isolation**

Append to the `describe` block:

```typescript
test('set + peek returns the step', () => {
  const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
  const draft = {
    brand: 'Patagonia', itemName: 'Houdini', color: '', size: '',
    date: '', price: null, imageFileId: 'F1',
    domain: 'Outdoor', category: 'Hiking Gear', subCategory: 'Shell',
    type: 'Gear' as const, reasoning: '',
  };
  store.set('chat-1', { kind: 'awaiting-date', draft });
  const step = store.peek('chat-1');
  expect(step?.kind).toBe('awaiting-date');
  if (step?.kind === 'awaiting-date') {
    expect(step.draft.brand).toBe('Patagonia');
  }
});

test('expires entry after ttl', () => {
  const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
  const draft = {
    brand: 'X', itemName: 'Y', color: '', size: '', date: '', price: null,
    imageFileId: 'F1', domain: 'Outdoor', category: '', subCategory: '',
    type: 'Gear' as const, reasoning: '',
  };
  store.set('chat-1', { kind: 'awaiting-date', draft });
  vi.advanceTimersByTime(6 * 60 * 1000);
  expect(store.peek('chat-1')).toBeNull();
});

test('clear removes entry', () => {
  const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
  const draft = {
    brand: 'X', itemName: 'Y', color: '', size: '', date: '', price: null,
    imageFileId: 'F1', domain: 'Outdoor', category: '', subCategory: '',
    type: 'Gear' as const, reasoning: '',
  };
  store.set('chat-1', { kind: 'awaiting-date', draft });
  store.clear('chat-1');
  expect(store.peek('chat-1')).toBeNull();
});

test('isolates entries by chat id', () => {
  const store = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
  const draftA = {
    brand: 'A', itemName: 'A', color: '', size: '', date: '', price: null,
    imageFileId: 'F1', domain: 'Outdoor', category: '', subCategory: '',
    type: 'Gear' as const, reasoning: '',
  };
  const draftB = { ...draftA, brand: 'B', itemName: 'B' };
  store.set('chat-A', { kind: 'awaiting-date', draft: draftA });
  store.set('chat-B', { kind: 'awaiting-price', draft: draftB });
  const sA = store.peek('chat-A');
  const sB = store.peek('chat-B');
  expect(sA?.kind).toBe('awaiting-date');
  expect(sB?.kind).toBe('awaiting-price');
});
```

- [ ] **Step 6: Run all addgearState tests, confirm green**

```bash
npx vitest run tests/lib/addgearState.test.ts
```
Expected: 4 PASS.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/addgearState.ts tests/lib/addgearState.test.ts
git commit -m "feat(addgear): AddgearStateStore for multi-step capture flow"
```

---

## Task 5: `lib/parsers/photo.ts` — vision extraction

**Files:**
- Create: `lib/parsers/photo.ts`
- Test: `tests/parsers/photo.test.ts`
- Create: `tests/fixtures/photos/.gitkeep` (placeholder)

Vision tests against the live model are skipped by default (token cost on every CI run is wasteful for low signal). They run with `RUN_VISION_TESTS=1`.

- [ ] **Step 1: Create `lib/parsers/photo.ts` with the function signature**

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import { VISION_MODEL } from '../models.js';
import { callWithRetry } from '../anthropic-retry.js';

export type Confidence = 'high' | 'low' | 'missing';

export interface PhotoExtraction {
  brand: string;
  itemName: string;
  color: string;
  size: string;
  confidence: {
    brand: Confidence;
    itemName: Confidence;
    color: Confidence;
    size: Confidence;
  };
}

const SYSTEM_PROMPT = `You extract structured product info from a photograph of a piece of outdoor gear. The user has taken the photo to log an already-owned item into a personal inventory. There is no receipt — you are reading hang tags, labels, embroidered logos, and the gear itself.

Return JSON only with this exact shape:
{
  "brand": "<brand, or empty string if not visible>",
  "itemName": "<product name, brand stripped, empty string if not visible>",
  "color": "<color or empty>",
  "size": "<size from tag, e.g. 'M', '32x32', empty if not visible>",
  "confidence": {
    "brand": "high" | "low" | "missing",
    "itemName": "high" | "low" | "missing",
    "color": "high" | "low" | "missing",
    "size": "high" | "low" | "missing"
  }
}

Rules:
- "high" = you can clearly read it on a tag, label, or print
- "low" = you can guess from style/shape but it isn't printed
- "missing" = no signal at all; the field is an empty string in that case
- Item name should NOT include the brand prefix (we store brand separately)
- If the user caption (passed as text below the image) names the gear, weight it but still verify against the photo
- Return JSON only, no prose, no markdown fences`;

export async function extractFromPhoto(
  anthropic: Anthropic,
  imageBytes: Buffer,
  caption: string,
): Promise<PhotoExtraction | null> {
  const base64 = imageBytes.toString('base64');
  const resp = await callWithRetry(() =>
    anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 512,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
            { type: 'text', text: caption || '(no caption)' },
          ],
        },
      ],
    }),
  );
  const block = resp.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(block.text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const conf = (raw.confidence ?? {}) as Record<string, unknown>;
  const validConf = (v: unknown): Confidence =>
    v === 'high' || v === 'low' || v === 'missing' ? v : 'missing';
  return {
    brand: String(raw.brand ?? ''),
    itemName: String(raw.itemName ?? ''),
    color: String(raw.color ?? ''),
    size: String(raw.size ?? ''),
    confidence: {
      brand: validConf(conf.brand),
      itemName: validConf(conf.itemName),
      color: validConf(conf.color),
      size: validConf(conf.size),
    },
  };
}
```

- [ ] **Step 2: Add `.gitkeep` for fixture directory**

```bash
mkdir -p tests/fixtures/photos
touch tests/fixtures/photos/.gitkeep
```

- [ ] **Step 3: Create skipped-by-default test file**

Create `tests/parsers/photo.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractFromPhoto } from '../../lib/parsers/photo.js';

const RUN = process.env.RUN_VISION_TESTS === '1';
const apiKey = process.env.ANTHROPIC_API_KEY;

const maybeDescribe = RUN && apiKey ? describe : describe.skip;

maybeDescribe('extractFromPhoto (live vision, skipped unless RUN_VISION_TESTS=1)', () => {
  test('extracts brand and itemName from a real gear photo', async () => {
    const fixturePath = path.join('tests', 'fixtures', 'photos', 'sample.jpg');
    const bytes = await readFile(fixturePath);
    const anthropic = new Anthropic({ apiKey: apiKey! });
    const result = await extractFromPhoto(anthropic, bytes, 'Patagonia Houdini');
    expect(result).not.toBeNull();
    expect(result!.brand.length).toBeGreaterThan(0);
    expect(result!.itemName.length).toBeGreaterThan(0);
    expect(['high', 'low']).toContain(result!.confidence.brand);
  }, 30_000);
});
```

The test is intentionally fixture-dependent: when Tom is ready to run it for real, he drops a `sample.jpg` into `tests/fixtures/photos/` and runs `RUN_VISION_TESTS=1 ANTHROPIC_API_KEY=... npx vitest run tests/parsers/photo.test.ts`.

- [ ] **Step 4: Confirm test file loads without errors (it skips by default)**

```bash
npx vitest run tests/parsers/photo.test.ts
```
Expected: 1 skipped, 0 failures.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/parsers/photo.ts tests/parsers/photo.test.ts tests/fixtures/photos/.gitkeep
git commit -m "feat(parsers): vision extractor for /addgear photos"
```

---

## Task 6: `addgear` command handler — the state machine

**Files:**
- Create: `apps/bot/commands/addgear.ts`
- Test: `tests/apps/bot/addgear.test.ts`

This is the biggest task. We build it incrementally — each transition gets its own test before its implementation.

The command exposes two entry points:
- `startAddgear(chatId, photoFileId, caption, deps)` — called when a photo with `/addgear ...` caption arrives.
- `continueAddgear(chatId, text, deps)` — called for plain-text replies while `addgearState` is active.

**Caption pre-fill:** If the caption contains `~YYYY` it pre-fills `date = YYYY-01-01` (so the year derivation works). If it contains `~$NUMBER` or `~NUMBER` (post-tilde) it pre-fills `price`. Anything else in the caption is treated as a freeform hint passed to vision via `caption` — vision will use it to disambiguate.

- [ ] **Step 1: Create the test file scaffold + first failing test (start with no caption hints, vision-extracts-all-fields path)**

Create `tests/apps/bot/addgear.test.ts`:

```typescript
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { AddgearStateStore } from '../../../lib/addgearState.js';
import { PendingActionStore } from '../../../lib/pendingActions.js';
import { startAddgear, continueAddgear, type AddgearDeps } from '../../../apps/bot/commands/addgear.js';
import type { PhotoExtraction } from '../../../lib/parsers/photo.js';
import type { Classification } from '../../../lib/classifier.js';
import type { MasterRow } from '../../../lib/types.js';

function makeDeps(overrides: Partial<AddgearDeps> = {}): AddgearDeps {
  const addgearState = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });
  const pendingActions = new PendingActionStore({ ttlMs: 5 * 60 * 1000 });
  return {
    addgearState,
    pendingActions,
    today: () => '2026-05-14',
    downloadPhoto: vi.fn(async (_fileId: string) => Buffer.from('FAKE')),
    extractFromPhoto: vi.fn(async (_buf: Buffer, _caption: string): Promise<PhotoExtraction | null> => ({
      brand: 'Patagonia',
      itemName: 'Houdini Jacket',
      color: 'Blue',
      size: 'M',
      confidence: { brand: 'high', itemName: 'high', color: 'high', size: 'high' },
    })),
    classify: vi.fn(async (): Promise<Classification> => ({
      domain: 'Outdoor',
      type: 'Gear',
      category: 'Hiking Gear',
      subCategory: 'Wind Shell',
      brand: 'Patagonia',
      reasoning: 'classified',
    })),
    listExistingRows: vi.fn((): readonly { brand: string; itemName: string }[] => []),
    randomHash: () => 'abc123',
    ...overrides,
  };
}

describe('startAddgear — vision extracts everything', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('with vision filling all fields and caption "~2018 ~$120", lands in awaiting-confirm', async () => {
    const deps = makeDeps();
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/About to log/i);
    expect(reply).toContain('Patagonia');
    expect(reply).toContain('Houdini Jacket');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
  });
});
```

- [ ] **Step 2: Run test, confirm it fails (module doesn't exist)**

```bash
npx vitest run tests/apps/bot/addgear.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `apps/bot/commands/addgear.ts` with the minimal happy path**

```typescript
import { createHash } from 'node:crypto';
import type { AddgearStateStore, PartialDraft } from '../../../lib/addgearState.js';
import type { PendingActionStore } from '../../../lib/pendingActions.js';
import { fuzzyMatchExisting, type FuzzyCandidateRow } from '../../../lib/dedup.js';
import type { PhotoExtraction } from '../../../lib/parsers/photo.js';
import type { Classification } from '../../../lib/classifier.js';
import type { MasterRow, ItemType, Domain } from '../../../lib/types.js';

export interface AddgearDeps {
  addgearState: AddgearStateStore;
  pendingActions: PendingActionStore;
  today: () => string;
  downloadPhoto: (fileId: string) => Promise<Buffer>;
  extractFromPhoto: (bytes: Buffer, caption: string) => Promise<PhotoExtraction | null>;
  classify: (input: { brand: string; itemName: string }) => Promise<Classification>;
  listExistingRows: () => readonly FuzzyCandidateRow[];
  randomHash: () => string;
}

interface CaptionHints {
  year?: string;
  price?: number;
  rest: string;
}

function parseCaptionHints(captionAfterCommand: string): CaptionHints {
  const out: CaptionHints = { rest: '' };
  const yearMatch = captionAfterCommand.match(/~(\d{4})\b/);
  if (yearMatch) out.year = yearMatch[1]!;
  const priceMatch = captionAfterCommand.match(/~\$?(\d+(?:\.\d{1,2})?)\b/g);
  if (priceMatch) {
    const candidates = priceMatch
      .map((m) => Number(m.replace(/[~$]/g, '')))
      .filter((n) => !Number.isNaN(n) && (n < 1000 || n > 3000));
    if (candidates.length > 0) out.price = candidates[0];
  }
  out.rest = captionAfterCommand
    .replace(/~\d{4}\b/g, '')
    .replace(/~\$?\d+(?:\.\d{1,2})?\b/g, '')
    .trim();
  return out;
}

function makeOrderId(today: string, hash: string): string {
  const compactDate = today.replace(/-/g, '');
  return `IMG-${compactDate}-${hash.slice(0, 6)}`;
}

function makeHash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function rowFromDraft(draft: PartialDraft, today: string, orderId: string): MasterRow {
  return {
    year: draft.date ? draft.date.slice(0, 4) : '',
    date: draft.date,
    category: draft.category,
    subCategory: draft.subCategory,
    brand: draft.brand,
    itemName: draft.itemName,
    color: draft.color,
    size: draft.size,
    qty: 1,
    price: draft.price ?? 0,
    source: 'Image',
    orderId,
    status: 'active',
    domain: draft.domain as Domain,
    productUrl: '',
    type: draft.type,
    reasoning: draft.reasoning || 'captured via /addgear photo',
    notes: '',
  };
}

function previewRow(row: MasterRow): string {
  return [
    `About to log:`,
    `  ${row.brand} ${row.itemName} (${row.color || '—'}, ${row.size || '—'})`,
    `  $${row.price}, ${row.source}, ${row.date || '—'}, [${row.category}/${row.subCategory}]`,
    `Reply 'yes' to write, 'field: value' to change something, or /cancel.`,
  ].join('\n');
}

export async function startAddgear(
  chatId: string,
  photoFileId: string,
  caption: string,
  deps: AddgearDeps,
): Promise<string> {
  const afterCmd = caption.replace(/^\/addgear\s*/i, '');
  const hints = parseCaptionHints(afterCmd);

  const photoBytes = await deps.downloadPhoto(photoFileId);
  const extraction = await deps.extractFromPhoto(photoBytes, hints.rest);
  if (!extraction || (!extraction.brand && !extraction.itemName)) {
    return `Couldn't read brand or item name from the photo. Reply 'brand: X, item: Y' or send a clearer photo with /addgear.`;
  }

  const classification = await deps.classify({
    brand: extraction.brand,
    itemName: extraction.itemName,
  });

  const draft: PartialDraft = {
    brand: extraction.brand,
    itemName: extraction.itemName,
    color: extraction.color,
    size: extraction.size,
    date: hints.year ? `${hints.year}-01-01` : '',
    price: hints.price ?? null,
    imageFileId: photoFileId,
    domain: classification.domain,
    category: classification.category,
    subCategory: classification.subCategory,
    type: classification.type as ItemType,
    reasoning: 'captured via /addgear photo',
  };

  return advanceFlow(chatId, draft, deps);
}

function advanceFlow(chatId: string, draft: PartialDraft, deps: AddgearDeps): string {
  if (!draft.date) {
    deps.addgearState.set(chatId, { kind: 'awaiting-date', draft });
    return `Got ${draft.brand} ${draft.itemName}. When did you buy it? (year is fine, e.g. "2018", or "unknown")`;
  }
  if (draft.price === null) {
    deps.addgearState.set(chatId, { kind: 'awaiting-price', draft });
    return `What did you pay? (number, or "unknown")`;
  }
  // Fuzzy dedup
  const candidates = fuzzyMatchExisting(draft.brand, draft.itemName, deps.listExistingRows());
  if (candidates.length > 0) {
    deps.addgearState.set(chatId, { kind: 'awaiting-dedup', draft, candidates });
    const lines = candidates.map(
      (c, i) => `  ${i + 1}. row ${c.rowIndex + 2}: ${c.brand} ${c.itemName} (score ${c.score.toFixed(2)})`,
    );
    return [
      `Looks similar to existing rows:`,
      ...lines,
      `Reply 'add anyway' to log this as new, or /cancel.`,
    ].join('\n');
  }

  const hash = makeHash([draft.brand, draft.itemName, draft.color, draft.size, String(Date.now())]);
  const orderId = makeOrderId(deps.today(), hash);
  const row = rowFromDraft(draft, deps.today(), orderId);
  deps.addgearState.set(chatId, { kind: 'awaiting-confirm', row });
  return previewRow(row);
}

export async function continueAddgear(
  chatId: string,
  text: string,
  deps: AddgearDeps,
): Promise<string | null> {
  // Stub — implemented in later steps.
  return null;
}
```

- [ ] **Step 4: Run the first test, confirm pass**

```bash
npx vitest run tests/apps/bot/addgear.test.ts
```
Expected: PASS.

- [ ] **Step 5: Add failing test — missing date prompts user**

Append to `tests/apps/bot/addgear.test.ts`:

```typescript
describe('startAddgear — missing date triggers prompt', () => {
  test('with no caption hints, asks for date', async () => {
    const deps = makeDeps();
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    expect(reply).toMatch(/when did you buy it/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-date');
  });

  test('user replies with a year and flow advances to awaiting-price', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', '2018', deps);
    expect(reply).toMatch(/what did you pay/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-price');
    if (step?.kind === 'awaiting-price') {
      expect(step.draft.date).toBe('2018-01-01');
    }
  });
});
```

- [ ] **Step 6: Run tests, confirm one passes (`with no caption hints, asks for date`) and one fails (`user replies with a year...`)**

```bash
npx vitest run tests/apps/bot/addgear.test.ts
```
Expected: first new test PASS, second FAIL (`continueAddgear` returns null).

- [ ] **Step 7: Add explicit "acknowledged-unknown" flags to `PartialDraft` and implement `continueAddgear` for the date step**

We need to distinguish "user hasn't told me the date yet" from "user explicitly said the date is unknown" — otherwise the bot will re-ask every turn. Add boolean flags.

Edit `lib/addgearState.ts` `PartialDraft` interface to add:

```typescript
export interface PartialDraft {
  brand: string;
  itemName: string;
  color: string;
  size: string;
  date: string;
  dateAcknowledgedUnknown: boolean;   // user replied "unknown" — don't keep asking
  price: number | null;
  priceAcknowledgedUnknown: boolean;
  imageFileId: string;
  domain: string;
  category: string;
  subCategory: string;
  type: 'Gear' | 'Consumable' | 'Service';
  reasoning: string;
}
```

Update `startAddgear` in `addgear.ts` so the initial draft sets both `*AcknowledgedUnknown: false`:

```typescript
  const draft: PartialDraft = {
    brand: extraction.brand,
    itemName: extraction.itemName,
    color: extraction.color,
    size: extraction.size,
    date: hints.year ? `${hints.year}-01-01` : '',
    dateAcknowledgedUnknown: false,
    price: hints.price ?? null,
    priceAcknowledgedUnknown: false,
    imageFileId: photoFileId,
    domain: classification.domain,
    category: classification.category,
    subCategory: classification.subCategory,
    type: classification.type as ItemType,
    reasoning: 'captured via /addgear photo',
  };
```

Update `advanceFlow` so the date / price predicates consider acknowledged-unknown:

```typescript
function advanceFlow(chatId: string, draft: PartialDraft, deps: AddgearDeps): string {
  if (!draft.date && !draft.dateAcknowledgedUnknown) {
    deps.addgearState.set(chatId, { kind: 'awaiting-date', draft });
    return `Got ${draft.brand} ${draft.itemName}. When did you buy it? (year is fine, e.g. "2018", or "unknown")`;
  }
  if (draft.price === null && !draft.priceAcknowledgedUnknown) {
    deps.addgearState.set(chatId, { kind: 'awaiting-price', draft });
    return `What did you pay? (number, or "unknown")`;
  }
  // ... rest unchanged
}
```

Replace the stub `continueAddgear` body in `apps/bot/commands/addgear.ts` with:

```typescript
export async function continueAddgear(
  chatId: string,
  text: string,
  deps: AddgearDeps,
): Promise<string | null> {
  const step = deps.addgearState.peek(chatId);
  if (!step) return null;

  const reply = text.trim();

  if (step.kind === 'awaiting-date') {
    const yearMatch = reply.match(/^(\d{4})$/);
    const fullDateMatch = reply.match(/^\d{4}-\d{2}-\d{2}$/);
    if (yearMatch) {
      step.draft.date = `${yearMatch[1]}-01-01`;
    } else if (fullDateMatch) {
      step.draft.date = reply;
    } else if (/^unknown$/i.test(reply)) {
      step.draft.dateAcknowledgedUnknown = true;
    } else {
      return `Couldn't read that as a date. Reply with a year like "2018", a full date "2018-06-15", or "unknown".`;
    }
    return advanceFlow(chatId, step.draft, deps);
  }

  return null;
}
```

Update the existing happy-path test's `extractFromPhoto` mock to also work — it doesn't set the acknowledged flags, but since `extractFromPhoto` is mocked at the test level via `makeDeps`, and `startAddgear` sets the flags itself, this is fine. Update `makeDeps` test helper to include the flags wherever it constructs a `PartialDraft` (it doesn't — `PartialDraft`s are constructed inside `startAddgear`, not in the test).

- [ ] **Step 8: Run tests, confirm all green**

```bash
npx vitest run tests/apps/bot/addgear.test.ts tests/lib/addgearState.test.ts
```
Expected: PASS. If the existing `addgearState.test.ts` fails because the `PartialDraft` shape changed, update those test fixtures to include `dateAcknowledgedUnknown: false, priceAcknowledgedUnknown: false`.

- [ ] **Step 9: Add price-step tests + impl**

Append to `tests/apps/bot/addgear.test.ts`:

```typescript
describe('startAddgear — missing price triggers prompt after date', () => {
  test('user replies with a price and flow advances to confirm', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    await continueAddgear('chat-1', '2018', deps);
    const reply = await continueAddgear('chat-1', '120', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.price).toBe(120);
      expect(step.row.source).toBe('Image');
      expect(step.row.orderId).toMatch(/^IMG-20260514-/);
    }
  });

  test('user replies "unknown" for price and flow advances to confirm', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    await continueAddgear('chat-1', '2018', deps);
    const reply = await continueAddgear('chat-1', 'unknown', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.price).toBe(0);
    }
  });
});
```

Add to `continueAddgear` after the `awaiting-date` branch:

```typescript
  if (step.kind === 'awaiting-price') {
    if (/^unknown$/i.test(reply)) {
      step.draft.priceAcknowledgedUnknown = true;
    } else {
      const n = Number(reply.replace(/^\$/, ''));
      if (!Number.isFinite(n) || n < 0) {
        return `Couldn't read that as a price. Reply with a number like "120" or "unknown".`;
      }
      step.draft.price = n;
    }
    return advanceFlow(chatId, step.draft, deps);
  }
```

- [ ] **Step 10: Run tests, confirm pass**

```bash
npx vitest run tests/apps/bot/addgear.test.ts
```
Expected: PASS.

- [ ] **Step 11: Add dedup-match tests + impl**

Append to `tests/apps/bot/addgear.test.ts`:

```typescript
describe('startAddgear — fuzzy dedup match', () => {
  test('warns when a similar row exists', async () => {
    const deps = makeDeps({
      listExistingRows: () => [{ brand: 'Patagonia', itemName: 'Houdini Jacket' }],
    });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    expect(reply).toMatch(/similar to existing rows/i);
    expect(reply).toContain('Patagonia');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-dedup');
  });

  test('user replies "add anyway" and flow advances to confirm', async () => {
    const deps = makeDeps({
      listExistingRows: () => [{ brand: 'Patagonia', itemName: 'Houdini Jacket' }],
    });
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'add anyway', deps);
    expect(reply).toMatch(/About to log/i);
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
  });
});
```

Add to `continueAddgear`:

```typescript
  if (step.kind === 'awaiting-dedup') {
    if (/^add anyway$/i.test(reply)) {
      // Bypass fuzzy check: build the row directly.
      const hash = makeHash([
        step.draft.brand, step.draft.itemName, step.draft.color, step.draft.size, String(Date.now()),
      ]);
      const orderId = makeOrderId(deps.today(), hash);
      const row = rowFromDraft(step.draft, deps.today(), orderId);
      deps.addgearState.set(chatId, { kind: 'awaiting-confirm', row });
      return previewRow(row);
    }
    return `Reply 'add anyway' to log this as new, or /cancel.`;
  }
```

- [ ] **Step 12: Run tests, confirm pass**

```bash
npx vitest run tests/apps/bot/addgear.test.ts
```
Expected: PASS.

- [ ] **Step 13: Add confirm + field-correction + cancel tests + impl**

Append to `tests/apps/bot/addgear.test.ts`:

```typescript
describe('continueAddgear — confirm, correct, cancel', () => {
  test('"yes" parks the row in pendingActions and clears addgearState', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'yes', deps);
    expect(reply).toMatch(/Reply \/confirm to write/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
    expect(deps.pendingActions.peek('chat-1')).not.toBeNull();
  });

  test('"color: red" patches the draft and re-shows', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear ~2018 ~$120', deps);
    const reply = await continueAddgear('chat-1', 'color: red', deps);
    expect(reply).toContain('red');
    const step = deps.addgearState.peek('chat-1');
    expect(step?.kind).toBe('awaiting-confirm');
    if (step?.kind === 'awaiting-confirm') {
      expect(step.row.color).toBe('red');
    }
  });

  test('"/cancel" clears the state', async () => {
    const deps = makeDeps();
    await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    const reply = await continueAddgear('chat-1', '/cancel', deps);
    expect(reply).toMatch(/cancelled/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
  });
});
```

Add to `continueAddgear`, BEFORE the per-step branches:

```typescript
  // Universal: /cancel exits any step.
  if (/^\/?cancel$/i.test(reply)) {
    deps.addgearState.clear(chatId);
    return `Cancelled. Nothing was written.`;
  }
```

Add to `continueAddgear`, at the END (after all other branches):

```typescript
  if (step.kind === 'awaiting-confirm') {
    if (/^yes$/i.test(reply) || /^\/?confirm$/i.test(reply)) {
      deps.pendingActions.set(chatId, { type: 'log-append', row: step.row });
      deps.addgearState.clear(chatId);
      return `Reply /confirm to write the row, or /cancel to discard.`;
    }
    const fieldMatch = reply.match(/^([a-zA-Z][a-zA-Z\s\-]*?)\s*:\s*(.+)$/);
    if (fieldMatch) {
      const field = fieldMatch[1]!.trim().toLowerCase();
      const value = fieldMatch[2]!.trim();
      const updated: MasterRow = { ...step.row };
      switch (field) {
        case 'brand':       updated.brand = value; break;
        case 'item':
        case 'item name':   updated.itemName = value; break;
        case 'color':       updated.color = value; break;
        case 'size':        updated.size = value; break;
        case 'price':       updated.price = Number(value.replace(/^\$/, '')); break;
        case 'date':        updated.date = value; updated.year = value.slice(0, 4); break;
        case 'category':    updated.category = value; break;
        case 'subcategory':
        case 'sub-category':updated.subCategory = value; break;
        case 'domain':      updated.domain = value as Domain; break;
        case 'type':        updated.type = value as ItemType; break;
        default:
          return `Unknown field "${field}". Try: brand, item, color, size, price, date, category, sub-category, domain, type. Or reply 'yes' / /cancel.`;
      }
      deps.addgearState.set(chatId, { kind: 'awaiting-confirm', row: updated });
      return previewRow(updated);
    }
    return `Reply 'yes' to write, 'field: value' to change something, or /cancel.`;
  }
```

Important: the "yes" path delegates to `/confirm` via `PendingActionStore`, matching the existing `/log` pattern. This is a deliberate choice — the spec said "yes" triggers the write, but reusing the existing terminal path is safer and `/confirm` is one more message Tom must send. Alternative: write directly from "yes". We'll do the simpler "yes parks, /confirm writes" for now; the design doc's note "Show full proposed row → PendingActionStore parks it → 'yes' → sheets.append" can be tightened to match in a later iteration if Tom wants a single-step confirm. Note this tradeoff in the commit message.

- [ ] **Step 14: Run tests, confirm pass**

```bash
npx vitest run tests/apps/bot/addgear.test.ts
```
Expected: PASS.

- [ ] **Step 15: Add error-path tests + impl (vision returns nothing)**

Append:

```typescript
describe('startAddgear — vision can't read', () => {
  test('returns a helpful error and does not set state', async () => {
    const deps = makeDeps({
      extractFromPhoto: vi.fn(async () => ({
        brand: '', itemName: '', color: '', size: '',
        confidence: { brand: 'missing', itemName: 'missing', color: 'missing', size: 'missing' } as const,
      })),
    });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    expect(reply).toMatch(/couldn't read/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
  });

  test('returns a helpful error when vision call itself returns null', async () => {
    const deps = makeDeps({
      extractFromPhoto: vi.fn(async () => null),
    });
    const reply = await startAddgear('chat-1', 'FILE-1', '/addgear', deps);
    expect(reply).toMatch(/couldn't read/i);
    expect(deps.addgearState.peek('chat-1')).toBeNull();
  });
});
```

Implementation already covers this branch (`startAddgear` returns early when `!extraction || (!extraction.brand && !extraction.itemName)`). Should pass.

- [ ] **Step 16: Run all tests, confirm pass**

```bash
npx vitest run tests/apps/bot/addgear.test.ts
```
Expected: PASS across all test cases.

- [ ] **Step 17: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS.

- [ ] **Step 18: Commit**

```bash
git add apps/bot/commands/addgear.ts tests/apps/bot/addgear.test.ts lib/addgearState.ts tests/lib/addgearState.test.ts
git commit -m "feat(addgear): state-machine command handler with vision + fuzzy dedup

Implements the /addgear flow:
- vision extracts brand/item/color/size from the photo
- serially prompts for missing date and price (one field per turn)
- fuzzy-matches against existing inventory and warns before writing
- 'yes' parks the row in PendingActionStore; existing /confirm writes it
- 'field: value' patches the draft pre-confirm
- /cancel exits cleanly at any step

The yes-then-/confirm two-step matches the existing /log flow rather
than direct-write-on-yes. We can tighten this to single-step later if
the extra confirm is friction."
```

---

## Task 7: Wire `/addgear` into the bot's command parser, router, and message loop

**Files:**
- Modify: `apps/bot/commands/parse.ts`
- Modify: `apps/bot/handlers.ts`
- Modify: `apps/bot/router.ts`
- Modify: `apps/bot/index.ts`
- Test: `tests/apps/bot/router.test.ts` (extend if it exists) or new file

- [ ] **Step 1: Add `'addgear'` to `CommandName` in `apps/bot/commands/parse.ts`**

Edit `apps/bot/commands/parse.ts`:

```typescript
export type CommandName =
  | 'log'
  | 'addgear'
  | 'lost'
  | 'sold'
  | 'donated'
  | 'retired'
  | 'broken'
  | 'confirm'
  | 'cancel'
  | 'stats'
  | 'refresh';

const KNOWN: readonly CommandName[] = [
  'log', 'addgear', 'lost', 'sold', 'donated', 'retired', 'broken', 'confirm', 'cancel', 'stats', 'refresh',
];
```

- [ ] **Step 2: Extend `HandlerDeps` and `dispatchCommand` in `apps/bot/handlers.ts`**

Top of file, add imports:

```typescript
import { startAddgear, continueAddgear, type AddgearDeps } from './commands/addgear.js';
import { AddgearStateStore } from '../../lib/addgearState.js';
```

Add to `HandlerDeps`:

```typescript
  addgearState: AddgearStateStore;
  startAddgear: typeof startAddgear;
  continueAddgear: typeof continueAddgear;
  addgearInner: Omit<AddgearDeps, 'addgearState' | 'pendingActions' | 'today'>;
```

The `addgearInner` field carries the vision/classify/download/list deps so `index.ts` wires them once and `handlers.ts` composes them at call time. This keeps the bigger story (`addgearState`, `pendingActions`, `today`) flowing through the same `HandlerDeps` pipe the rest of the bot uses.

Modify `handleCancel` so it also clears addgear state:

```typescript
async function handleCancel(chatId: string, deps: HandlerDeps): Promise<string> {
  const hadPending = deps.pendingActions.peek(chatId);
  const hadAddgear = deps.addgearState.peek(chatId);
  if (!hadPending && !hadAddgear) return `Nothing to cancel.`;
  deps.pendingActions.clear(chatId);
  deps.addgearState.clear(chatId);
  return `Cancelled.`;
}
```

Add a text-mode entry point (text-only `/addgear ...` without a photo isn't supported — we reply with a usage hint):

In `dispatchCommand`, add before the `return null`:

```typescript
  if (name === 'addgear') return `Send a photo of the gear with the caption "/addgear [optional notes]". A photo is required.`;
```

- [ ] **Step 3: Add `handlePhoto` to handlers.ts (called from router for photo updates)**

Add at the bottom of `handlers.ts`:

```typescript
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
```

- [ ] **Step 4: Extend `RouterDeps` and `routeMessage` in `apps/bot/router.ts`**

Replace the file with:

```typescript
export interface RouterDeps {
  dispatchCommand: (chatId: string, text: string) => Promise<string | null>;
  handleAddgearContinuation: (chatId: string, text: string) => Promise<string | null>;
  handleAgentMessage: (chatId: string, text: string) => Promise<string>;
  handlePhoto: (chatId: string, photoFileId: string, caption: string) => Promise<string | null>;
}

const GENERIC_ERROR = "Sorry — something went wrong handling that. The error has been logged. Try again in a moment.";

export async function routeMessage(chatId: string, text: string, deps: RouterDeps): Promise<string> {
  try {
    // /cancel and other commands take precedence over an in-flight addgear flow
    const slashReply = await deps.dispatchCommand(chatId, text);
    if (slashReply !== null) return slashReply;

    // Mid-flow addgear continuation (plain-text replies like "2018" or "color: red")
    const addgearReply = await deps.handleAddgearContinuation(chatId, text);
    if (addgearReply !== null) return addgearReply;

    return await deps.handleAgentMessage(chatId, text);
  } catch (err) {
    console.error(`[router] error handling message from ${chatId}:`, err instanceof Error ? err.stack ?? err.message : err);
    return GENERIC_ERROR;
  }
}

export async function routePhoto(
  chatId: string,
  photoFileId: string,
  caption: string,
  deps: RouterDeps,
): Promise<string> {
  try {
    const reply = await deps.handlePhoto(chatId, photoFileId, caption);
    if (reply !== null) return reply;
    return `Got a photo, but I only know what to do with photos captioned "/addgear". Send /help for options.`;
  } catch (err) {
    console.error(`[router] photo error from ${chatId}:`, err instanceof Error ? err.stack ?? err.message : err);
    return GENERIC_ERROR;
  }
}
```

- [ ] **Step 5: Wire everything up in `apps/bot/index.ts`**

In `apps/bot/index.ts`:

(a) Add imports near the top:

```typescript
import { AddgearStateStore } from '../../lib/addgearState.js';
import { startAddgear, continueAddgear } from './commands/addgear.js';
import { extractFromPhoto } from '../../lib/parsers/photo.js';
import { createClassifier } from '../../lib/classifier.js';
import { getFile, downloadFile, sendMessage, getUpdates, type TelegramConfig } from '../../lib/telegram.js';
import { routeMessage, routePhoto } from './router.js';
import { dispatchCommand, handlePhoto, handleAddgearContinuation, type HandlerDeps } from './handlers.js';
```

(b) In `main()`, after `pendingActions` is created, instantiate the addgear store and classifier. `InventoryCache` does not expose vocab today, so we call `buildVocab` once at startup. (Vocab evolves slowly — new brands trickle in over weeks — so refreshing it on every bot restart is fine.)

Add the import at the top of `apps/bot/index.ts`:

```typescript
import { buildVocab } from '../../lib/sheets.js';
import { createClassifier } from '../../lib/classifier.js';
```

Then in `main()`:

```typescript
  const addgearState = new AddgearStateStore({ ttlMs: 5 * 60 * 1000 });

  const vocab = await buildVocab(sheets, env.spreadsheetId);
  const classifyFn = createClassifier({ vocab, anthropic });
```

(c) Extend the `handlerDeps` object:

```typescript
  const handlerDeps: HandlerDeps = {
    cache,
    stats,
    pendingActions,
    addgearState,
    sheets,
    spreadsheetId: env.spreadsheetId,
    anthropic,
    updateRowStatus,
    appendMasterRow,
    extractLogDraft,
    startAddgear,
    continueAddgear,
    addgearInner: {
      downloadPhoto: async (fileId: string) => {
        const f = await getFile(telegramCfg, fileId);
        return downloadFile(telegramCfg, f.file_path!);
      },
      extractFromPhoto: (bytes, caption) => extractFromPhoto(anthropic, bytes, caption),
      classify: (input) => classifyFn({ itemName: `${input.brand} ${input.itemName}`.trim(), source: 'Image' }),
      listExistingRows: () => cache.getSnapshot().map((r) => ({ brand: r.brand, itemName: r.itemName })),
      randomHash: () => Math.random().toString(36).slice(2, 10),
    },
    today: () => formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd'),
  };
```

(d) Extend the `routerDeps` object:

```typescript
  const routerDeps = {
    dispatchCommand: (chatId: string, text: string) => dispatchCommand(chatId, text, handlerDeps),
    handleAddgearContinuation: (chatId: string, text: string) => handleAddgearContinuation(chatId, text, handlerDeps),
    handleAgentMessage: (chatId: string, text: string) => agent.handleMessage(chatId, text),
    handlePhoto: (chatId: string, photoFileId: string, caption: string) => handlePhoto(chatId, photoFileId, caption, handlerDeps),
  };
```

(e) In the polling loop, replace the `if (!msg?.text) continue` block so photos route to `routePhoto`. Replace lines 123–157 (the message-handling block) with:

```typescript
      for (const update of updates) {
        offset = update.update_id + 1;
        const msg = update.message ?? update.edited_message;
        if (!msg) continue;
        const chatId = String(msg.chat.id);
        if (!env.authorizedChatIds.has(chatId)) {
          console.warn(`[bot] rejected message from unauthorized chat ${chatId}`);
          continue;
        }

        let reply: string;
        if (msg.photo && msg.photo.length > 0) {
          const largest = msg.photo[msg.photo.length - 1]!;
          const caption = msg.caption ?? '';
          console.log(`[bot] ${chatId} -> [photo file_id=${largest.file_id} caption="${caption.slice(0, 60)}"]`);
          try {
            reply = await routePhoto(chatId, largest.file_id, caption, routerDeps);
          } catch (err) {
            console.error(`[bot] photo handling failed for ${chatId}:`, err instanceof Error ? err.stack ?? err.message : err);
            continue;
          }
        } else if (msg.text) {
          const text = msg.text;
          console.log(`[bot] ${chatId} -> "${text.slice(0, 80)}"`);
          reply = await routeMessage(chatId, text, routerDeps);
        } else {
          continue;
        }

        try {
          await sendMessage(telegramCfg, {
            chat_id: chatId,
            text: reply,
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
          });
        } catch (mdErr) {
          console.warn(
            `[bot] markdown send failed for ${chatId}, retrying as plain text:`,
            mdErr instanceof Error ? mdErr.message : mdErr,
          );
          await sendMessage(telegramCfg, { chat_id: chatId, text: reply });
        }
        console.log(`[bot] ${chatId} <- "${reply.slice(0, 80)}"`);
      }
```

- [ ] **Step 6: Verify the classifier signature matches the `addgearInner.classify` shape**

Open `lib/classifier.ts`. Inspect what `createClassifier({ vocab, anthropic })` returns — is it `(input: ClassifyInput) => Promise<Classification>`? If yes, the lambda above (`(input) => classifyFn({ itemName: ..., source: 'Image' })`) compiles. If `Source` doesn't include `'Image'` in the classifier's `Source` type (it now does, after Task 1), confirm by running typecheck. If the classifier's prompt rejects `Source = 'Image'`, pass `'Other'` instead — this is a small Claude prompt detail not a structural issue.

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: PASS. If errors, follow the compile messages — they'll be specific.

- [ ] **Step 7: Build the project**

```bash
npm run build
```
Expected: PASS. If `tsconfig.build.json` has different settings, run via that file:
```bash
npx tsc -p tsconfig.build.json
```

- [ ] **Step 8: Run all tests**

```bash
npx vitest run
```
Expected: PASS across all suites.

- [ ] **Step 9: Commit**

```bash
git add apps/bot/commands/parse.ts apps/bot/handlers.ts apps/bot/router.ts apps/bot/index.ts
git commit -m "feat(bot): route /addgear photo captions to capture flow

- Adds /addgear to CommandName so the parser recognizes it
- Extends HandlerDeps with AddgearStateStore + addgearInner helpers
- /cancel now clears both pendingActions and addgearState
- Router intercepts plain-text replies while addgear state is active
- Bot loop now handles msg.photo and dispatches to routePhoto"
```

---

## Task 8: Manual acceptance + Google Sheet dropdown update

This task is gated on the previous tasks landing. It produces no code; it confirms the feature works end-to-end on Tom's actual sheet, bot, and phone.

- [ ] **Step 1: Add `Image` to the Sheet's `Source` column data-validation dropdown**

In Google Sheets UI:
1. Open the `All Purchases` tab.
2. Select column with header `Source`.
3. `Data` → `Data validation` → edit the existing rule's value list to add `Image`.
4. Save.

- [ ] **Step 2: Deploy the bot to Railway**

```bash
git push origin main
```
Wait for the bot service to redeploy. Confirm in Railway dashboard that the new commit is live.

- [ ] **Step 3: Acceptance test — happy path (vision fills everything)**

Send a clear photo of a known piece of gear (a Patagonia layer with visible tag) to the bot, caption `/addgear ~2018 ~$120`.

Expected:
- Bot replies `About to log: Patagonia <product> ...`
- Tom replies `yes`
- Bot replies `Reply /confirm to write the row, or /cancel to discard.`
- Tom replies `/confirm`
- Bot replies `Logged: Patagonia <product> — $120.`
- New row in sheet: `Source = Image`, `Order ID = IMG-20260514-<hash>`, status `active`.

- [ ] **Step 4: Acceptance test — missing-field path**

Send a photo with no caption.

Expected:
- Bot extracts what it can, asks `When did you buy it?`
- Tom replies `2018`
- Bot asks `What did you pay?`
- Tom replies `120`
- Bot shows the proposed row.
- Tom replies `yes`, then `/confirm`. Row written.

- [ ] **Step 5: Acceptance test — fuzzy dedup**

Photograph a piece of gear that's already in the sheet (e.g., an email-ingested Patagonia R1).

Expected:
- After date/price prompts, bot replies `Looks similar to existing rows: 1. row N: Patagonia R1 ...`
- Tom replies `/cancel`. State drops. Nothing written.

- [ ] **Step 6: Acceptance test — `/cancel` mid-flow**

Send a photo, get the date prompt, reply `/cancel`.

Expected: `Cancelled. Nothing was written.` `addgearState` should now be clear.

- [ ] **Step 7: Acceptance test — field correction**

Walk a photo through to the confirm step. At the preview, reply `color: olive` (assuming the proposed row shows a different color).

Expected: bot re-shows the preview with `(olive, M)`.

- [ ] **Step 8: Verify the soak**

Inspect 3–4 rows added via `/addgear`. Confirm:
- Source column shows `Image`
- Order ID starts with `IMG-`
- Year column is populated when date was given (e.g., `2018`)
- Reasoning shows `captured via /addgear photo`
- The inventory cache in the bot picked up the new row (next `/stats` call shows updated count).

- [ ] **Step 9: Save a vision-test fixture and run the live vision test**

After the first successful acceptance run, save one of the gear photos as `tests/fixtures/photos/sample.jpg` and update its `*.expected.json` if you added one. Then:

```bash
RUN_VISION_TESTS=1 ANTHROPIC_API_KEY=... npx vitest run tests/parsers/photo.test.ts
```
Expected: PASS.

Commit the fixture (or NOT, depending on whether the photo contains anything you'd rather not check into git — common: just keep the expected json and don't commit the binary, add `tests/fixtures/photos/*.jpg` to `.gitignore`).

- [ ] **Step 10: Update DECISIONS.md**

Append a new entry:

```markdown
## 2026-05-14 — Image-sourced gear capture (`/addgear`)

**Decision:** Photo-captured gear lands in the sheet via a new Telegram `/addgear` flow. Source = `Image`, Order ID = `IMG-<YYYYMMDD>-<6hex>`. Vision (Sonnet 4.6) extracts brand/item/color/size; bot conversationally fills date and price; fuzzy match warns before duplicates; final write uses the existing `PendingActionStore` + `/confirm` terminal step shared with `/log`.

**Why:** Email-ingestion only captures online orders. In-store purchases, gifts, and gear owned pre-ingestion need a low-friction backfill path. ~5–20 items lifetime; one-at-a-time Telegram capture is sufficient.

**Tradeoffs:** "yes" parks the row and requires a second `/confirm` rather than writing immediately — matches `/log`'s flow exactly. Can tighten to single-step if Tom finds the extra confirm noisy.
```

- [ ] **Step 11: Commit**

```bash
git add DECISIONS.md
git commit -m "docs(decisions): record /addgear image-capture decision"
```

---

## Self-review

After completing all tasks, verify against the spec (`docs/superpowers/specs/2026-05-14-image-gear-capture-design.md`):

| Spec requirement | Task |
|---|---|
| Photo + `/addgear` caption triggers flow | Task 7 (routing) + Task 6 (entry point) |
| Vision extracts brand/item/color/size | Task 5 |
| Bot prompts for missing date/price serially | Task 6 |
| Fuzzy dedup warns before write | Task 2 + Task 6 |
| `Source = Image`, `Order ID = IMG-<date>-<hash>` | Task 1 + Task 6 |
| `/cancel` clears state | Task 6 + Task 7 |
| Per-state TTL expiry | Task 4 (`AddgearStateStore`) |
| Sheet append failure → user can retry | Inherited from existing `/log` + `/confirm` (the row stays in `PendingActionStore`; if the write fails inside `handleConfirm`, the error message propagates and the action is gone — **note:** the existing `/log` flow does NOT retry on append failure. The spec's "retry" UX is therefore not fully implemented; we rely on the user to re-send the photo. Add this as a follow-up if it bites.) |
| Vision tests live-skip by default | Task 5 |
| `Image` added to Sheet dropdown | Task 8 |
