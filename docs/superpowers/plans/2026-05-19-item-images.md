# Item Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add product images to every inventory row — surfaced in the web detail panel, populated automatically on cron ingest (email-extract + AI fallback), backfillable for ~1500 existing rows, and manually attachable via Telegram `/addgear` and the web upload affordance.

**Architecture:** Images live on the Railway `/data` volume at `/data/images/<imageId>.<ext>`. A new `Image` sheet column stores the relative path. Ingest pipeline gets a `resolveImage()` step: email-extracted URL first, Sonnet+`web_search` lookup second, `/addgear` photo bytes if Telegram-sourced. Persistent URL cache keeps re-runs free. Web UI gains a single API route for upload; `/addgear` fuzzy-match grows Attach/Replace branches.

**Tech Stack:** Node 20, TypeScript, vitest, cheerio, `@anthropic-ai/sdk`, googleapis, Next.js 14 App Router, node-telegram-bot-api.

---

## Pre-flight reading

Before starting, the engineer should skim:
- `docs/superpowers/specs/2026-05-19-item-images-design.md` — the locked design.
- `CLAUDE.md` — the project's "golden rule" and architecture rules.
- `lib/dispersed/url-cache.ts` + `lib/parsers/rei-product-lookup.ts` — the patterns this plan mirrors.
- `apps/cron/pipeline.ts:254-297` — where `resolveImage()` plugs in.
- `app/components/detail-panel.tsx` (on `main` branch — current branch `phase-7-photography` has not merged it yet).

**Branch note:** This work should branch from `main` (which has the detail panel). Current working branch `phase-7-photography` is for a different feature.

---

## Phase 1 — Storage primitive + schema (foundation)

No user-visible behavior. Adds the column, the type field, and the file-system helper. After this phase, ingest still writes blank `Image` for every row, but the plumbing exists.

### Task 1: Add `image` field to `MasterRow` type

**Files:**
- Modify: `lib/types.ts:43-68`

- [ ] **Step 1: Edit the type**

```typescript
export interface MasterRow {
  year: string;
  date: string;
  category: string;
  subCategory: string;
  brand: string;
  itemName: string;
  color: string;
  size: string;
  qty: number;
  price: number;
  source: Source;
  orderId: string;
  status: Status;
  domain: Domain;
  productUrl: string;
  type: ItemType;
  reasoning: string;
  notes: string;
  /**
   * Relative path to the stored product image (e.g. `/images/<id>.jpg`),
   * or empty string when no image has been resolved. Served by the web
   * service from the Railway `/data/images/` mount.
   */
  image: string;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: Many errors — every `MasterRow` literal missing `image`. Note them; the next tasks fix them.

- [ ] **Step 3: Commit (red state — typecheck broken)**

```bash
git add lib/types.ts
git commit -m "feat(types): add image field to MasterRow (typecheck red, fixed next)"
```

### Task 2: Add `'Image'` to `MASTER_HEADERS` + `FIELD_TO_HEADER`

**Files:**
- Modify: `lib/sheets.ts:64-83` and `lib/sheets.ts:398-417`

- [ ] **Step 1: Append to `HEADERS`**

In `lib/sheets.ts:64-83`, replace the const so it ends with `'Image'`:

```typescript
const HEADERS = [
  'Year',
  'Date Purchased',
  'Category',
  'Sub-Category',
  'Brand',
  'Item Name',
  'Color',
  'Size',
  'Qty',
  'Price (Paid)',
  'Source',
  'Order ID',
  'Status',
  'Domain',
  'Product URL',
  'Type',
  'Reasoning',
  'Notes',
  'Image',
] as const;
```

- [ ] **Step 2: Append to `FIELD_TO_HEADER` map (lib/sheets.ts:398-417)**

Add `['image', 'Image']` as the last entry of the `new Map([...])` literal.

- [ ] **Step 3: Find the `MasterRow` literal in `buildRowValues` (search for it)**

Run: `grep -n "buildRowValues\|year:\|notes:" lib/sheets.ts`

There's a row constructor (likely around `lib/sheets.ts:120-200`) that produces `MasterRow` values from sheet cells. Add an `image:` line reading from the `'Image'` column the same way the others read.

Concretely, the pattern looks like:
```typescript
notes: cell(map.get('Notes')),
image: cell(map.get('Image')) ?? '',
```

(Use whatever the existing helper for cell reads is — `cell()`, `getCell()`, or inline `row[col] ?? ''`.)

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: Errors in `MasterRow` literals — `apps/bot/commands/addgear.ts`, `scripts/import-history.ts`, `tests/`, etc.

- [ ] **Step 5: Fix every `MasterRow` literal that's missing `image`**

Find them all:
```bash
grep -rn "rows.push\|: MasterRow\|MasterRow = {" --include="*.ts" --include="*.tsx" . | grep -v node_modules | grep -v dist
```

For each, add `image: ''` next to `notes: …`.

- [ ] **Step 6: Run typecheck — must pass**

Run: `npm run typecheck`
Expected: PASS (zero errors).

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: All existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add -u
git commit -m "feat(sheets): add Image column to MASTER_HEADERS + MasterRow"
```

### Task 3: Update `scripts/bootstrap-sheet.ts` `EXPECTED_HEADERS`

**Files:**
- Modify: `scripts/bootstrap-sheet.ts:5-25`

The bootstrap script has its own `EXPECTED_HEADERS` array (independent of `MASTER_HEADERS` in lib). It must agree.

- [ ] **Step 1: Add `'Image'` as the last entry of `EXPECTED_HEADERS`**

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/bootstrap-sheet.ts
git commit -m "feat(bootstrap): add Image to EXPECTED_HEADERS"
```

### Task 4: Create `lib/integrations/image-storage.ts` — pure helpers + tests

**Files:**
- Create: `lib/integrations/image-storage.ts`
- Test: `tests/integrations/image-storage.test.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  imageId,
  saveItemImage,
  downloadAndSave,
} from '../../lib/integrations/image-storage.js';

const TMP_ROOT = join(tmpdir(), `image-storage-test-${process.pid}`);

beforeEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('imageId', () => {
  it('is deterministic from itemId', () => {
    expect(imageId('IMG-20260515-e42590')).toBe(imageId('IMG-20260515-e42590'));
  });

  it('differs across itemIds', () => {
    expect(imageId('A')).not.toBe(imageId('B'));
  });

  it('is safe for use as a filename (no slashes, no spaces)', () => {
    const id = imageId('A123/with spaces');
    expect(id).not.toMatch(/[\/\s]/);
  });
});

describe('saveItemImage', () => {
  it('writes bytes to /<root>/images/<imageId>.<ext>', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff]); // JPEG SOI
    const result = await saveItemImage('IMG-1', bytes, 'image/jpeg', TMP_ROOT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe(`/images/${imageId('IMG-1')}.jpg`);
    const onDisk = await readFile(join(TMP_ROOT, 'images', `${imageId('IMG-1')}.jpg`));
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it('rejects too-large input (>10MB)', async () => {
    const bytes = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    const result = await saveItemImage('IMG-2', bytes, 'image/jpeg', TMP_ROOT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('too_large');
  });

  it('rejects unsupported media types', async () => {
    const result = await saveItemImage(
      'IMG-3',
      Buffer.from([0]),
      'image/svg+xml' as 'image/jpeg',
      TMP_ROOT,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('bad_type');
  });

  it('overwrites existing file (idempotent re-save)', async () => {
    await saveItemImage('IMG-4', Buffer.from([1]), 'image/jpeg', TMP_ROOT);
    await saveItemImage('IMG-4', Buffer.from([2, 3]), 'image/jpeg', TMP_ROOT);
    const onDisk = await readFile(join(TMP_ROOT, 'images', `${imageId('IMG-4')}.jpg`));
    expect(onDisk.length).toBe(2);
    expect(onDisk[0]).toBe(2);
  });
});

describe('downloadAndSave', () => {
  it('rejects bad content-type from a real fetch', async () => {
    // Stub global fetch
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('not-an-image', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    try {
      const result = await downloadAndSave('IMG-5', 'https://example.com/x', TMP_ROOT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('bad_type');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('downloads and saves on success', async () => {
    const payload = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(payload, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    try {
      const result = await downloadAndSave('IMG-6', 'https://example.com/x.jpg', TMP_ROOT);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const st = await stat(join(TMP_ROOT, 'images', `${imageId('IMG-6')}.jpg`));
      expect(st.size).toBe(payload.length);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns fetch_failed on non-200', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('', { status: 404 });
    try {
      const result = await downloadAndSave('IMG-7', 'https://example.com/x', TMP_ROOT);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('fetch_failed');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
```

- [ ] **Step 2: Run test — must FAIL**

Run: `npx vitest run tests/integrations/image-storage.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `lib/integrations/image-storage.ts`**

```typescript
import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/webp';
export type ImageStorageError = 'fetch_failed' | 'bad_type' | 'too_large';

export type ImageStorageResult =
  | { ok: true; path: string }
  | { ok: false; error: ImageStorageError };

const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;

const EXT_BY_TYPE: Record<SupportedMediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Default storage root. Production = Railway volume `/data`; dev/test = local
 * fallback. Most callers pass an explicit root (the cron and bot do); the API
 * route reads from process.env.IMAGE_STORAGE_ROOT.
 */
export const DEFAULT_STORAGE_ROOT =
  process.env.IMAGE_STORAGE_ROOT ?? './local-data';

/**
 * Deterministic short filename derived from itemId. Re-ingest of the same row
 * overwrites the same file, so we don't accumulate stale variants.
 */
export function imageId(itemId: string): string {
  return createHash('sha1').update(itemId).digest('hex').slice(0, 16);
}

function isSupportedMediaType(t: string): t is SupportedMediaType {
  return t === 'image/jpeg' || t === 'image/png' || t === 'image/webp';
}

export async function saveItemImage(
  itemId: string,
  bytes: Buffer,
  mediaType: SupportedMediaType,
  root: string = DEFAULT_STORAGE_ROOT,
): Promise<ImageStorageResult> {
  if (!isSupportedMediaType(mediaType)) return { ok: false, error: 'bad_type' };
  if (bytes.length > MAX_BYTES) return { ok: false, error: 'too_large' };

  const id = imageId(itemId);
  const ext = EXT_BY_TYPE[mediaType];
  const dir = join(root, 'images');
  await mkdir(dir, { recursive: true });

  const finalPath = join(dir, `${id}.${ext}`);
  const tmp = `${finalPath}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, finalPath);

  return { ok: true, path: `/images/${id}.${ext}` };
}

export async function downloadAndSave(
  itemId: string,
  url: string,
  root: string = DEFAULT_STORAGE_ROOT,
): Promise<ImageStorageResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, { signal: ac.signal });
  } catch {
    clearTimeout(timer);
    return { ok: false, error: 'fetch_failed' };
  }
  clearTimeout(timer);

  if (!resp.ok) return { ok: false, error: 'fetch_failed' };

  const contentType = (resp.headers.get('content-type') ?? '')
    .split(';')[0]
    ?.trim()
    .toLowerCase() as SupportedMediaType;
  if (!isSupportedMediaType(contentType)) return { ok: false, error: 'bad_type' };

  const buf = Buffer.from(await resp.arrayBuffer());
  return saveItemImage(itemId, buf, contentType, root);
}
```

- [ ] **Step 4: Run test — must PASS**

Run: `npx vitest run tests/integrations/image-storage.test.ts`
Expected: PASS (all 9 specs).

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/image-storage.ts tests/integrations/image-storage.test.ts
git commit -m "feat(integrations): image-storage primitive with save + download"
```

---

## Phase 2 — Parser extensions (email image extraction)

Extends parsers to extract product image URLs alongside item metadata. After this phase, parsers emit `imageUrl` per item but the cron doesn't yet use it.

### Task 5: Add `imageUrl` to `ParsedItem`

**Files:**
- Modify: `lib/parsers/types.ts`

- [ ] **Step 1: Update the interface**

```typescript
export interface ParsedItem {
  itemName: string;
  brand?: string;
  color?: string;
  size?: string;
  quantity: number;
  price: number;
  productUrl: string;
  /** Product image URL extracted from email HTML; empty/undefined when the
   *  parser couldn't find one. The cron's `resolveImage` falls back to AI
   *  lookup when this is missing. */
  imageUrl?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (optional field, no required-key breakage).

- [ ] **Step 3: Commit**

```bash
git add lib/parsers/types.ts
git commit -m "feat(parsers): add optional imageUrl to ParsedItem"
```

### Task 6: REI parser — extract product `<img src>`

**Files:**
- Modify: `lib/parsers/rei.ts:87-142` (`parseReiEmail`) and `lib/parsers/rei.ts:27-85` (`parseReiReceiptEmail`)
- Test: `tests/parsers/rei-images.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseReiEmail, parseReiReceiptEmail } from '../../lib/parsers/rei.js';

const FIXTURES = join(process.cwd(), 'tests/fixtures');

function loadOneFixture(prefix: string): string {
  const file = readdirSync(FIXTURES).find((f) => f.startsWith(prefix) && f.endsWith('.html'));
  if (!file) throw new Error(`No fixture starting with ${prefix} found in ${FIXTURES}`);
  return readFileSync(join(FIXTURES, file), 'utf-8');
}

describe('parseReiEmail image extraction', () => {
  it('attaches an imageUrl pointing at images.rei.com/skuimage for each item', () => {
    const html = loadOneFixture('rei-shipment');
    const order = parseReiEmail(html);
    expect(order).not.toBeNull();
    expect(order!.items.length).toBeGreaterThan(0);
    for (const item of order!.items) {
      expect(item.imageUrl).toBeTruthy();
      expect(item.imageUrl).toMatch(/rei\.com\/.*skuimage/);
    }
  });
});

describe('parseReiReceiptEmail image extraction', () => {
  it('attaches an imageUrl per line item from the in-store eReceipt', () => {
    const html = loadOneFixture('rei-receipt');
    const order = parseReiReceiptEmail(html);
    expect(order).not.toBeNull();
    for (const item of order!.items) {
      expect(item.imageUrl).toBeTruthy();
      expect(item.imageUrl).toMatch(/rei\.com\/.*skuimage/);
    }
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

Run: `npx vitest run tests/parsers/rei-images.test.ts`
Expected: FAIL (`imageUrl` is undefined; fixture may or may not exist — confirm both fixtures exist with `ls tests/fixtures/ | grep rei`).

If the fixtures don't exist, capture them first: forward a recent REI shipment + receipt email to yourself, save the raw HTML to `tests/fixtures/rei-shipment-2026.html` and `tests/fixtures/rei-receipt-2026.html`.

- [ ] **Step 3: Implement in `parseReiEmail` (lib/rei.ts:87-142)**

Inside the `$('img[src*="rei.com/skuimage"]').each(...)` block, capture the src before the `items.push`:

```typescript
const imageUrl = ($img.attr('src') ?? '').trim();
items.push({ itemName, quantity, price, productUrl, color, size, imageUrl });
```

- [ ] **Step 4: Implement in `parseReiReceiptEmail` (lib/rei.ts:42-75)**

Same change inside the `.each` block — capture `imageUrl` and include it in the `byProductId.set` value:

```typescript
const imageUrl = ($img.attr('src') ?? '').trim();
byProductId.set(itemId, {
  itemName,
  quantity,
  price,
  productUrl,
  color: '',
  size: '',
  imageUrl,
});
```

- [ ] **Step 5: Run the test — must PASS**

Run: `npx vitest run tests/parsers/rei-images.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full parser test suite to check no regressions**

Run: `npx vitest run tests/parsers/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/parsers/rei.ts tests/parsers/rei-images.test.ts
git commit -m "feat(parsers): extract product image URL from REI emails"
```

### Task 7: Amazon shipment parser — extract product `<img src>`

**Files:**
- Modify: `lib/parsers/amazon.ts` (the `parseAmazonShipmentEmail` IMG-iteration block, around line 58-66 in the file)
- Test: `tests/parsers/amazon-images.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAmazonShipmentEmail } from '../../lib/parsers/amazon.js';

const FIXTURES = join(process.cwd(), 'tests/fixtures');

function loadOneFixture(prefix: string): string {
  const file = readdirSync(FIXTURES).find((f) => f.startsWith(prefix) && f.endsWith('.html'));
  if (!file) throw new Error(`No fixture starting with ${prefix} found`);
  return readFileSync(join(FIXTURES, file), 'utf-8');
}

describe('parseAmazonShipmentEmail image extraction', () => {
  it('attaches a media-amazon image URL to each item', () => {
    const html = loadOneFixture('amazon-shipment');
    const orders = parseAmazonShipmentEmail(html);
    expect(orders).not.toBeNull();
    const allItems = (orders ?? []).flatMap((o) => o.items);
    expect(allItems.length).toBeGreaterThan(0);
    for (const item of allItems) {
      expect(item.imageUrl).toBeTruthy();
      expect(item.imageUrl).toMatch(/media-amazon\.com|images-amazon\.com/);
    }
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

Run: `npx vitest run tests/parsers/amazon-images.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit `parseAmazonShipmentEmail`**

In the `$('img[alt]').each` loop that populates `productImages`, also capture the `src`:

```typescript
const productImages: Array<{ alt: string; url: string; imageUrl: string }> = [];
$('img[alt]').each((_, el) => {
  const alt = ($(el).attr('alt') ?? '').trim();
  if (alt.length < 30) return;
  if (alt.toLowerCase().includes('amazon.com')) return;
  const url = ($(el).closest('a').attr('href') ?? '').trim();
  const imageUrl = ($(el).attr('src') ?? '').trim();
  productImages.push({ alt, url, imageUrl });
});
```

Then, downstream where each `productImages` entry is converted to a `ParsedItem` (search `productImages[i]` or the loop that pairs IMG with price/qty), include `imageUrl: pi.imageUrl` in the item literal.

- [ ] **Step 4: Run the test — must PASS**

Run: `npx vitest run tests/parsers/amazon-images.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full parser suite — no regressions**

Run: `npx vitest run tests/parsers/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/parsers/amazon.ts tests/parsers/amazon-images.test.ts
git commit -m "feat(parsers): extract product image URL from Amazon shipment email"
```

### Task 8: Amazon order (Haiku) parser — extract per-line image URL

**Files:**
- Modify: `lib/parsers/amazon.ts` (the `parseAmazonOrderEmail` function — Haiku prompt + JSON parse)

The Haiku-driven order parser builds items by prompting Haiku. Extend its JSON schema to include `imageUrl` per line item.

- [ ] **Step 1: Locate the Haiku prompt**

Run: `grep -n "parseAmazonOrderEmail\|haiku\|HAIKU\|imageUrl" lib/parsers/amazon.ts`
Note the line where the system prompt is defined and where the JSON is parsed.

- [ ] **Step 2: Update the prompt**

Wherever the prompt enumerates fields (`brand, itemName, color, size, quantity, price, productUrl`), add `imageUrl` with this description:

```
"imageUrl": "<src of the product thumbnail IMG in this item's row; empty string if no IMG was present>"
```

- [ ] **Step 3: Update the JSON-parse code path**

Wherever the parsed JSON object is mapped to `ParsedItem`, include:
```typescript
imageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : undefined,
```

- [ ] **Step 4: Smoke test against a real fixture**

Run: `npx vitest run tests/parsers/` (or whatever covers the Haiku path).
Expected: PASS.

If there's no existing test for `parseAmazonOrderEmail`, skip new test creation here — this code path is exercised end-to-end via the cron pipeline. The fix is small (one prompt line + one map line) and parser test coverage for the Haiku path was historically minimal.

- [ ] **Step 5: Commit**

```bash
git add lib/parsers/amazon.ts
git commit -m "feat(parsers): extract per-item imageUrl from Amazon order (Haiku)"
```

---

## Phase 3 — AI image lookup + persistent cache

### Task 9: Create `lib/integrations/image-url-cache.ts` (mirror dispersed/url-cache.ts)

**Files:**
- Create: `lib/integrations/image-url-cache.ts`
- Test: `tests/integrations/image-url-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readImageUrlCache,
  writeImageUrlCache,
  lookupCachedImageUrl,
  recordImageResolution,
} from '../../lib/integrations/image-url-cache.js';

const TMP_ROOT = join(tmpdir(), `image-url-cache-test-${process.pid}`);
const CACHE_PATH = join(TMP_ROOT, 'image-url-cache.json');

beforeEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('image url cache', () => {
  it('returns empty cache when file does not exist', async () => {
    const c = await readImageUrlCache(CACHE_PATH);
    expect(c.size).toBe(0);
  });

  it('round-trips canonical entries', async () => {
    const c = await readImageUrlCache(CACHE_PATH);
    recordImageResolution(c, 'patagonia|nano puff jacket', 'https://example.com/x.jpg', new Date());
    await writeImageUrlCache(CACHE_PATH, c);
    const c2 = await readImageUrlCache(CACHE_PATH);
    const hit = lookupCachedImageUrl(c2, 'patagonia|nano puff jacket', new Date());
    expect(hit.hit).toBe(true);
    expect(hit.url).toBe('https://example.com/x.jpg');
  });

  it('honors tried-null for 30 days, then expires', async () => {
    const c = await readImageUrlCache(CACHE_PATH);
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    recordImageResolution(c, 'patagonia|unicorn slippers', null, longAgo);
    const stale = lookupCachedImageUrl(c, 'patagonia|unicorn slippers', new Date());
    expect(stale.hit).toBe(false);

    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    recordImageResolution(c, 'patagonia|other', null, recent);
    const fresh = lookupCachedImageUrl(c, 'patagonia|other', new Date());
    expect(fresh.hit).toBe(true);
    expect(fresh.url).toBeNull();
  });
});
```

- [ ] **Step 2: Run — must FAIL**

Run: `npx vitest run tests/integrations/image-url-cache.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement (model on `lib/dispersed/url-cache.ts`)**

```typescript
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type ImageUrlCacheStatus = 'canonical' | 'tried-null';

export interface ImageUrlCacheEntry {
  url: string | null;
  resolvedAt: string;
  status: ImageUrlCacheStatus;
}

export type ImageUrlCache = Map<string, ImageUrlCacheEntry>;

export const NULL_RETRY_TTL_DAYS = 30;
const NULL_RETRY_TTL_MS = NULL_RETRY_TTL_DAYS * 24 * 60 * 60 * 1000;

export async function readImageUrlCache(path: string): Promise<ImageUrlCache> {
  if (!existsSync(path)) return new Map();
  try {
    const raw = await readFile(path, 'utf-8');
    const obj = JSON.parse(raw) as Record<string, ImageUrlCacheEntry>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export async function writeImageUrlCache(path: string, cache: ImageUrlCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const obj = Object.fromEntries(cache);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  await rename(tmp, path);
}

export interface CacheLookup {
  hit: boolean;
  url?: string | null;
}

export function lookupCachedImageUrl(
  cache: ImageUrlCache,
  key: string,
  now: Date,
): CacheLookup {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (entry.status === 'canonical') return { hit: true, url: entry.url };
  const resolvedAtMs = Date.parse(entry.resolvedAt);
  if (Number.isNaN(resolvedAtMs)) return { hit: false };
  if (now.getTime() - resolvedAtMs < NULL_RETRY_TTL_MS) {
    return { hit: true, url: null };
  }
  return { hit: false };
}

export function recordImageResolution(
  cache: ImageUrlCache,
  key: string,
  url: string | null,
  now: Date,
): void {
  cache.set(key, {
    url,
    resolvedAt: now.toISOString(),
    status: url ? 'canonical' : 'tried-null',
  });
}

export function imageCacheKey(brand: string, itemName: string): string {
  return `${brand.toLowerCase().trim()}|${itemName.toLowerCase().trim()}`;
}
```

- [ ] **Step 4: Run — must PASS**

Run: `npx vitest run tests/integrations/image-url-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/image-url-cache.ts tests/integrations/image-url-cache.test.ts
git commit -m "feat(integrations): persistent image-url cache (mirror dispersed/url-cache)"
```

### Task 10: Create `lib/integrations/image-lookup.ts` (Sonnet + web_search)

**Files:**
- Create: `lib/integrations/image-lookup.ts`
- Test: `tests/integrations/image-lookup.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { lookupProductImageUrl } from '../../lib/integrations/image-lookup.js';

describe('lookupProductImageUrl', () => {
  it('returns the URL from the model JSON output', async () => {
    const fakeAnthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '{"imageUrl": "https://images.rei.com/skuimage/123.jpg"}',
            },
          ],
        }),
      },
    } as unknown as Parameters<typeof lookupProductImageUrl>[0];

    const url = await lookupProductImageUrl(fakeAnthropic, {
      brand: 'Patagonia',
      itemName: 'Nano Puff Jacket',
      productUrl: 'https://patagonia.com/x',
    });
    expect(url).toBe('https://images.rei.com/skuimage/123.jpg');
  });

  it('returns null on empty / no-match JSON', async () => {
    const fakeAnthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"imageUrl": ""}' }],
        }),
      },
    } as unknown as Parameters<typeof lookupProductImageUrl>[0];

    const url = await lookupProductImageUrl(fakeAnthropic, {
      brand: 'Mystery',
      itemName: 'Unicorn Slippers',
      productUrl: '',
    });
    expect(url).toBeNull();
  });

  it('returns null when the model throws', async () => {
    const fakeAnthropic = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('429')),
      },
    } as unknown as Parameters<typeof lookupProductImageUrl>[0];

    const url = await lookupProductImageUrl(fakeAnthropic, {
      brand: 'X',
      itemName: 'Y',
      productUrl: '',
    });
    expect(url).toBeNull();
  });
});
```

- [ ] **Step 2: Run — must FAIL**

Run: `npx vitest run tests/integrations/image-lookup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement (mirror `lib/parsers/rei-product-lookup.ts`)**

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from '../anthropic-retry.js';
import { MODELS } from '../models.js';

export interface ProductIdentity {
  brand: string;
  itemName: string;
  productUrl: string;
}

const SYSTEM_PROMPT = `You find the canonical product image URL for a piece of consumer gear.

You will be given: brand, itemName, and optionally a productUrl (may be Amazon, REI, or empty).

Your job: find ONE high-quality product image URL that represents the item. Prefer the retailer's CDN (m.media-amazon.com, images.rei.com, the manufacturer's own CDN). Avoid lifestyle/banner images; prefer studio shots on white background.

Use web_search (up to 2 searches). Prefer queries like "<brand> <itemName> product image" or "site:rei.com <itemName>".

Return JSON only:
{"imageUrl": "<absolute https URL, or empty string if no confident match>"}

Rules:
- The URL must end with a common image extension (.jpg, .jpeg, .png, .webp) OR clearly be a CDN image URL.
- If you cannot find a confident match, return {"imageUrl": ""}.
- Return JSON only — no prose, no markdown fences.`;

export async function lookupProductImageUrl(
  anthropic: Anthropic,
  identity: ProductIdentity,
): Promise<string | null> {
  const userText = `brand: ${identity.brand}\nitemName: ${identity.itemName}\nproductUrl: ${identity.productUrl || '(none)'}`;

  let resp: Anthropic.Messages.Message;
  try {
    resp = await callWithRetry(() =>
      anthropic.messages.create({
        model: MODELS.sonnet,
        max_tokens: 256,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userText }],
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: 2,
          },
        ] as unknown as Anthropic.Messages.Tool[],
      }),
    );
  } catch (err) {
    console.warn(
      `[image-lookup] Sonnet call failed for ${identity.brand} ${identity.itemName}: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return null;
  }

  const textBlocks = resp.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) return null;

  const cleaned = extractJsonObject(lastText.text);
  if (!cleaned) return null;

  let parsed: { imageUrl?: unknown };
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return null;
  }

  const url = typeof parsed.imageUrl === 'string' ? parsed.imageUrl.trim() : '';
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence) return fence[1] ?? null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
```

- [ ] **Step 4: Run — must PASS**

Run: `npx vitest run tests/integrations/image-lookup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/image-lookup.ts tests/integrations/image-lookup.test.ts
git commit -m "feat(integrations): Sonnet+web_search image lookup"
```

---

## Phase 4 — Cron pipeline wiring

### Task 11: Add `resolveImage()` step in pipeline

**Files:**
- Create: `lib/integrations/resolve-image.ts`
- Test: `tests/integrations/resolve-image.test.ts`
- Modify: `apps/cron/pipeline.ts:287-296` (the `for of order.items` loop in `processOrderOrShipmentMessage`)

- [ ] **Step 1: Write the failing test for the helper**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveImage } from '../../lib/integrations/resolve-image.js';

const TMP_ROOT = join(tmpdir(), `resolve-image-test-${process.pid}`);
const CACHE_PATH = join(TMP_ROOT, 'image-url-cache.json');

beforeEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(TMP_ROOT, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe('resolveImage', () => {
  it('uses the parsed imageUrl when present (no Sonnet call)', async () => {
    const lookupCalls: number[] = [];
    const fakeAnthropic = {} as never;

    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(Buffer.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    try {
      const path = await resolveImage({
        itemId: 'A1',
        brand: 'Patagonia',
        itemName: 'Nano Puff',
        productUrl: '',
        parsedImageUrl: 'https://example.com/x.jpg',
        anthropic: fakeAnthropic,
        lookupFn: async () => {
          lookupCalls.push(1);
          return null;
        },
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(path).toMatch(/^\/images\//);
      expect(lookupCalls.length).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('falls back to lookup when parsedImageUrl is missing', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(Buffer.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    try {
      const path = await resolveImage({
        itemId: 'A2',
        brand: 'Patagonia',
        itemName: 'Nano Puff',
        productUrl: '',
        parsedImageUrl: undefined,
        anthropic: {} as never,
        lookupFn: async () => 'https://example.com/y.jpg',
        storageRoot: TMP_ROOT,
        cachePath: CACHE_PATH,
      });
      expect(path).toMatch(/^\/images\//);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns empty string when everything fails', async () => {
    const path = await resolveImage({
      itemId: 'A3',
      brand: 'X',
      itemName: 'Y',
      productUrl: '',
      parsedImageUrl: undefined,
      anthropic: {} as never,
      lookupFn: async () => null,
      storageRoot: TMP_ROOT,
      cachePath: CACHE_PATH,
    });
    expect(path).toBe('');
  });
});
```

- [ ] **Step 2: Run — must FAIL**

Run: `npx vitest run tests/integrations/resolve-image.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/integrations/resolve-image.ts`**

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import { downloadAndSave } from './image-storage.js';
import {
  readImageUrlCache,
  writeImageUrlCache,
  lookupCachedImageUrl,
  recordImageResolution,
  imageCacheKey,
} from './image-url-cache.js';
import { lookupProductImageUrl, type ProductIdentity } from './image-lookup.js';

export interface ResolveImageInput {
  itemId: string;
  brand: string;
  itemName: string;
  productUrl: string;
  parsedImageUrl: string | undefined;
  anthropic: Anthropic;
  /** Override for tests. Defaults to lookupProductImageUrl. */
  lookupFn?: (a: Anthropic, id: ProductIdentity) => Promise<string | null>;
  storageRoot?: string;
  cachePath?: string;
}

const DEFAULT_CACHE_PATH =
  process.env.IMAGE_URL_CACHE_PATH ?? './local-data/image-url-cache.json';

export async function resolveImage(input: ResolveImageInput): Promise<string> {
  // 1. Email-extracted URL
  if (input.parsedImageUrl) {
    const r = await downloadAndSave(input.itemId, input.parsedImageUrl, input.storageRoot);
    if (r.ok) return r.path;
  }

  // 2. AI lookup with persistent cache
  const cachePath = input.cachePath ?? DEFAULT_CACHE_PATH;
  const cache = await readImageUrlCache(cachePath);
  const key = imageCacheKey(input.brand, input.itemName);
  const cached = lookupCachedImageUrl(cache, key, new Date());

  let lookedUpUrl: string | null;
  if (cached.hit) {
    lookedUpUrl = cached.url ?? null;
  } else {
    const lookup = input.lookupFn ?? lookupProductImageUrl;
    lookedUpUrl = await lookup(input.anthropic, {
      brand: input.brand,
      itemName: input.itemName,
      productUrl: input.productUrl,
    });
    recordImageResolution(cache, key, lookedUpUrl, new Date());
    await writeImageUrlCache(cachePath, cache);
  }

  if (lookedUpUrl) {
    const r = await downloadAndSave(input.itemId, lookedUpUrl, input.storageRoot);
    if (r.ok) return r.path;
  }

  return '';
}
```

- [ ] **Step 4: Run — must PASS**

Run: `npx vitest run tests/integrations/resolve-image.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `apps/cron/pipeline.ts:287-296`**

Locate `for (const item of order.items)` inside `processOrderOrShipmentMessage`. After `routeItem(...)` returns `row`, before `rows.push(row)`:

```typescript
const imagePath = await resolveImage({
  itemId: `${order.orderId}|${item.productUrl || item.itemName}`,
  brand: row.brand,
  itemName: row.itemName,
  productUrl: row.productUrl,
  parsedImageUrl: item.imageUrl,
  anthropic,
});
row.image = imagePath;
rows.push(row);
```

Add the import at the top:
```typescript
import { resolveImage } from '../../lib/integrations/resolve-image.js';
```

- [ ] **Step 6: Typecheck + test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/integrations/resolve-image.ts tests/integrations/resolve-image.test.ts apps/cron/pipeline.ts
git commit -m "feat(cron): resolveImage step (email-extract -> AI lookup -> download)"
```

### Task 12: `/addgear` — persist the captured photo bytes

**Files:**
- Modify: `lib/parsers/photo.ts` (return bytes so caller can save) — already loads bytes via `imageBytes` param
- Modify: `apps/bot/commands/addgear.ts:240-260` (the row-building section)

The `/addgear` flow already has the photo bytes in `imageBytes` at the call site. Save them at row-write time.

- [ ] **Step 1: Locate the addgear row-build site**

Run: `grep -n "reasoning: draft.reasoning\|captured via /addgear\|saveItemImage\|imageBytes" apps/bot/commands/addgear.ts`

You're looking for the place where the `MasterRow` literal is built from the `draft` (likely near line 243 — "captured via /addgear photo").

- [ ] **Step 2: Pipe bytes through to that site**

Walk back from the row-build site to the photo-receive handler. The photo bytes are in scope as a `Buffer` (called `imageBytes` or similar). Plumb a new `imageBytes: Buffer` field through the draft until it's available at row-build time. Use the existing `addgearState` shape.

- [ ] **Step 3: Call `saveItemImage` at row-build, capture path**

At row-build site:
```typescript
import { saveItemImage } from '../../../lib/integrations/image-storage.js';

const itemId = `${row.orderId}|${row.productUrl || row.itemName}`;
const saved = await saveItemImage(itemId, draft.imageBytes, 'image/jpeg');
row.image = saved.ok ? saved.path : '';
```

Use `image/jpeg` (Telegram's default for camera photos). For PNG-uploaded images, derive the media type from `mediaTypeFromPath` in `lib/parsers/photo.ts`.

- [ ] **Step 4: Typecheck + existing tests**

Run: `npm run typecheck && npx vitest run tests/apps/bot/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "feat(addgear): persist /addgear photo bytes as the row's image"
```

---

## Phase 5 — Backfill script

### Task 13: `scripts/backfill-images.ts` skeleton with cost prompt

**Files:**
- Create: `scripts/backfill-images.ts`
- Modify: `package.json` (add `"backfill-images": "tsx scripts/backfill-images.ts"`)

- [ ] **Step 1: Write the script (no separate test — script tested by manual dry-run)**

```typescript
#!/usr/bin/env tsx
/**
 * One-shot backfill for the Image column on existing "All Purchases" rows.
 *
 * Phases per row (in order):
 *   1. Skip if Image is already populated (idempotent).
 *   2. Email re-parse: for Amazon/REI rows with an orderId, find the original
 *      email via Gmail (includeSpamTrash: true), re-run the parser, download
 *      the extracted imageUrl.
 *   3. AI lookup: for anything still missing, call lookupProductImageUrl.
 *
 * Cost estimate is printed before any spend. `-y` / `--yes` bypasses confirm.
 */
import { readline } from 'node:readline';
import Anthropic from '@anthropic-ai/sdk';
// Real imports left for the next tasks; this skeleton just lays out structure.
import { createSheetsClient, readMasterRows } from '../lib/sheets.js';
import { getEnv } from '../lib/env.js';

const COST_PER_LOOKUP_USD = 0.03;

async function main(): Promise<void> {
  const env = getEnv();
  const sheets = await createSheetsClient(env);
  const rows = await readMasterRows(sheets, env.spreadsheetId);

  const missing = rows.filter((r) => !r.image);
  const fromEmail = missing.filter((r) => (r.source === 'Amazon' || r.source === 'REI') && r.orderId);
  const needsLookup = missing.length - fromEmail.length;
  const estimatedUsd = needsLookup * COST_PER_LOOKUP_USD;

  console.log(`Backfill image plan:`);
  console.log(`  Rows total:          ${rows.length}`);
  console.log(`  Already have image:  ${rows.length - missing.length}`);
  console.log(`  Email re-parse pool: ${fromEmail.length}`);
  console.log(`  AI lookup pool:      ${needsLookup}`);
  console.log(`  Estimated max cost:  ~$${estimatedUsd.toFixed(2)} (Sonnet + web_search)`);

  if (!process.argv.includes('--yes') && !process.argv.includes('-y')) {
    const proceed = await confirm('Proceed? [y/N] ');
    if (!proceed) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  console.log('TODO: phases 2 + 3 in subsequent tasks.');
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `package.json`**

In the `"scripts"` block, add:
```json
"backfill-images": "tsx scripts/backfill-images.ts",
"backfill-images:dry": "tsx scripts/backfill-images.ts --dry-run"
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Smoke run (no actual writes — just see the plan)**

Run: `npm run backfill-images` and answer `n` at the prompt.
Expected: prints the plan, exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-images.ts package.json
git commit -m "feat(scripts): backfill-images skeleton with cost-confirm prompt"
```

### Task 14: Email re-parse phase with `includeSpamTrash: true`

**Files:**
- Modify: `scripts/backfill-images.ts`

- [ ] **Step 1: Add the email-search helper**

At the top of the script, add:
```typescript
import { google, type gmail_v1 } from 'googleapis';
import { getOAuthClient } from '../lib/gmail.js';
import { parseReiEmail, parseReiReceiptEmail } from '../lib/parsers/rei.js';
import { parseAmazonShipmentEmail, parseAmazonOrderEmail } from '../lib/parsers/amazon.js';
import { downloadAndSave } from '../lib/integrations/image-storage.js';
import { updateRowFields } from '../lib/sheets.js';

async function findEmailByOrderId(gmail: gmail_v1.Gmail, orderId: string): Promise<string | null> {
  // includeSpamTrash: true is critical — many historical order emails live in
  // Trash from years of inbox cleanup. Default search excludes Trash/Spam.
  const list = await gmail.users.messages.list({
    userId: 'me',
    q: `${orderId} in:anywhere`,
    includeSpamTrash: true,
    maxResults: 5,
  });
  const ids = (list.data.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
  for (const id of ids) {
    const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const html = extractHtmlBody(msg.data);
    if (html) return html;
  }
  return null;
}

function extractHtmlBody(msg: gmail_v1.Schema$Message): string | null {
  // Copy from apps/cron/pipeline.ts's extractHtmlBody — same logic.
  // (Or: refactor that helper into lib/ and reuse. Quick win, keeps the
  // backfill script honest.)
  // TODO in next sub-task — for now, inline the minimal version.
  const parts = msg.payload?.parts ?? [];
  for (const p of parts) {
    if (p.mimeType === 'text/html' && p.body?.data) {
      return Buffer.from(p.body.data, 'base64').toString('utf-8');
    }
  }
  if (msg.payload?.mimeType === 'text/html' && msg.payload.body?.data) {
    return Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
  }
  return null;
}
```

(Note: the TODO above is intentional and should be resolved in Task 15. The current task delivers a working but slightly duplicate `extractHtmlBody`.)

- [ ] **Step 2: Add the per-row resolver**

Below `main()`, add:

```typescript
async function tryEmailReparse(
  gmail: gmail_v1.Gmail,
  row: MasterRow,
  anthropic: Anthropic,
): Promise<string | null> {
  if (!row.orderId) return null;
  const html = await findEmailByOrderId(gmail, row.orderId);
  if (!html) return null;

  let imageUrl: string | undefined;
  if (row.source === 'REI') {
    const online = parseReiEmail(html);
    const order = online ?? parseReiReceiptEmail(html);
    if (!order) return null;
    const match = order.items.find((i) => i.itemName === row.itemName)
      ?? order.items[0];
    imageUrl = match?.imageUrl;
  } else if (row.source === 'Amazon') {
    const ship = parseAmazonShipmentEmail(html);
    const orders = ship ?? (await parseAmazonOrderEmail(anthropic, html));
    if (!orders) return null;
    const allItems = (orders ?? []).flatMap((o) => o.items);
    const match = allItems.find((i) => i.itemName === row.itemName) ?? allItems[0];
    imageUrl = match?.imageUrl;
  }

  if (!imageUrl) return null;
  return imageUrl;
}
```

- [ ] **Step 3: Wire into `main()` — process the email pool**

After the cost-confirm block:

```typescript
const oauth = await getOAuthClient();
const gmail = google.gmail({ version: 'v1', auth: oauth });
const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

let emailSuccess = 0;
let emailFail = 0;
const updates: Array<{ rowIndex: number; fields: { image: string } }> = [];

for (const row of fromEmail) {
  try {
    const url = await tryEmailReparse(gmail, row, anthropic);
    if (!url) { emailFail++; continue; }
    const itemId = `${row.orderId}|${row.productUrl || row.itemName}`;
    const saved = await downloadAndSave(itemId, url);
    if (!saved.ok) { emailFail++; continue; }
    // Find rowIndex — readMasterRows returns rows in sheet order starting at 2.
    const rowIndex = rows.indexOf(row) + 2;
    updates.push({ rowIndex, fields: { image: saved.path } });
    emailSuccess++;
    if (updates.length % 20 === 0) {
      await updateRowFields(sheets, env.spreadsheetId, updates.splice(0));
      console.log(`  email phase: ${emailSuccess} ok / ${emailFail} fail so far`);
    }
  } catch (err) {
    emailFail++;
    console.warn(`  [skip] ${row.orderId} ${row.itemName}: ${err instanceof Error ? err.message : err}`);
  }
}
if (updates.length > 0) await updateRowFields(sheets, env.spreadsheetId, updates.splice(0));

console.log(`Email phase done: ${emailSuccess} updated, ${emailFail} not found / failed`);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual smoke (don't run full backfill — just confirm wiring works on 1-2 rows)**

Optional: temporarily slice the pool to `fromEmail.slice(0, 2)` and run. Revert before commit.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-images.ts
git commit -m "feat(scripts): backfill-images email re-parse phase (Trash-aware)"
```

### Task 15: Refactor `extractHtmlBody` into shared module (resolve TODO)

**Files:**
- Modify: `apps/cron/pipeline.ts`, `scripts/backfill-images.ts`
- Create: `lib/gmail-html.ts`

- [ ] **Step 1: Extract the helper to `lib/gmail-html.ts`**

```typescript
import type { gmail_v1 } from 'googleapis';

export function extractHtmlBody(msg: gmail_v1.Schema$Message): string | null {
  const parts = msg.payload?.parts ?? [];
  for (const p of parts) {
    if (p.mimeType === 'text/html' && p.body?.data) {
      return Buffer.from(p.body.data, 'base64').toString('utf-8');
    }
    if (p.parts) {
      for (const sub of p.parts) {
        if (sub.mimeType === 'text/html' && sub.body?.data) {
          return Buffer.from(sub.body.data, 'base64').toString('utf-8');
        }
      }
    }
  }
  if (msg.payload?.mimeType === 'text/html' && msg.payload.body?.data) {
    return Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
  }
  return null;
}
```

- [ ] **Step 2: Replace the inline copies in `apps/cron/pipeline.ts` and `scripts/backfill-images.ts` with an import**

- [ ] **Step 3: Typecheck + test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/gmail-html.ts apps/cron/pipeline.ts scripts/backfill-images.ts
git commit -m "refactor: shared extractHtmlBody in lib/gmail-html.ts"
```

### Task 16: AI lookup phase in backfill

**Files:**
- Modify: `scripts/backfill-images.ts`

- [ ] **Step 1: Add the lookup pass**

After the email phase, append:

```typescript
import { resolveImage } from '../lib/integrations/resolve-image.js';

const stillMissing = rows.filter((r) => !r.image && r.source !== 'REI' && r.source !== 'Amazon')
  .concat(fromEmail.filter((r) => !updates.some((u) => u.rowIndex === rows.indexOf(r) + 2)));

let lookupSuccess = 0;
let lookupFail = 0;
const lookupUpdates: Array<{ rowIndex: number; fields: { image: string } }> = [];

for (const row of stillMissing) {
  try {
    const itemId = `${row.orderId || `row-${rows.indexOf(row)}`}|${row.productUrl || row.itemName}`;
    const path = await resolveImage({
      itemId,
      brand: row.brand,
      itemName: row.itemName,
      productUrl: row.productUrl,
      parsedImageUrl: undefined,
      anthropic,
    });
    if (!path) { lookupFail++; continue; }
    const rowIndex = rows.indexOf(row) + 2;
    lookupUpdates.push({ rowIndex, fields: { image: path } });
    lookupSuccess++;
    if (lookupUpdates.length % 20 === 0) {
      await updateRowFields(sheets, env.spreadsheetId, lookupUpdates.splice(0));
      console.log(`  lookup phase: ${lookupSuccess} ok / ${lookupFail} fail so far`);
    }
  } catch (err) {
    lookupFail++;
    console.warn(`  [skip] ${row.itemName}: ${err instanceof Error ? err.message : err}`);
  }
}
if (lookupUpdates.length > 0) await updateRowFields(sheets, env.spreadsheetId, lookupUpdates.splice(0));

console.log(`Lookup phase done: ${lookupSuccess} updated, ${lookupFail} failed`);
console.log(`Backfill complete. Total: ${emailSuccess + lookupSuccess} images attached.`);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-images.ts
git commit -m "feat(scripts): backfill-images AI lookup phase"
```

---

## Phase 6 — Web UI

### Task 17: Image block in detail panel (read-only path)

**Files:**
- Modify: `app/components/detail-panel.tsx` (top of `PanelBody`, before the header `<div>`)

- [ ] **Step 1: Add the image block**

Insert at the very top of `PanelBody`'s returned JSX, before the header `<div className="flex items-start gap-3 border-b ...">`:

```tsx
<ImageBlock row={row} />
```

Then add the `ImageBlock` component below `Section` / `Field`:

```tsx
function ImageBlock({ row }: { row: MasterRow }) {
  if (!row.image) {
    return (
      <div className="aspect-[4/3] w-full bg-bg-base flex items-center justify-center border-b border-border-subtle">
        <span className="text-text-muted text-[12px] italic">No image</span>
      </div>
    );
  }
  return (
    <div className="aspect-[4/3] w-full overflow-hidden border-b border-border-subtle bg-bg-base">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={row.image}
        alt={row.itemName}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
```

- [ ] **Step 2: Run web dev to eyeball it**

Run: `npm run web:dev`
Open the dashboard, click an item — image (or "No image" placeholder) should appear at the top of the panel.

- [ ] **Step 3: Commit**

```bash
git add app/components/detail-panel.tsx
git commit -m "feat(web): image block in detail panel (read-only)"
```

### Task 18: Image serving — Next.js route handler for `/images/<id>.<ext>`

**Files:**
- Create: `app/images/[file]/route.ts`

Static images on the Railway volume aren't in `public/`, so Next.js won't serve them by default. Add a route handler that streams them.

- [ ] **Step 1: Write the route**

```typescript
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

const STORAGE_ROOT = process.env.IMAGE_STORAGE_ROOT ?? './local-data';

const TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await ctx.params;
  if (!/^[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/.test(file)) {
    return new NextResponse('not found', { status: 404 });
  }
  const ext = file.split('.').pop() ?? 'jpg';
  const path = join(STORAGE_ROOT, 'images', file);
  try {
    await stat(path);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
  const bytes = await readFile(path);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'content-type': TYPE_BY_EXT[ext] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
    },
  });
}
```

- [ ] **Step 2: Manual smoke**

Put a JPEG at `./local-data/images/<sha1-hex-16>.jpg`. Run `npm run web:dev`. `curl http://localhost:3000/images/<that-name>` should return 200 with image bytes.

- [ ] **Step 3: Commit**

```bash
git add app/images/[file]/route.ts
git commit -m "feat(web): route handler serves images from /data volume"
```

### Task 19: Upload API route + middleware exception

**Files:**
- Create: `app/api/items/[itemId]/image/route.ts`
- Modify: `middleware.ts` (only if needed — the basic-auth middleware should already cover `/api/*`; verify)

- [ ] **Step 1: Read `middleware.ts` to confirm `/api` is gated by basic auth**

Run: `cat middleware.ts`
Expected: a matcher that includes `/api/*` or all paths. If `/api/*` is excluded, add it.

- [ ] **Step 2: Write the POST handler**

```typescript
import { NextResponse } from 'next/server';
import { saveItemImage, type SupportedMediaType } from '../../../../../lib/integrations/image-storage.js';
import { createSheetsClient, readMasterRows, updateRowFields } from '../../../../../lib/sheets.js';
import { getEnv } from '../../../../../lib/env.js';

export const runtime = 'nodejs';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  const { itemId } = await ctx.params;
  const form = await req.formData();
  const file = form.get('image');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'missing image field' }, { status: 400 });
  }
  const mediaType = (file.type || '') as SupportedMediaType;
  const bytes = Buffer.from(await file.arrayBuffer());
  const saved = await saveItemImage(itemId, bytes, mediaType);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }

  const env = getEnv();
  const sheets = await createSheetsClient(env);
  const rows = await readMasterRows(sheets, env.spreadsheetId);
  const idx = rows.findIndex((r) => `${r.orderId}|${r.productUrl || r.itemName}` === itemId);
  if (idx === -1) {
    return NextResponse.json({ error: 'item not found' }, { status: 404 });
  }
  await updateRowFields(sheets, env.spreadsheetId, [
    { rowIndex: idx + 2, fields: { image: saved.path } },
  ]);

  return NextResponse.json({ ok: true, path: saved.path });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Smoke (manual)**

Start dev: `npm run web:dev`. With a small JPEG file and an itemId from your sheet:
```bash
curl -u "$WEB_USER:$WEB_PASSWORD" -X POST \
  -F "image=@/tmp/test.jpg" \
  http://localhost:3000/api/items/<encoded-itemId>/image
```
Expected: `{"ok":true,"path":"/images/..."}`. Reload the dashboard; image appears.

- [ ] **Step 5: Commit**

```bash
git add app/api/items/[itemId]/image/route.ts
git commit -m "feat(web): POST /api/items/[itemId]/image — multipart upload"
```

### Task 20: Detail panel — upload affordance (replace + add)

**Files:**
- Modify: `app/components/detail-panel.tsx` (extend `ImageBlock`)

- [ ] **Step 1: Convert `ImageBlock` to a client component with upload logic**

(`detail-panel.tsx` is already `'use client'`; just extend `ImageBlock`.)

```tsx
function ImageBlock({ row }: { row: MasterRow }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemId = `${row.orderId}|${row.productUrl || row.itemName}`;

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const resp = await fetch(`/api/items/${encodeURIComponent(itemId)}/image`, {
        method: 'POST',
        body: fd,
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden border-b border-border-subtle bg-bg-base group"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) void handleFile(f);
      }}
    >
      {row.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.image} alt={row.itemName} className="h-full w-full object-cover" />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-full w-full items-center justify-center border-2 border-dashed border-border-subtle text-[12px] text-text-muted hover:text-text-primary"
        >
          + Add image
        </button>
      )}
      {row.image && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="absolute right-2 top-2 rounded-input bg-bg-surface/80 px-2 py-1 text-[11px] text-text-secondary opacity-0 transition group-hover:opacity-100"
        >
          Replace
        </button>
      )}
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[12px] text-white">
          Uploading…
        </div>
      )}
      {error && (
        <div className="absolute bottom-2 left-2 right-2 rounded-input bg-red-900/80 px-2 py-1 text-[11px] text-white">
          {error}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
```

(Add `useState`, `useRef` imports if not already present, plus `import { useRouter } from 'next/navigation';` and `const router = useRouter();` inside the component.)

- [ ] **Step 2: Manual smoke**

Run `npm run web:dev`. On an item without an image: click "Add image", pick a JPEG → it uploads, page reloads, image appears. On an item with an image: hover → "Replace" button shows → click → file picker → uploads → image swaps.

- [ ] **Step 3: Commit**

```bash
git add app/components/detail-panel.tsx
git commit -m "feat(web): detail panel image upload (add + replace + drag-drop)"
```

---

## Phase 7 — `/addgear` fuzzy-match Attach/Replace branches

### Task 21: `/addgear` — branch on fuzzy match for Attach / Replace

**Files:**
- Modify: `apps/bot/commands/addgear.ts`
- Test: `tests/apps/bot/addgear-attach.test.ts`

The existing flow at fuzzy-match offers (paraphrasing) Create-anyway / Cancel. Extend to also offer Attach (when matched row has no image) or Replace (when it does).

- [ ] **Step 1: Locate the fuzzy-match branch**

Run: `grep -n "fuzzy\|findFuzzyMatch\|likely duplicate\|create anyway\|fuzzy-match" apps/bot/commands/addgear.ts lib/dedup.ts`

Note the line where the bot replies with the "looks like duplicate" prompt.

- [ ] **Step 2: Write a failing test that drives the new branching**

Add to `tests/apps/bot/addgear-attach.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
// Import the right entry point. Most likely `continueAddgear` after a fuzzy match
// would have been registered in state.
import { startAddgear, continueAddgear } from '../../../apps/bot/commands/addgear.js';
import { AddgearStateStore } from '../../../lib/addgearState.js';

describe('/addgear fuzzy match — Attach branch', () => {
  it('offers Attach when matched row has no image', async () => {
    // Set up a state where a fuzzy match was found AND the matched row has no image.
    // The exact API depends on how state is shaped — read addgear.ts to construct.
    // Assert: the bot reply text includes "Attach" and not "Replace".
    // ...
  });

  it('offers Replace when matched row has an image', async () => {
    // Set up a state with a fuzzy match AND matched row has image.
    // Assert: the bot reply text includes "Replace" and not "Attach".
    // ...
  });

  it('on "Attach", updates the matched row image instead of creating a new row', async () => {
    // Drive the state forward with the user picking Attach.
    // Assert: rowsAppended.length === 0, but updateRowFields was called for the matched row.
    // ...
  });
});
```

(Test bodies will need fleshing out in concert with the addgear state shape — read it carefully before writing.)

- [ ] **Step 3: Run — must FAIL**

Run: `npx vitest run tests/apps/bot/addgear-attach.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the branching**

In `apps/bot/commands/addgear.ts`, at the fuzzy-match prompt, add a check on the matched row's `image` field and present an extra inline button: "Attach" (if `image === ''`) or "Replace" (otherwise), in addition to existing options.

On "Attach"/"Replace" callback: save the photo bytes via `saveItemImage(matchedRow.itemId, bytes, 'image/jpeg')`, then `updateRowFields(sheets, env.spreadsheetId, [{ rowIndex: matchedRow.rowIndex, fields: { image: saved.path }}])`. Acknowledge in chat: "Image attached to *<matched item name>*."

Also: in `apps/bot/preview.ts`, when the bot sends the new-row preview, include the photo bytes via Telegram's `sendPhoto` (with the text preview as the caption). This is purely additive — Telegram already supports sending a photo alongside text. The image is in hand at preview time, so no extra fetch.

- [ ] **Step 5: Run — must PASS**

Run: `npx vitest run tests/apps/bot/addgear-attach.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bot/commands/addgear.ts tests/apps/bot/addgear-attach.test.ts
git commit -m "feat(bot): /addgear fuzzy-match Attach/Replace branches"
```

---

## Phase 8 — Railway, docs, and DECISIONS

### Task 22: Railway volume mount on web + cron

**Files:**
- Modify: `railway.web.json`, `railway.cron.json`

- [ ] **Step 1: Inspect current configs**

Run: `cat railway.web.json railway.cron.json`

- [ ] **Step 2: Add `/data` volume to both**

Per Railway's config schema, add a `volumes` section (or whatever Railway's current JSON config uses — verify against Railway docs). Example shape:

```json
{
  ...,
  "volumes": [
    { "mountPath": "/data", "name": "inventory-data" }
  ]
}
```

(The volume must already exist in the Railway project; if not, create it from the dashboard first.)

- [ ] **Step 3: Set env var defaults in `.env.example`**

Add:
```
IMAGE_STORAGE_ROOT=/data
IMAGE_URL_CACHE_PATH=/data/image-url-cache.json
```

- [ ] **Step 4: Commit**

```bash
git add railway.web.json railway.cron.json .env.example
git commit -m "infra(railway): mount /data on web + cron, document image env vars"
```

### Task 23: Update CLAUDE.md schema row and integrations table

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the sheet schema entry**

Find the line `Tab "All Purchases": 18 columns;` → change to `19 columns;`. Add `Image` to the "key ones" list, e.g.: `Source, Order ID, Status, Domain, Type, Product URL, Image, Reasoning, Notes`.

- [ ] **Step 2: Add an Image storage entry to the integrations table**

Insert above the existing weather row:

```
| Image storage | Railway volume `/data/images/<sha1(itemId)>.<ext>`. Email-extract first (REI/Amazon parsers), Sonnet+`web_search` fallback (`lib/integrations/image-lookup.ts`), persistent cache at `/data/image-url-cache.json`. Web UI: `POST /api/items/[itemId]/image` (only writable column from web). | Web UI v1.1 ✅ shipped 2026-05-XX |
```

- [ ] **Step 3: Commit (ASK FIRST per CLAUDE.md)**

Per the project rule "Do not modify CLAUDE.md without explicit confirmation," do not commit until Tom reviews the diff and OKs it. Print the diff, wait, then:

```bash
git add CLAUDE.md
git commit -m "docs(CLAUDE): add Image column + image storage integration"
```

### Task 24: Append to DECISIONS.md

**Files:**
- Modify: `DECISIONS.md`

- [ ] **Step 1: Append three new entries**

```markdown
### 2026-05-XX — Item images: store locally vs hotlink

Decision: download every image to the Railway `/data/images/` volume rather
than hotlink retailer CDN URLs. Reason: manual uploads, `/addgear` photo
bytes, and AI-resolved URLs all need local storage anyway; a single
storage path is simpler than branching by source. Trade-off: 450MB +
volume overhead vs. zero-byte hotlink. Volume is well within Railway's
allocation. URL stability also no longer a concern.

### 2026-05-XX — Item images: AI lookup runs on every cron ingest

Decision: when email extraction fails to find an image URL, call
Sonnet+`web_search` during the cron ingest (not lazy / not batch).
Reason: keeps the sheet visually complete without a separate backfill
queue. Trade-off: ongoing cost (~$0.10-1/day typical, ~$0.50-2/day
during heavy buying), but the persistent cache amortizes repeats and
the cost cap from email-first ordering is significant.

### 2026-05-XX — Item images: `/addgear` is the single Telegram entry point

Decision: do NOT add a separate `/image <itemId>` command. The existing
`/addgear` fuzzy-match branch grows Attach / Replace / Create-new
options when a duplicate is detected. Reason: avoids fragmenting the
Telegram-bot interface; the fuzzy-match dedup already exists in
`lib/dedup.ts`; users don't need to know item IDs.
```

- [ ] **Step 2: Same review rule as Task 23 — ASK FIRST**

```bash
git add DECISIONS.md
git commit -m "docs(DECISIONS): item images storage, AI lookup cadence, /addgear entry point"
```

---

## Final verification

### Task 25: End-to-end manual acceptance test

- [ ] **Step 1: Bootstrap the sheet (adds Image column)**

Run: `npm run bootstrap-sheet`
Expected: report shows `Image` was appended.

- [ ] **Step 2: Run a single cron ingest in dry-run mode**

Run: `npm run cron:dry`
Expected: log mentions `resolveImage` step (or at least doesn't throw); no row writes happen.

- [ ] **Step 3: Run a real one-message ingest with a recent Amazon shipment**

This requires a real recent unprocessed email. Run: `npm run cron`
Expected: new row appears in sheet with `Image` populated, file lands at `/data/images/<hash>.jpg`. Web dashboard detail panel shows the image.

- [ ] **Step 4: Backfill — dry/spot check**

Run: `npm run backfill-images`. Cost prompt appears with sane numbers; pick `n`.

- [ ] **Step 5: Backfill — execute on a small scope first**

Temporarily edit the script to slice `fromEmail.slice(0, 5)` for a tiny trial run; commit nothing. Run `npm run backfill-images -- -y`. Expected: 5 rows updated. Revert the slice.

- [ ] **Step 6: `/addgear` fuzzy match — Attach path**

Send a Telegram `/addgear` with a photo of an item that's already in the sheet without an image. Confirm the bot offers Attach; pick it; confirm the sheet row's `Image` column populates.

- [ ] **Step 7: Web upload**

In the dashboard, click on an item without an image. Click "+ Add image" → pick a JPEG → confirm it appears and the sheet `Image` cell updates.

- [ ] **Step 8: Full backfill**

When confident: `npm run backfill-images -- -y`. Watch the log. Budget for ~$20-40 of Anthropic spend.

---

## Implementation notes

- **One file at a time.** Don't try to ship phases out of order — each phase depends on the previous (schema → parsers → cron → backfill → UI → bot).
- **Don't `--no-verify` commits.** If a pre-commit hook fails, fix the underlying issue.
- **Frequent commits.** Every passing test → commit. Don't batch.
- **Revert the slice.** When trial-running the backfill on a subset, do not commit the temporary `.slice()`.
- **CLAUDE.md / DECISIONS.md edits need explicit Tom approval** before commit (project rule).
- **Detail panel branch.** Phase 6 work depends on `detail-panel.tsx` from `main`. If still on `phase-7-photography`, either merge `main` first or rebase before implementing Phase 6.
